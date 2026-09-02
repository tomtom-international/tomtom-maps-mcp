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
 *
 * The tool registry — one row per tool, the single source of truth for the MCP
 * tool surface.
 *
 * Replaces the five `*Tools.ts` modules, which spread 18 near-identical 60-line
 * `registerAppTool` literals across 580 lines: the same annotations block copied
 * verbatim each time, resource URIs declared next to their tool in some files and
 * at the top of others, and no machine-readable record of how the tools relate.
 *
 * Deliberately modelled on the agent toolkit's `tool-registry.ts` so the two
 * surfaces can be compared field by field: `description` / `inputSchema` /
 * `tags` / `examples` / `examplePrompts` / `relatedTools` / `dependsOn` mean the
 * same thing on both sides. `examplePrompts` is load-bearing — the tool-selection
 * eval suite reads it via `getDefaultToolPrompts()`, so a prompt added here
 * becomes a test on the next run.
 */

import { tomtomDataVizSchema } from "../schemas/dataViz/dataVizSchema";
import { tomtomDynamicMapSchema } from "../schemas/map/dynamicMapSchema";
import {
  tomtomFindReachableAreasSchema,
  tomtomGetTrafficSchema,
  tomtomPlanRouteSchema,
} from "../schemas/routing/planRouteSchema";
import {
  tomtomEvRoutingSchema,
  tomtomReachableRangeSchema,
  tomtomRoutingSchema,
} from "../schemas/routing/routingSchema";
import {
  tomtomDiscoverPlacesSchema,
  tomtomLocatePlaceSchema,
} from "../schemas/search/discoverPlacesSchema";
import {
  tomtomAreaSearchSchema,
  tomtomEvSearchSchema,
  tomtomFuzzySearchSchema,
  tomtomGeocodeSearchSchema,
  tomtomNearbySearchSchema,
  tomtomPOICategoriesSchema,
  tomtomPOISearchSchema,
  tomtomReverseGeocodeSearchSchema,
  tomtomSearchAlongRouteSchema,
} from "../schemas/search/searchSchema";
import {
  getApiKeyHandler,
  getApiKeySchema,
  getAppConfigHandler,
  getAppConfigSchema,
  getDatasetHandler,
  getDatasetSchema,
} from "./app-tools";
import { dataVizHandler } from "./services/data-viz";
import { discoverPlacesHandler, locatePlaceHandler } from "./services/discover-places";
import { dynamicMapHandler } from "./services/dynamic-map";
import {
  findReachableAreasHandler,
  getTrafficHandler,
  planRouteHandler,
} from "./services/plan-route";
import { poiCategoriesHandler, reverseGeocodeHandler } from "./services/search";
import type { ToolApp, ToolEntry } from "./shared/tool-entry";

/** Builds the `ui://` resource URI + built-app location for a tool's MCP app. */
const app = (namespace: string, category: string, appName: string): ToolApp => ({
  category,
  appName,
  resourceUri: `ui://${namespace}/${appName}/app.html`,
});

/**
 * Every tool the server registers, in registration order.
 *
 * Rows are `ToolEntry` objects — see `shared/tool-entry.ts` for what each field
 * does. `annotations` is not a field: every TomTom tool is a read-only,
 * idempotent, open-world lookup, so `READ_ONLY_ANNOTATIONS` is applied to all of
 * them in `register.ts`.
 */
export const TOOL_REGISTRY = [
  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  {
    name: "tomtom-discover-places",
    title: "TomTom Discover Places",
    description:
      "Find places — businesses, POIs, addresses — anywhere, in an area, or near a point. This is " +
      "the search tool; use it for every 'find/list/show me X' request. " +
      "Say WHAT you are looking for with `query` (a name or brand) and/or `poiCategories` " +
      "(natural language is accepted — no separate category lookup needed), and say WHERE with " +
      "`where`: mode `within` for an area (name it in `queries` and its boundary is resolved for " +
      "you, or give a boundingBox / geometry / a route corridor), mode `nearby` for " +
      "a point plus radius, mode `global` for no constraint. " +
      'One call covers what used to take three — "italian restaurants in Amsterdam" is ' +
      '`poiCategories: ["italian food"]` plus `where: { mode: "within", queries: ["Amsterdam"] }`. ' +
      "EV searches with an ELECTRIC_VEHICLE_STATION category near a point include live charger " +
      "availability. Results are capped and trimmed to fit the conversation, so narrow the " +
      "query rather than counting or aggregating over what you were shown. " +
      "To locate ONE specific named place, or to get an area's boundary polygon, use " +
      "tomtom-locate-place instead.",
    inputSchema: tomtomDiscoverPlacesSchema,
    handler: discoverPlacesHandler,
    kind: "places",
    app: app("tomtom-search", "search", "poi-search"),
    tags: ["search", "discover", "place", "EV", "along-route", "coverage"],
    examplePrompts: [
      "Find Italian restaurants in Amsterdam",
      "What's around 52.3791, 4.8994?",
      "Find every bookshop inside Westminster",
      "Find EV charging stations near Utrecht with a charger free now",
      "Where can I stop for coffee along my route?",
      "Find all Starbucks in Berlin",
      "Show supermarkets within 500m of the station",
    ],
    relatedTools: ["tomtom-locate-place", "tomtom-poi-categories"],
  },
  {
    name: "tomtom-locate-place",
    title: "TomTom Locate Place",
    description:
      "Resolve ONE named place, address or landmark to its coordinates — and optionally its " +
      "BOUNDARY POLYGON. Use when you need a single specific place rather than a list: an address " +
      "to coordinates, a landmark's position, or a city or neighbourhood's outline. " +
      "Both the POI index and the geocoder are consulted and the better match is chosen, so a " +
      "name does not have to be classified correctly to be found: a result named exactly what " +
      "was asked for wins, then the place itself over a business named after it. `queryAs` only " +
      "breaks a tie. " +
      'Say where in the query itself — "Dam Square, Amsterdam" — and the lookup is confined to ' +
      "that area; without it a global index can answer in the wrong country. " +
      "Set `includeGeometry: true` to get the boundary — this is the only tool that " +
      "returns one, and its dataset_id can then be passed as `where.dataset_ids` to " +
      "tomtom-discover-places to search strictly inside that shape. " +
      "When several places share the name, the alternatives are reported so you can disambiguate " +
      "with `where` rather than silently getting the wrong one, and when nothing is named exactly " +
      "what was asked for the response says so — treat `located` as the answer, not the query. " +
      "For a LIST of matching places use tomtom-discover-places; for coordinates to an address use " +
      "tomtom-reverse-geocode.",
    inputSchema: tomtomLocatePlaceSchema,
    handler: locatePlaceHandler,
    kind: "places",
    app: app("tomtom-search", "search", "geocode"),
    tags: ["geocode", "locate", "location", "place"],
    examplePrompts: [
      "What are the coordinates of Dam Square, Amsterdam?",
      "Where is the Eiffel Tower?",
      "Get me the boundary of De Jordaan",
      "Find the lat/lon for Damrak 1, Amsterdam",
    ],
    relatedTools: ["tomtom-discover-places", "tomtom-reverse-geocode"],
  },
  {
    name: "tomtom-reverse-geocode",
    title: "TomTom Reverse Geocode",
    description: "Convert coordinates to addresses with interactive map UI",
    inputSchema: tomtomReverseGeocodeSearchSchema,
    handler: reverseGeocodeHandler,
    kind: "places",
    app: app("tomtom-search", "search", "reverse-geocode"),
    tags: ["geocode", "location"],
    examplePrompts: [
      "What address is at 52.3791, 4.8994?",
      "Which street is this coordinate on: 48.8584, 2.2945?",
    ],
    relatedTools: ["tomtom-locate-place"],
  },
  {
    name: "tomtom-poi-categories",
    title: "TomTom POI Categories",
    description:
      'Resolve natural language ("gym", "italian food", "bookstore") into POI category codes, and ' +
      "browse the vocabulary. Returns all codes when no filter is given. " +
      "Optional, and NOT a prerequisite for searching: tomtom-discover-places resolves " +
      'natural-language categories itself, so "Italian restaurants in Amsterdam" is one call to ' +
      "that tool, not a category lookup followed by a search. " +
      "Reach for this only to see what categories exist, to disambiguate a vague term before " +
      "searching, or when a search reported a category it could not resolve. " +
      "Codes are UPPER_SNAKE_CASE strings (e.g. 'ITALIAN_RESTAURANT', 'PARKING_GARAGE'), never " +
      "numeric ids; pass them, or plain words, to `poiCategories`.",
    inputSchema: tomtomPOICategoriesSchema,
    handler: poiCategoriesHandler,
    app: app("tomtom-search", "search", "poi-categories"),
    tags: ["utilities", "search"],
    examplePrompts: [
      "What POI category code should I use for electric vehicle charging?",
      "Which category covers Italian restaurants?",
    ],
    relatedTools: ["tomtom-discover-places"],
  },

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------
  {
    name: "tomtom-plan-route",
    title: "TomTom Plan Route",
    description:
      "Calculate a driving route through an ordered list of locations. Use this for any directions, " +
      "travel-time or distance question, whether A-to-B or a multi-stop itinerary. " +
      "Name the places directly — each entry in `locations` is a place NAME " +
      "({ query, queryAs }), explicit coordinates ({ position }), or a place you already found " +
      "({ dataset_id }) — so there is no separate geocoding step. " +
      "For an electric vehicle, add `ev` with the battery state and charging stops are inserted " +
      "automatically; omit it for a normal route. " +
      "The route ALREADY CARRIES LIVE TRAFFIC: `summary.trafficDelayInSeconds` and " +
      "`summary.trafficLengthInMeters` give the delay, and `sections.traffic` lists each hold-up " +
      'along the way. Answer "any delays on this route?" from that — calling tomtom-get-traffic ' +
      "for a route is a wasted hop, and for a long route it fails outright. " +
      "The route is stored: pass its dataset_id to tomtom-discover-places as `where.route` to find " +
      "places along it without recalculating.",
    inputSchema: tomtomPlanRouteSchema,
    handler: planRouteHandler,
    kind: "routes",
    app: app("tomtom-plan-route", "routing", "route-planner"),
    tags: ["route", "waypoint", "location", "EV"],
    examplePrompts: [
      "Route from Amsterdam Centraal to the Rijksmuseum",
      "How long does it take to drive from Paris to Lyon?",
      "Plan a drive from A to B via C and D",
      "Plan an EV route from Amsterdam to Munich with charging stops",
      "Where should I charge on the drive from Berlin to Vienna?",
      // Traffic on a ROUTE belongs here, not on tomtom-get-traffic: the route
      // response carries the delay and the traffic sections already.
      "Any hold-ups on my route?",
    ],
    relatedTools: ["tomtom-find-reachable-areas", "tomtom-get-traffic", "tomtom-discover-places"],
  },
  {
    name: "tomtom-find-reachable-areas",
    title: "TomTom Find Reachable Areas",
    description:
      "Compute the area reachable from one or more origins within a time, distance, energy or fuel " +
      "budget — an isochrone. " +
      "Name the origins directly (`{ query, queryAs }`, `{ position }` or `{ dataset_id }`), and " +
      "pass SEVERAL budgets in one call for nested rings (10, 20 and 30 minutes) rather than one " +
      "call each. " +
      "The resulting polygons are stored: pass the dataset_id as `where.dataset_ids` to " +
      "tomtom-discover-places to find places INSIDE the reachable area — which is the question this " +
      "usually precedes. " +
      "This is not a route; for directions use tomtom-plan-route.",
    inputSchema: tomtomFindReachableAreasSchema,
    handler: findReachableAreasHandler,
    kind: "ranges",
    app: app("tomtom-plan-route", "routing", "reachable-range"),
    tags: ["reachable-range", "isochrone", "range", "coverage", "EV"],
    examplePrompts: [
      "How far can I drive from Amsterdam in 30 minutes?",
      "Show the area reachable within 50km of the city centre",
      "Give me 10, 20 and 30-minute isochrones from the depot",
      "What's within a 20-minute drive of the airport?",
    ],
    relatedTools: ["tomtom-discover-places", "tomtom-plan-route"],
  },

  // ---------------------------------------------------------------------------
  // Traffic
  // ---------------------------------------------------------------------------
  {
    name: "tomtom-get-traffic",
    title: "TomTom Get Traffic",
    description:
      "Report current traffic incidents — accidents, closures, jams, roadworks — for an area. " +
      "Use this first for any question about traffic, delays or road conditions. " +
      'Name the area in `where.queries` (e.g. ["Amsterdam"]) and it is resolved for you; a ' +
      "boundingBox or a stored reachable-range dataset work too. " +
      "Several areas — several names, or one isochrone's rings — are EACH queried and merged, " +
      "counting an incident found in two of them once. " +
      "For traffic ON A ROUTE use tomtom-plan-route instead — its result already carries the live " +
      "delay and every traffic section along the way. This tool covers AREAS, and the traffic API " +
      "caps an area at 10,000 km², which the span of a long route exceeds. " +
      "Dense areas return far more incidents than are shown. The visible ones are the MOST SEVERE, " +
      "ranked by delay magnitude, so the worst incident is the first of them. A count, total or " +
      "per-road breakdown computed from the visible list is WRONG whenever the area was capped; " +
      "narrow the area instead. " +
      "Incidents are drawn on an interactive map; do not plot them with tomtom-dynamic-map.",
    inputSchema: tomtomGetTrafficSchema,
    handler: getTrafficHandler,
    kind: "incidents",
    app: app("tomtom-get-traffic", "traffic", "incidents"),
    tags: ["traffic"],
    examplePrompts: [
      "What's the traffic like in Amsterdam right now?",
      "Any accidents on the A10?",
      "Show road closures around Berlin",
    ],
    relatedTools: ["tomtom-plan-route"],
  },

  // ---------------------------------------------------------------------------
  // Map + visualization
  // ---------------------------------------------------------------------------
  {
    name: "tomtom-dynamic-map",
    title: "TomTom Dynamic Map",
    description:
      "Render an interactive map with markers, drawn lines, polygons, and area overlays. " +
      "The map is drawn by the MCP app, so the visual requires a client that supports MCP apps. " +
      "Use this for MAP VISUALIZATION: showing locations on a map, highlighting areas, or combining multiple visual elements in one view. " +
      "Do NOT use this for: route calculations (use tomtom-plan-route), traffic incidents (use " +
      "tomtom-get-traffic), or large-dataset visualization like heatmaps/clusters/choropleth (use " +
      "tomtom-data-viz). " +
      "The optional routePlans parameter can calculate and draw routes on the map, but only use it when you need routes combined with other map elements (markers, polygons) in a single view. " +
      "When the markers are a SUBSET of what a search returned, say how many you drew out of how " +
      "many were found — a filtered map that does not report its own filter looks identical to an " +
      "unfiltered one.",
    inputSchema: tomtomDynamicMapSchema,
    handler: dynamicMapHandler,
    kind: "mapState",
    app: app("tomtom-map", "map", "dynamic-map"),
    tags: ["visualization", "map style", "location"],
    examplePrompts: [
      "Show these three cities on a map",
      "Put a marker on the Eiffel Tower and outline the 1st arrondissement",
      "Draw this polygon on a map",
    ],
    relatedTools: ["tomtom-data-viz", "tomtom-plan-route"],
  },
  {
    name: "tomtom-data-viz",
    title: "TomTom Data Visualization",
    description:
      "Visualize custom GeoJSON data on an interactive TomTom basemap. " +
      "Use this for LARGE DATASETS, heatmaps, cluster maps, choropleth maps, or when you have GeoJSON data (from a URL or inline) to render on a map. " +
      "Supports markers, heatmaps, clusters, lines, polygon fills, and choropleth maps. " +
      "Provide data via HTTPS URL or inline GeoJSON. Multiple layers can be overlaid in a single call. " +
      "Point features are automatically enriched with TomTom address data when clicked (reverse geocode). " +
      "For placing a few specific markers, routes, or polygons, use tomtom-dynamic-map instead. " +
      "For route calculations (directions, travel time), use tomtom-plan-route. " +
      "When you draw a SUBSET of what a search returned, say how many you drew out of how many " +
      "were found — a filtered map that does not report its own filter looks identical to an " +
      "unfiltered one.",
    inputSchema: tomtomDataVizSchema,
    handler: dataVizHandler,
    kind: "byod",
    app: app("tomtom-data-viz", "data-viz", "byod"),
    tags: ["visualization"],
    examplePrompts: [
      "Render this GeoJSON as a heatmap",
      "Make a choropleth of population by district from this dataset",
      "Cluster these 5000 points on a map",
    ],
    relatedTools: ["tomtom-dynamic-map"],
  },

  // ---------------------------------------------------------------------------
  // App-internal (hidden from the model)
  // ---------------------------------------------------------------------------
  {
    name: "tomtom-get-api-key",
    title: "Get TomTom API Key",
    description: "Internal tool for apps to retrieve the TomTom API key",
    inputSchema: getApiKeySchema,
    handler: getApiKeyHandler,
    visibility: "app",
    tags: ["app"],
  },
  {
    name: "tomtom-get-app-config",
    title: "Get TomTom App Config",
    description:
      "Internal tool for apps to retrieve client configuration such as the attribution user-agent",
    inputSchema: getAppConfigSchema,
    handler: getAppConfigHandler,
    visibility: "app",
    tags: ["app"],
  },
  {
    name: "tomtom-get-dataset",
    title: "Get Dataset",
    description: "Internal tool for apps to retrieve a stored dataset's full payload by dataset_id",
    inputSchema: getDatasetSchema,
    handler: getDatasetHandler,
    visibility: "app",
    tags: ["app"],
  },
] as const satisfies readonly ToolEntry[];

/** Union of every registered tool name. */
export type ToolName = (typeof TOOL_REGISTRY)[number]["name"];

/** Every registered tool name. */
export const TOOL_NAMES: readonly ToolName[] = TOOL_REGISTRY.map((entry) => entry.name);

/**
 * The rows widened to {@link ToolEntry} — the view to ITERATE over.
 *
 * `TOOL_REGISTRY` is `as const` so `ToolName` can be derived from it, which
 * means each row's literal type carries only the fields that row actually set.
 * Reading an optional field (`visibility`, `app`, `relatedTools`) off that union
 * doesn't type-check, so anything walking the table uses this view instead.
 */
export const TOOL_ENTRIES: readonly ToolEntry[] = TOOL_REGISTRY;

const ENTRIES = TOOL_ENTRIES;

/** The tools the model sees — everything except the app-internal plumbing. */
export const DEFAULT_TOOLS: readonly ToolEntry[] = ENTRIES.filter(
  (entry) => (entry.visibility ?? "agent") === "agent"
);

/** Look up one row by name. */
export const getToolEntry = (name: string): ToolEntry | undefined =>
  ENTRIES.find((entry) => entry.name === name);

/**
 * `examplePrompts` for every model-visible tool, keyed by tool name.
 *
 * The tool-selection eval suite reads this so a registry edit propagates to the
 * tests on the next run — same contract as the agent toolkit's
 * `getDefaultToolPrompts()`.
 */
export const getDefaultToolPrompts = (): Record<string, readonly string[]> =>
  Object.fromEntries(DEFAULT_TOOLS.map((entry) => [entry.name, entry.examplePrompts ?? []]));
