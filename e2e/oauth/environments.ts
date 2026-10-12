export type Target = "prod" | "dev";

export type ConnectorName = "chatgpt" | "claude" | "inspector";

export interface Connector {
  name: ConnectorName;
  redirectUri: string;
}

export interface Environment {
  target: Target;
  mcpUrl: string;
  ulsBaseUrl: string;
  authorizeClientId: string;
  connectors: Connector[];
}

export const ENVIRONMENTS: Record<Target, Environment> = {
  prod: {
    target: "prod",
    mcpUrl: "https://mcp.tomtom.com/maps",
    ulsBaseUrl: "https://oauth.my.tomtom.com",
    authorizeClientId: "https://mcp.tomtom.com",
    connectors: [
      { name: "chatgpt", redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" },
      { name: "claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" },
    ],
  },
  dev: {
    target: "dev",
    mcpUrl: "https://mcp-dev.api-system.tomtom.com/maps",
    ulsBaseUrl: "https://test.oauth.my.tomtom.com",
    authorizeClientId: "https://mcp-dev.api-system.tomtom.com/maps/inspector-client.json",
    connectors: [{ name: "inspector", redirectUri: "http://127.0.0.1:8976/cb" }], // Only dev allows a localhost redirectUri for testing. Defined in 0d7ef88
  },
};

const TARGET_VARIABLE = "OAUTH_E2E_TARGET";

export function environmentFromEnv(env: NodeJS.ProcessEnv = process.env): Environment {
  const target = env[TARGET_VARIABLE] ?? "prod";
  if (!(target in ENVIRONMENTS)) {
    throw new Error(
      `${TARGET_VARIABLE} is "${target}"; use one of ${Object.keys(ENVIRONMENTS).join(", ")}`
    );
  }
  return ENVIRONMENTS[target as Target];
}
