export type Target = "prod" | "dev";

export type ConnectorName = "chatgpt" | "claude";

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
    ulsBaseUrl: "https://oauth.my.tomtom.com",
    authorizeClientId: "https://mcp.tomtom.com",
    connectors: CONNECTORS,
    exchangedKeysServeApi: true,
  },
  dev: {
    target: "dev",
    mcpUrl: "https://mcp-dev.api-system.tomtom.com/maps",
    ulsBaseUrl: "https://staging.oauth.my.tomtom.com",
    authorizeClientId: "https://mcp-dev.api-system.tomtom.com",
    connectors: CONNECTORS,
    // Most API services on the staging instance are not fully functional, and are expected to fail. Therefore, when testing staging, we evaluate until the exchange, but not the tool result
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
