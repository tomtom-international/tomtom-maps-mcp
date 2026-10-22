/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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

export const SCOPES_SUPPORTED = ["mcp:tools", "mcp:resources"];

export const ENDPOINT_MCP = "mcp";
export const ENDPOINT_HEALTH = "health";
export const ENDPOINT_OAUTH_PROTECTED_RESOURCE = ".well-known/oauth-protected-resource";
export const ENDPOINT_OAUTH_CLIENT_METADATA = ".well-known/oauth-client-metadata";
export const ENDPOINT_TEST_AUTHORIZE_CLIENT = "inspector-client.json";
export const UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;

/** Tool result `_meta` key carrying an MCP App's data inline (CONTEXT.md, App data). */
export const APP_DATA_META_KEY = "com.tomtom/app-data";

/** Where an app's drawn data came from, as it reports to `tomtom-report-app-status`. */
export const APP_DATA_SOURCES = ["inline", "fetched", "response", "input"] as const;

/** Why an app calls `tomtom-get-app-data`: no inline app data, or inline data it couldn't decode. */
export const APP_DATA_FETCH_REASONS = ["not_inline", "decode_failed"] as const;

/** What an app reports to `tomtom-report-app-status`. */
export const APP_STATUSES = ["drawn", "failed"] as const;

/** Where an app that failed was: loading its data, or drawing it. */
export const APP_FAILURE_STAGES = ["data", "draw"] as const;
