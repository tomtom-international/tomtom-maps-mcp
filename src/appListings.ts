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

// Test fixture: every tool's place in tools/list, spelled out so a new tool must take one here.

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const PLACES_AND_ROUTES = "ui://tomtom-map/places-and-routes/app.html";
export const TRAFFIC_INCIDENTS = "ui://tomtom-traffic/incidents/app.html";
export const DYNAMIC_MAP = "ui://tomtom-map/dynamic-map/app.html";
export const DATA_VIZ = "ui://tomtom-data-viz/byod/app.html";

type Listing = "app-only" | { app: string; showUi: boolean; uiOnly?: true };

const TOOLS_LIST: Record<string, Listing> = {
  "tomtom-get-api-key": "app-only",
  "tomtom-get-app-config": "app-only",
  "tomtom-get-app-data": "app-only",
  "tomtom-report-app-status": "app-only",
  "tomtom-geocode": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-reverse-geocode": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-fuzzy-search": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-poi-search": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-nearby": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-poi-categories": { app: PLACES_AND_ROUTES, showUi: false },
  "tomtom-area-search": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-ev-search": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-search-along-route": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-routing": { app: PLACES_AND_ROUTES, showUi: true },
  "tomtom-traffic": { app: TRAFFIC_INCIDENTS, showUi: true },
  "tomtom-dynamic-map": { app: DYNAMIC_MAP, showUi: true, uiOnly: true },
  "tomtom-data-viz": { app: DATA_VIZ, showUi: true, uiOnly: true },
};

const ROWS = Object.entries(TOOLS_LIST);

export const UI_ONLY_TOOLS = ROWS.filter(([, row]) => row === "app-only" || row.uiOnly).map(
  ([tool]) => tool
);

export const APP_URIS = [
  ...new Set(ROWS.flatMap(([, row]) => (row === "app-only" ? [] : [row.app]))),
];

function listedForApps(row: Listing): unknown {
  if (row === "app-only") return { _meta: { ui: { visibility: ["app"] } }, showUi: false };
  return {
    _meta: { "ui/resourceUri": row.app, ui: { resourceUri: row.app } },
    showUi: row.showUi,
  };
}

export const LISTED_FOR_APPS = Object.fromEntries(
  ROWS.map(([tool, row]) => [tool, listedForApps(row)])
);

export const LISTED_FOR_TEXT_ONLY = Object.fromEntries(
  ROWS.filter(([tool]) => !UI_ONLY_TOOLS.includes(tool)).map(([tool]) => [
    tool,
    { _meta: {}, showUi: false },
  ])
);

export function listed(tools: Tool[]): Record<string, unknown> {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      { _meta: tool._meta, showUi: Boolean(tool.inputSchema.properties?.show_ui) },
    ])
  );
}
