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

import type { Position } from "geojson";
import { metresBetween } from "../services/map/geometryUtils";

export interface CanaryCase {
  tool: string;
  arguments: Record<string, unknown>;
  check: (data: unknown) => string[];
}

interface ToolData {
  features?: {
    geometry?: { coordinates?: Position };
    properties?: { summary?: { lengthInMeters?: number } };
  }[];
  properties?: { address?: { countryCode?: string } };
  poiCategories?: unknown[];
  incidents?: unknown[];
}

const AMSTERDAM_CENTRAAL: Position = [4.9003, 52.3789];
const UTRECHT_CENTRAAL: Position = [5.1101, 52.0894];
const GEOCODE_TOLERANCE_M = 1000;
const ROUTE_KM = { min: 30, max: 60 };

const hasResults = (data: unknown) => ((data as ToolData).features?.length ? [] : ["no results"]);

export const CANARY_CASES: CanaryCase[] = [
  {
    tool: "tomtom-geocode",
    arguments: { query: "Amsterdam Centraal, Netherlands" },
    check: (data) => {
      const first = (data as ToolData).features?.[0]?.geometry?.coordinates;
      if (!first) return ["no results"];
      const metres = metresBetween(first, AMSTERDAM_CENTRAAL);
      return metres > GEOCODE_TOLERANCE_M
        ? [`first result is ${metres} m from Amsterdam Centraal, over ${GEOCODE_TOLERANCE_M} m`]
        : [];
    },
  },
  {
    tool: "tomtom-reverse-geocode",
    arguments: { position: AMSTERDAM_CENTRAAL },
    check: (data) => {
      const country = (data as ToolData).properties?.address?.countryCode;
      return country === "NL" ? [] : [`country is ${country ?? "missing"}, not NL`];
    },
  },
  {
    tool: "tomtom-fuzzy-search",
    arguments: { query: "TomTom Amsterdam" },
    check: hasResults,
  },
  {
    tool: "tomtom-poi-categories",
    arguments: { filters: ["parking"] },
    check: (data) => ((data as ToolData).poiCategories?.length ? [] : ["no categories"]),
  },
  {
    tool: "tomtom-routing",
    arguments: { locations: [AMSTERDAM_CENTRAAL, UTRECHT_CENTRAAL] },
    check: (data) => {
      const metres = (data as ToolData).features?.[0]?.properties?.summary?.lengthInMeters;
      const km = metres === undefined ? undefined : Math.round(metres / 1000);
      return km !== undefined && km >= ROUTE_KM.min && km <= ROUTE_KM.max
        ? []
        : [`route is ${km ?? "missing"} km, outside ${ROUTE_KM.min}-${ROUTE_KM.max} km`];
    },
  },
  {
    tool: "tomtom-traffic",
    arguments: { bbox: [4.8, 52.3, 4.95, 52.4] },
    check: (data) => (Array.isArray((data as ToolData).incidents) ? [] : ["no incidents list"]),
  },
];
