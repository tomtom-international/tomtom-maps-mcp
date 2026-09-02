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

import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

/**
 * CDN the MCP Apps load MapLibre GL JS from instead of bundling it (see
 * `scripts/appViteConfig.ts`). It must stay in `resourceDomains`: hosts map
 * that list to `script-src`, which also governs the imports of MapLibre's
 * worker.
 */
export const MAPLIBRE_CDN_ORIGIN = "https://cdn.jsdelivr.net";

/** Content Security Policy origins every MCP App declares to its host. */
export const APP_CSP = {
  connectDomains: ["https://api.tomtom.com", "https://*.api.tomtom.com", "blob:"],
  resourceDomains: [
    MAPLIBRE_CDN_ORIGIN,
    "https://api.tomtom.com",
    "https://*.api.tomtom.com",
    "blob:",
    "data:",
  ],
} satisfies McpUiResourceCsp;
