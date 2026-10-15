export type Target = "prod" | "dev" | "local";

export type ConnectorName = "chatgpt" | "claude" | "inspector";

export interface Connector {
  name: ConnectorName;
  redirectUri: string;
}

export interface Environment {
  target: Target;
  mcpUrl: string;
  authorizationServer: string;
  authorizeClientId: string;
  connectors: Connector[];
  exchangedKeysServeApi: boolean;
}

const CONNECTORS: Connector[] = [
  { name: "chatgpt", redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" },
  { name: "claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" },
];

export const ENVIRONMENTS: Record<Target, Environment> = {
  prod: {
    target: "prod",
    mcpUrl: "https://mcp.tomtom.com/maps",
    authorizationServer: "https://oauth.my.tomtom.com",
    authorizeClientId: "https://mcp.tomtom.com",
    connectors: CONNECTORS,
    exchangedKeysServeApi: true,
  },
  dev: {
    target: "dev",
    mcpUrl: "https://mcp-dev.api-system.tomtom.com/maps",
    authorizationServer: "https://staging.oauth.my.tomtom.com",
    authorizeClientId: "https://mcp-dev.api-system.tomtom.com",
    connectors: CONNECTORS,
    // Most API services behind ULS staging are not fully functional, so dev proves the key exchange, but not the tool result as they're expected to fail.
    exchangedKeysServeApi: false,
  },
  local: {
    target: "local",
    mcpUrl: "http://localhost:3000/mcp",
    authorizationServer: "https://staging.oauth.my.tomtom.com",
    authorizeClientId: "https://mcp-dev.api-system.tomtom.com/maps/inspector-client.json",
    connectors: [{ name: "inspector", redirectUri: "http://127.0.0.1:8976/cb" }],
    exchangedKeysServeApi: false,
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
