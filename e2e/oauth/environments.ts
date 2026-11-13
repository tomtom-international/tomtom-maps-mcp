export type Target = "prod" | "dev" | "local";

export type UlsEnv = "staging" | "prod";

export type ClientName = "chatgpt" | "claude" | "inspector";

export interface Connector {
  name: ClientName;
  redirectUri: string;
}

interface Deployment {
  target: Target;
  mcpUrl: string;
  authorizeClientId: string;
  connectors: Connector[];
}

interface UlsProfile {
  authorizationServer: string;
  exchangedKeysServeApi: boolean;
}

export type Environment = Deployment & UlsProfile & { ulsEnv: UlsEnv };

const CONNECTORS: Connector[] = [
  { name: "chatgpt", redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" },
  { name: "claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" },
];

const DEPLOYMENTS: Record<Target, Deployment> = {
  prod: {
    target: "prod",
    mcpUrl: "https://mcp.tomtom.com/maps",
    authorizeClientId: "https://mcp.tomtom.com",
    connectors: CONNECTORS,
  },
  dev: {
    target: "dev",
    mcpUrl: "https://mcp-dev.api-system.tomtom.com/maps",
    authorizeClientId: "https://mcp-dev.api-system.tomtom.com",
    connectors: CONNECTORS,
  },
  local: {
    target: "local",
    mcpUrl: "http://localhost:3000/mcp",
    authorizeClientId: "https://mcp-dev.api-system.tomtom.com/maps/inspector-client.json",
    connectors: [{ name: "inspector", redirectUri: "http://127.0.0.1:8976/cb" }],
  },
};

const ULS_PROFILES: Record<UlsEnv, UlsProfile> = {
  staging: {
    authorizationServer: "https://staging.oauth.my.tomtom.com",
    // ULS staging issues keys for APIM test, where most API services do not answer.
    exchangedKeysServeApi: false,
  },
  prod: {
    authorizationServer: "https://oauth.my.tomtom.com",
    exchangedKeysServeApi: true,
  },
};

const TARGET_VARIABLE = "OAUTH_E2E_TARGET";
const ULS_ENV_VARIABLE = "OAUTH_E2E_ULS_ENV";

export function environmentFromEnv(env: NodeJS.ProcessEnv = process.env): Environment {
  const target = choice(env, TARGET_VARIABLE, DEPLOYMENTS);
  const ulsEnv = choice(env, ULS_ENV_VARIABLE, ULS_PROFILES);
  if (target === "prod" && ulsEnv !== "prod") {
    throw new Error(
      `${ULS_ENV_VARIABLE} is "${ulsEnv}" but prod signs in through ULS prod only; unset it or use prod`
    );
  }
  return { ...DEPLOYMENTS[target], ...ULS_PROFILES[ulsEnv], ulsEnv };
}

function choice<K extends string>(env: NodeJS.ProcessEnv, variable: string, options: Record<K, unknown>): K {
  const value = env[variable] ?? "prod";
  if (!(value in options)) {
    throw new Error(`${variable} is "${value}"; use one of ${Object.keys(options).join(", ")}`);
  }
  return value as K;
}
