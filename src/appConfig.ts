/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface AppConfig {
  port: number;
  baseUrl: string;
  allowedOrigins: string | undefined;
  logLevel: string;
  ciamTenantId: string | undefined;
  ciamDomain: string | undefined;
  authorizationServerUrl: string;
  ulsTokenEndpoint: string;
  tomtomApiBaseUrl: string;
}

export function getAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    /** HTTP server port */
    port: Number(env.PORT) || 3000,

    /** Base URL for the MCP API */
    baseUrl: env.MCP_BASE_URL || `http://localhost:${env.PORT || 3000}`,

    /** Comma-separated list of allowed CORS origins */
    allowedOrigins: env.ALLOWED_ORIGINS,

    /** Log level */
    logLevel: env.LOG_LEVEL || "info",

    /** CIAM tenant ID for JWT verification */
    ciamTenantId: env.CIAM_TENANT_ID,

    /** CIAM domain subdomain (e.g. "tomtomext" for tomtomext.ciamlogin.com) */
    ciamDomain: env.CIAM_DOMAIN,

    /** Authorization server base URL (e.g. https://test.oauth.my.tomtom.com) */
    authorizationServerUrl: env.AUTHORIZATION_SERVER_URL || "https://test.oauth.my.tomtom.com",

    /** ULS token exchange endpoint URL */
    ulsTokenEndpoint: env.ULS_TOKEN_ENDPOINT || "https://test.oauth.my.tomtom.com/token",

    /** TomTom API base URL */
    tomtomApiBaseUrl: env.TOMTOM_API_BASE_URL || "https://api.tomtom.com",

    /** Static TomTom API key (used when no per-session key is provided) */
    tomtomApiKey: env.TOMTOM_API_KEY,
  };
}

/**
 * Central configuration singleton for the TomTom MCP server.
 * All static values and environment-derived defaults live here.
 */
export const appConfig = getAppConfig();
