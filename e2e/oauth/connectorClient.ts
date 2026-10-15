import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Connector, Environment } from "./environments";

export interface AuthorizationRequest {
  url: URL;
  state: string;
}

// ULS rejects a state shorter than 32 characters; the SDK sends none unless the provider supplies one.
const STATE_BYTES = 32;

export class FakeOAuthClientProvider implements OAuthClientProvider {
  private readonly stateValue = randomBytes(STATE_BYTES).toString("base64url");
  private verifier?: string;
  private savedTokens?: OAuthTokens;
  private authorization?: AuthorizationRequest;

  constructor(
    private readonly clientId: string,
    private readonly connector: Connector
  ) {}

  get redirectUrl(): string {
    return this.connector.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: clientInfoName(this.connector),
      redirect_uris: [this.connector.redirectUri],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformation {
    return { client_id: this.clientId };
  }

  tokens(): OAuthTokens | undefined {
    return this.savedTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.savedTokens = tokens;
  }

  redirectToAuthorization(url: URL): void {
    this.authorization = { url, state: this.stateValue };
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error("no PKCE verifier was saved before the code arrived");
    return this.verifier;
  }

  authorizationRequest(): AuthorizationRequest {
    if (!this.authorization) throw new Error("the SDK asked for no authorization");
    return this.authorization;
  }
}

export function fakeOAuthClientProvider(env: Environment, connector: Connector): FakeOAuthClientProvider {
  return new FakeOAuthClientProvider(env.authorizeClientId, connector);
}

export function connectorTransport(
  env: Environment,
  provider: FakeOAuthClientProvider
): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(env.mcpUrl), { authProvider: provider });
}

export function connectorClient(connector: Connector): Client {
  return new Client({ name: clientInfoName(connector), version: "0" });
}

function clientInfoName(connector: Connector): string {
  return `oauth-e2e-${connector.name}`;
}
