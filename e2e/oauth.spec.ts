import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { type Account, accountsFor } from "./oauth/accounts";
import { type Connector, type Environment, environmentFromEnv } from "./oauth/environments";
import {
  authenticate,
  type Credentials,
  type PendingAuthorization,
  receiveAuthorizationCode,
  requestAuthorization,
} from "./oauth/login";
import { mcpCall, toolResultText } from "./oauth/mcp";

interface AuthorizationGrant {
  code: string;
  codeVerifier: string;
}

interface Flow {
  page: Page;
  request: APIRequestContext;
  env: Environment;
  connector: Connector;
  account: Account & { credentials: Credentials };
}

const env = environmentFromEnv();

for (const account of accountsFor(env.target)) {
  for (const connector of env.connectors) {
    test(`${env.target}: ${account.kind} user logs in as ${connector.name} and calls a tool`, async ({
      page,
      request,
    }) => {
      const missing = `${account.variables.email} and ${account.variables.password} are not set`;
      if (!account.credentials) {
        expect(process.env.CI, `${missing}; a CI run must configure every account`).toBeFalsy();
        test.skip(true, missing);
        return;
      }
      const flow: Flow = { page, request, env, connector, account: { ...account, credentials: account.credentials } };

      const pending = await requestAuthorizationStage(flow);
      await authenticateStage(flow);
      const grant = await receiveAuthorizationCodeStage(flow, pending);
      const accessToken = await exchangeCodeForTokenStage(flow, grant);
      await connectStage(flow, accessToken);
      await listToolsStage(flow, accessToken);
      await callToolStage(flow, accessToken);
    });
  }
}

function requestAuthorizationStage(flow: Flow): Promise<PendingAuthorization> {
  return stage(flow, "request authorization and reach the login page", () =>
    requestAuthorization(flow.page, flow.env, flow.connector, flow.account.tenant)
  );
}

function authenticateStage(flow: Flow): Promise<void> {
  return stage(flow, "authenticate with email and password", () =>
    authenticate(flow.page, flow.account.tenant, flow.account.credentials)
  );
}

function receiveAuthorizationCodeStage(flow: Flow, pending: PendingAuthorization): Promise<AuthorizationGrant> {
  return stage(flow, "receive the authorization code on the connector redirect", async () => ({
    code: await receiveAuthorizationCode(pending),
    codeVerifier: pending.codeVerifier,
  }));
}

function exchangeCodeForTokenStage(flow: Flow, grant: AuthorizationGrant): Promise<string> {
  return stage(flow, "exchange the code for an access token", async () => {
    const response = await flow.request.post(`${flow.env.ulsBaseUrl}/token`, {
      form: {
        grant_type: "authorization_code",
        client_id: flow.env.authorizeClientId,
        code: grant.code,
        redirect_uri: flow.connector.redirectUri,
        code_verifier: grant.codeVerifier,
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as { access_token?: string };
    expect(body.access_token, "the token response carries an access_token").toBeTruthy();
    return body.access_token as string;
  });
}

function connectStage(flow: Flow, accessToken: string): Promise<void> {
  return stage(flow, "initialize an MCP session with the token", async () => {
    const init = await mcpCall(flow.request, flow.env.mcpUrl, accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: `oauth-e2e-${flow.connector.name}`, version: "0" },
    });
    expect(init.status, JSON.stringify(init.error)).toBe(200);
    expect(init.result?.serverInfo).toBeTruthy();
  });
}

function listToolsStage(flow: Flow, accessToken: string): Promise<void> {
  return stage(flow, "list the tools without an API key exchange", async () => {
    const tools = await mcpCall(flow.request, flow.env.mcpUrl, accessToken, "tools/list");
    expect(tools.status, JSON.stringify(tools.error)).toBe(200);
    expect((tools.result?.tools as unknown[]).length).toBeGreaterThan(0);
  });
}

function callToolStage(flow: Flow, accessToken: string): Promise<void> {
  return stage(flow, "call a tool with the key exchanged for this user", async () => {
    const call = await mcpCall(flow.request, flow.env.mcpUrl, accessToken, "tools/call", {
      name: "tomtom-geocode",
      arguments: { query: "Amsterdam Centraal", limit: 1 },
    });
    expect(call.status, JSON.stringify(call.error)).toBe(200);
    const text = toolResultText(call.result);
    expect(call.result?.isError, text).toBeFalsy();
    expect(JSON.parse(text).type).toBe("FeatureCollection");
  });
}

function stage<T>(flow: Flow, name: string, run: () => Promise<T>): Promise<T> {
  const subject = `${flow.env.target} ${flow.account.kind} (${flow.account.tenant}) via ${flow.connector.name}`;
  return test.step(name, async () => {
    try {
      return await run();
    } catch (error) {
      throw new Error(`[${subject}] ${name}: ${(error as Error).message}`, { cause: error });
    }
  });
}
