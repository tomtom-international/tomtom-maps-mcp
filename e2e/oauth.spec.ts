import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { expect, type Page, test } from "@playwright/test";
import { type Account, accountsFor } from "./oauth/accounts";
import {
  type AuthorizationRequest,
  type FakeOAuthClientProvider,
  connectorClient,
  fakeOAuthClientProvider,
  connectorTransport,
} from "./oauth/connectorClient";
import { type Connector, type Environment, environmentFromEnv } from "./oauth/environments";
import * as login from "./oauth/login";
import type { Credentials, PendingAuthorization } from "./oauth/login";

interface Flow {
  page: Page;
  env: Environment;
  connector: Connector;
  account: Account & { credentials: Credentials };
  provider: FakeOAuthClientProvider;
}

interface Discovery {
  transport: StreamableHTTPClientTransport;
  authorization: AuthorizationRequest;
}

const env = environmentFromEnv();

for (const account of accountsFor(env.target)) {
  for (const connector of env.connectors) {
    test(`${env.target}: ${account.kind} user logs in as ${connector.name} and calls a tool`, async ({
      page,
    }) => {
      const missing = `${account.variables.email} and ${account.variables.password} are not set`;
      if (!account.credentials) {
        expect(process.env.CI, `${missing}; a CI run must configure every account`).toBeFalsy();
        test.skip(true, missing);
        return;
      }
      const flow: Flow = {
        page,
        env,
        connector,
        account: { ...account, credentials: account.credentials },
        provider: fakeOAuthClientProvider(env, connector),
      };

      const discovery = await discoverAuthorization(flow);
      const pending = await chooseTenant(flow, discovery.authorization);
      await authenticate(flow);
      const code = await receiveAuthorizationCode(flow, pending);
      await exchangeCodeForToken(flow, discovery.transport, code);
      const client = await connect(flow);
      await listTools(flow, client);
      await callTool(flow, client);
    });
  }
}

function discoverAuthorization(flow: Flow): Promise<Discovery> {
  return step(flow, "discover the authorization server and start authorization", async () => {
    const transport = connectorTransport(flow.env, flow.provider);
    const refusal = await connectorClient(flow.connector)
      .connect(transport)
      .then(() => undefined, (error: Error) => error);
    if (!refusal) throw new Error("the server opened a session without a token");
    if (!(refusal instanceof UnauthorizedError)) throw refusal;
    const authorization = flow.provider.authorizationRequest();
    expect(authorization.url.origin, "the authorization server the MCP server advertises").toBe(
      flow.env.authorizationServer
    );
    return { transport, authorization };
  });
}

function chooseTenant(flow: Flow, authorization: AuthorizationRequest): Promise<PendingAuthorization> {
  return step(flow, "choose the sign-in tenant and reach the login page", () =>
    login.chooseTenant(flow.page, authorization, flow.connector, flow.account.tenant)
  );
}

function authenticate(flow: Flow): Promise<void> {
  return step(flow, "authenticate with email and password", () =>
    login.authenticate(flow.page, flow.account.tenant, flow.account.credentials)
  );
}

function receiveAuthorizationCode(flow: Flow, pending: PendingAuthorization): Promise<string> {
  return step(flow, "receive the authorization code on the connector redirect", () =>
    login.receiveAuthorizationCode(pending)
  );
}

function exchangeCodeForToken(
  flow: Flow,
  transport: StreamableHTTPClientTransport,
  code: string
): Promise<void> {
  return step(flow, "exchange the code for an access token", async () => {
    await transport.finishAuth(code);
    const accessToken = flow.provider.tokens()?.access_token;
    if (!accessToken) throw new Error("the token response carries no access_token");
  });
}

function connect(flow: Flow): Promise<Client> {
  return step(flow, "initialize an MCP session with the token", async () => {
    const client = connectorClient(flow.connector);
    await client.connect(connectorTransport(flow.env, flow.provider));
    expect(client.getServerVersion(), "the server named itself in the initialize result").toBeTruthy();
    return client;
  });
}

function listTools(flow: Flow, client: Client): Promise<void> {
  return step(flow, "list the tools without an API key exchange", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
}

function callTool(flow: Flow, client: Client): Promise<void> {
  return step(flow, "call a tool with the key exchanged for this user", async () => {
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "tomtom-locate-place",
        arguments: { query: "Amsterdam Centraal", queryAs: "poi" },
      })
    );
    const text = result.content.find((block) => block.type === "text")?.text ?? "";
    if (!flow.env.exchangedKeysServeApi) {
      expect(text, "the exchanged key reached the TomTom API").toContain("API key");
      return;
    }
    expect(result.isError, text).toBeFalsy();
    expect(JSON.parse(text).features?.[0]?.geometry?.type).toBe("Point");
  });
}

function step<T>(flow: Flow, name: string, run: () => Promise<T>): Promise<T> {
  const subject = `${flow.env.target} ${flow.account.kind} (${flow.account.tenant}) via ${flow.connector.name}`;
  return test.step(name, async () => {
    try {
      return await run();
    } catch (error) {
      throw new Error(`[${subject}] ${name}: ${(error as Error).message}`, { cause: error });
    }
  });
}
