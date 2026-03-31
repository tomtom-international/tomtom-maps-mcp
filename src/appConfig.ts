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

export function getAppConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    /** HTTP server port */
    port: Number(env.PORT) || 3000,

    /** Base URL for the MCP API */
    baseUrl: env.MCP_BASE_URL || `http://localhost:${env.PORT || 3000}`,

    /** Comma-separated list of allowed CORS origins */
    allowedOrigins: env.ALLOWED_ORIGINS,

    /** Log level */
    logLevel: env.LOG_LEVEL || "info",

    /** CIAM tenant ID for JWT verification and OBO flow */
    ciamTenantId: env.CIAM_TENANT_ID,

    /** CIAM domain subdomain (e.g. "tomtomext" for tomtomext.ciamlogin.com) */
    ciamDomain: env.CIAM_DOMAIN,

    /** MCP server's Entra app registration client ID */
    entraClientId: env.ENTRA_CLIENT_ID,

    /** MCP server's Entra app registration client secret */
    entraClientSecret: env.ENTRA_CLIENT_SECRET,

    /** Account API base URL */
    accountApiBaseUrl: env.ACCOUNT_API_BASE_URL || "https://account.cx.tomtom.com",

    /** Account API OBO scope */
    accountApiScope: env.ACCOUNT_API_SCOPE || "https://account.cx.tomtom.com/authorize",

    /** APIM API base URL */
    apimApiBaseUrl: env.APIM_API_BASE_URL || "https://apim.cx.tomtom.com",

    /** APIM API OBO scope */
    apimApiScope: env.APIM_API_SCOPE || "https://apim.cx.tomtom.com/authorize",

    /** TomTom API base URL */
    tomtomApiBaseUrl: env.TOMTOM_API_BASE_URL || "https://api.tomtom.com",
  };
}

/**
 * Central configuration singleton for the TomTom MCP server.
 * All static values and environment-derived defaults live here.
 */
export const appConfig = getAppConfig();
