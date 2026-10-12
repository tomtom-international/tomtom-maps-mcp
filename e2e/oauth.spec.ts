import { expect, test } from "@playwright/test";
import { accountsFor } from "./oauth/accounts";
import { environmentFromEnv } from "./oauth/environments";
import { loginAndCaptureCode } from "./oauth/login";
import { mcpCall, toolResultText } from "./oauth/mcp";

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

      const login = await test.step("login through ULS and capture the code", () =>
        loginAndCaptureCode(page, env, connector, account.tenant, account.credentials!)
      );

      const accessToken = await test.step("exchange the code for an access token", async () => {
        const response = await request.post(`${env.ulsBaseUrl}/token`, {
          form: {
            grant_type: "authorization_code",
            client_id: env.authorizeClientId,
            code: login.code,
            redirect_uri: connector.redirectUri,
            code_verifier: login.codeVerifier,
          },
        });
        expect(response.status(), await response.text()).toBe(200);
        const body = (await response.json()) as { access_token?: string };
        expect(body.access_token, "the token response carries an access_token").toBeTruthy();
        return body.access_token as string;
      });

      await test.step("list the tools without an API key exchange", async () => {
        const init = await mcpCall(request, env.mcpUrl, accessToken, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: `oauth-e2e-${connector.name}`, version: "0" },
        });
        expect(init.status, JSON.stringify(init.error)).toBe(200);
        expect(init.result?.serverInfo).toBeTruthy();

        const tools = await mcpCall(request, env.mcpUrl, accessToken, "tools/list");
        expect(tools.status, JSON.stringify(tools.error)).toBe(200);
        expect((tools.result?.tools as unknown[]).length).toBeGreaterThan(0);
      });

      await test.step("call a tool with the key exchanged for this user", async () => {
        const call = await mcpCall(request, env.mcpUrl, accessToken, "tools/call", {
          name: "tomtom-geocode",
          arguments: { query: "Amsterdam Centraal", limit: 1 },
        });
        expect(call.status, JSON.stringify(call.error)).toBe(200);
        const text = toolResultText(call.result);
        expect(call.result?.isError, text).toBeFalsy();
        expect(JSON.parse(text).type).toBe("FeatureCollection");
      });
    });
  }
}
