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

/**
 * Central configuration singleton for the TomTom MCP server.
 * All static values and environment-derived defaults live here.
 */
export const appConfig = {
  /** TomTom Maps API base URL */
  tomtomApiBaseUrl: "https://api.tomtom.com",

  /** Public base URL of this MCP server */
  mcpBaseUrl: "https://mcp.tomtom.com",

  /** OAuth authorization server for this resource */
  authorizationServer: "https://access.tomtom.com",

  /** OAuth scopes supported by this resource */
  scopesSupported: ["mcp:tools", "mcp:resources"],

  /** HTTP server port */
  port: Number(process.env.PORT) || 3000,

  /** Comma-separated list of allowed CORS origins */
  allowedOrigins: process.env.ALLOWED_ORIGINS,

  /** Log level */
  logLevel: process.env.LOG_LEVEL || "info",
} as const;