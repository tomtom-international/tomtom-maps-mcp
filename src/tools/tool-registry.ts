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
 * Modelled on the agent toolkit's `tool-registry.ts` so the two
 * surfaces can be compared field by field: `description`, `inputSchema` and
 * `examplePrompts` mean the same thing on both sides.
 * `examplePrompts` is load-bearing — the tool-selection eval suite reads it via
 * `getDefaultToolPrompts()`, so a prompt added here becomes a test on the next run.
 */

import { tomtomDataVizSchema } from "../schemas/dataViz/dataVizSchema";
import { tomtomDynamicMapSchema } from "../schemas/map/dynamicMapSchema";
import { tomtomPlanRouteSchema } from "../schemas/routing/planRouteSchema";
import {
  tomtomDiscoverPlacesSchema,
  tomtomLocatePlaceSchema,
} from "../schemas/search/discoverPlacesSchema";
import {
  tomtomPOICategoriesSchema,
  tomtomReverseGeocodeSearchSchema,
} from "../schemas/search/searchSchema";
import { omittedUnlessGeometry } from "../schemas/shared/responseOptions";
import { tomtomGetTrafficSchema } from "../schemas/traffic/trafficSchema";
import {
  getApiKeyHandler,
  getApiKeySchema,
  getAppConfigHandler,
  getAppConfigSchema,
  getAppDataHandler,
  getAppDataSchema,
  reportAppStatusHandler,
  reportAppStatusSchema,
} from "./app-tools";
import { dataVizHandler } from "./services/data-viz";
import { discoverPlacesHandler, locatePlaceHandler } from "./services/discover-places";
import { dynamicMapHandler } from "./services/dynamic-map";
import { getTrafficHandler, planRouteHandler } from "./services/plan-route";
import { poiCategoriesHandler, reverseGeocodeHandler } from "./services/search";
import type { ToolApp, ToolAppCategory, ToolEntry } from "./shared/tool-entry";

/**
 * The MCP app under dist/apps as "<category>/<app>", served as
 * ui://tomtom-<category>/<app>/app.html.
 */
const app = (category: ToolAppCategory, appName: string): ToolApp => ({
  category,
  appName,
  resourceUri: `ui://tomtom-${category}/${appName}/app.html`,
});

/** The app for every tool whose result is places, routes or a search area. */
const PLACES_AND_ROUTES_APP = app("map", "places-and-routes");

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
      "Find places — businesses, POIs, addresses — in an area, near a point, along a drive, or " +
      "anywhere. This is the search tool; use it for every 'find/list/show me X' request. " +
      "Say WHAT you are looking for with `query` (a name or brand) and/or `poiCategories` " +
      "(natural language is accepted — no separate category lookup needed), and say WHERE with " +
      "`where`: mode `within` for an area (name the city, district or neighbourhood in `queries` " +
      "and its boundary is resolved for you; pass an earlier result's `area` in `areas`; or give " +
      "a boundingBox / geometries), mode `nearby` " +
      "for a point plus radius (name a landmark in `where.query` — no locate call first), mode " +
      "`maxDetour` for stops along a drive between `locations` (every stop, in order), " +
      "listed in the order the drive reaches them or by the extra time each costs (`sortBy`), " +
      "and mode `global` for no constraint. " +
      '"Italian restaurants in Amsterdam" is one call: `poiCategories: ["italian restaurant"]` ' +
      'plus `where: { mode: "within", queries: ["Amsterdam"] }`. ' +
      "Results stop at `limit`, so narrow the query rather than counting or aggregating over " +
      "what you were shown. " +
      "A place with known opening hours says whether it is open now, its hours today and when " +
      "it next closes or opens, in its own local time (`poi.openingHours`). " +
      "To locate ONE specific named place, or to get an area's boundary polygon, use " +
      "tomtom-locate-place instead.",
    inputSchema: tomtomDiscoverPlacesSchema,
    handler: discoverPlacesHandler,
    app: PLACES_AND_ROUTES_APP,
    examplePrompts: [
      "Find Italian restaurants in Amsterdam",
      "What's around 52.3791, 4.8994?",
      "Find every bookshop inside Westminster",
      "Find EV charging stations near Utrecht",
      "Where can I stop for coffee on the drive from Amsterdam to Brussels?",
      "Find all Starbucks in Berlin",
      "Show supermarkets within 500m of the station",
    ],
  },
  {
    name: "tomtom-locate-place",
    title: "TomTom Locate Place",
    description:
      "Resolve ONE named place, address or landmark to its coordinates — and optionally its " +
      "BOUNDARY POLYGON. Use when you need a single specific place rather than a list: an address " +
      "to coordinates, a landmark's position, or a city or neighbourhood's outline. " +
      'Say where in the query itself — "Dam Square, Amsterdam" — and a match in that area wins; ' +
      "without it a global index can answer in the wrong country. " +
      'For a city, district or neighbourhood\'s boundary set `response_detail: "geometry"` — ' +
      "this is the only tool that returns one. To search inside a named area, pass the name as " +
      "`where.queries` to tomtom-discover-places, which resolves the boundary itself. " +
      "When several places share the name, the alternatives are reported so you can disambiguate " +
      "with `where` rather than silently getting the wrong one, and when nothing is named exactly " +
      "what was asked for the response says so — treat `located` as the answer, not the query. " +
      "For a LIST of matching places use tomtom-discover-places; for coordinates to an address use " +
      "tomtom-reverse-geocode. " +
      omittedUnlessGeometry("The boundary", "is"),
    inputSchema: tomtomLocatePlaceSchema,
    handler: locatePlaceHandler,
    app: PLACES_AND_ROUTES_APP,
    examplePrompts: [
      "What are the coordinates of Dam Square, Amsterdam?",
      "Where is the Eiffel Tower?",
      "Get me the boundary of De Jordaan",
      "Find the lat/lon for Damrak 1, Amsterdam",
    ],
  },
  {
    name: "tomtom-reverse-geocode",
    title: "TomTom Reverse Geocode",
    description: "Convert coordinates to addresses.",
    inputSchema: tomtomReverseGeocodeSearchSchema,
    handler: reverseGeocodeHandler,
    app: PLACES_AND_ROUTES_APP,
    examplePrompts: [
      "What address is at 52.3791, 4.8994?",
      "Which street is this coordinate on: 48.8584, 2.2945?",
    ],
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
    openWorldHint: false,
    app: PLACES_AND_ROUTES_APP,
    examplePrompts: [
      "What POI category code should I use for electric vehicle charging?",
      "Which category covers Italian restaurants?",
    ],
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
      "({ query }) or explicit coordinates ({ position }) — so there is no separate " +
      "geocoding step. " +
      "The route ALREADY CARRIES LIVE TRAFFIC: `summary.trafficDelayInSeconds` and " +
      "`summary.trafficLengthInMeters` give the delay, and `sections.traffic` lists each hold-up " +
      'along the way. Answer "any delays on this route?" from that — calling tomtom-get-traffic ' +
      "for the route's delay is a wasted hop. " +
      "Every route also lists, in driving order, its main `roads` (each by the number on its " +
      "signs, with the kind of road as `shield`: `deu-motorway` 3 is the A3) and its `countries`, " +
      "each with its length, driving time and toll-road length, and every section says where it starts " +
      "(`startsAfterMeters`) and how long it runs. Each route also gives the time usual traffic " +
      "and empty roads would take (`summary.historicTrafficTravelTimeInSeconds`, " +
      "`summary.noTrafficTravelTimeInSeconds`; `traffic.delayVersusUsualInSeconds` is today " +
      "against usual), the distance at each speed limit (`speedLimits`), its `tunnels` and " +
      "built-up length, and `guidance`: its turns, roundabouts, forks and motorway exits, " +
      "counted from its turn-by-turn instructions. Ask for more in the same call rather than " +
      "computing it: `maxAlternatives` compares each alternative with the first route (roads " +
      "only it takes, the tolls, ferries and traffic it adds or avoids, and with `curves` the " +
      "curves); `curves` measures winding roads and hairpins; `compareWithUsualRoute` says " +
      "what live traffic changed; `directions` lists the turn-by-turn steps; `insertStops` orders " +
      "extra stops; `checkpoints` says where you are after a " +
      'time or distance. `response_detail: "full"` returns the routes as the API sent them, ' +
      "without any of these summaries. " +
      omittedUnlessGeometry("The route line", "is"),
    inputSchema: tomtomPlanRouteSchema,
    handler: planRouteHandler,
    app: PLACES_AND_ROUTES_APP,
    examplePrompts: [
      "Route from Amsterdam Centraal to the Rijksmuseum",
      "How long does it take to drive from Paris to Lyon?",
      "Plan a drive from Utrecht to Maastricht via Eindhoven and Venlo",
      // Traffic on a ROUTE belongs here, not on tomtom-get-traffic: the route
      // response carries the delay and the traffic sections already.
      "Any hold-ups on the drive from Rotterdam to Amsterdam right now?",
      "Compare the route options from Amsterdam to Brussels: what does each one avoid?",
      "My passenger gets car sick. Which route from Grenoble to Briançon has the fewest sharp bends?",
      "I have to stop in Eindhoven, Utrecht and Den Bosch on the way from Amsterdam to Maastricht. In what order?",
      "Driving from Paris to Barcelona, where will I be after four hours?",
      "Is the drive from Amsterdam to Utrecht slower than usual right now?",
      "Give me turn-by-turn directions from Utrecht Centraal to the Dom Tower",
    ],
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
      'Name the city, district or neighbourhood in `where.queries` (e.g. ["Amsterdam"]) and ' +
      "incidents are confined to its boundary; a boundingBox or polygons work too. For a radius " +
      'around a landmark use mode `nearby` and NAME it in `where.query` ("Schiphol Airport") — ' +
      "no locate call first. Several areas are EACH queried and merged, counting an incident " +
      "found in two of them once. " +
      "For the delay on a drive use tomtom-plan-route instead — its result already carries the " +
      "live delay and every hold-up the route meets. For incidents NEAR a drive (both directions, " +
      "the roads alongside, planned roadworks) use mode `alongRoute` with the trip's `locations`: " +
      "it covers a corridor `withinMeters` either side, however long the drive. An area is capped " +
      "at 10,000 km². " +
      "Every result has an `incidentSummary` over ALL the incidents found: the total, the total " +
      "delay, and counts by category, magnitude and road number (`byRoad`). Read counts, totals " +
      "and per-road answers there. Dense areas hold more incidents than are shown: the visible " +
      "ones are the MOST SEVERE, ranked by delay magnitude, so the worst is the first of them, " +
      "and a count from the visible list is WRONG whenever `truncated` is true. In mode " +
      "`alongRoute` they are listed in the order the drive meets them instead, each with how far " +
      "along the drive it starts (`startsAfterMeters`). " +
      omittedUnlessGeometry("Incident locations"),
    inputSchema: tomtomGetTrafficSchema,
    handler: getTrafficHandler,
    app: app("traffic", "incidents"),
    examplePrompts: [
      "What's the traffic like in Amsterdam right now?",
      "Any accidents on the A10?",
      "Show road closures around Berlin",
      "Any roadworks within 2 km of my drive from Amsterdam to Utrecht?",
    ],
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
      "The caller gets back only a summary (the view, marker positions, route distance and time), never route lines or area outlines; " +
      "tools whose response_detail offers 'geometry' return those as GeoJSON. " +
      "Intended for map visualization: showing locations on a map, highlighting areas, or combining multiple visual elements in one view. " +
      "Not intended for route calculations (tomtom-plan-route), traffic incidents " +
      "(tomtom-get-traffic), or large-dataset visualization like heatmaps/clusters/choropleth " +
      "(tomtom-data-viz). " +
      "The optional routePlans parameter can calculate and draw routes on the map; it is meant for routes combined with other map elements (markers, polygons) in a single view. " +
      "When the markers are a SUBSET of what a search returned, say how many you drew out of how " +
      "many were found — a filtered map that does not report its own filter looks identical to an " +
      "unfiltered one.",
    inputSchema: tomtomDynamicMapSchema,
    handler: dynamicMapHandler,
    app: app("map", "dynamic-map"),
    uiOnly: true,
    examplePrompts: [
      "Show these three cities on a map",
      "Put a marker on the Eiffel Tower and outline the 1st arrondissement",
      "Draw this polygon on a map",
    ],
  },
  {
    name: "tomtom-data-viz",
    title: "TomTom Data Visualization",
    description:
      "Visualize custom GeoJSON data on a TomTom basemap. " +
      "The map is drawn by the MCP app, so the visual requires a client that supports MCP apps; the caller gets back only a summary. " +
      "Intended for large datasets, heatmaps, cluster maps, choropleth maps, or GeoJSON data (from a URL or inline) rendered on a map. " +
      "Supports markers, heatmaps, clusters, lines, polygon fills, and choropleth maps. " +
      "Provide data via HTTPS URL or inline GeoJSON. Multiple layers can be overlaid in a single call. " +
      "Point features are automatically enriched with TomTom address data when clicked (reverse geocode). " +
      "Placing a few specific markers, routes, or polygons is handled by tomtom-dynamic-map; " +
      "route calculations (directions, travel time) are handled by tomtom-plan-route. " +
      "When you draw a SUBSET of what a search returned, say how many you drew out of how many " +
      "were found — a filtered map that does not report its own filter looks identical to an " +
      "unfiltered one.",
    inputSchema: tomtomDataVizSchema,
    handler: dataVizHandler,
    app: app("data-viz", "byod"),
    uiOnly: true,
    // Its data is kept exact, so a large dataset never fits the result, and a
    // re-run fetches only the caller's data_url.
    refetch: true,
    examplePrompts: [
      "Render this GeoJSON as a heatmap",
      "Colour these delivery points by their weight on a map",
      "Cluster these 5000 points on a map",
    ],
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
    openWorldHint: false,
  },
  {
    name: "tomtom-get-app-config",
    title: "Get TomTom App Config",
    description:
      "Internal tool for apps to retrieve client configuration such as the attribution user-agent",
    inputSchema: getAppConfigSchema,
    handler: getAppConfigHandler,
    visibility: "app",
    openWorldHint: false,
  },
  {
    name: "tomtom-get-app-data",
    title: "Get App Data",
    description:
      "Internal tool for the data-viz app to get data missing from the result, by running tomtom-data-viz again",
    inputSchema: getAppDataSchema,
    handler: getAppDataHandler,
    visibility: "app",
  },
  {
    name: "tomtom-report-app-status",
    title: "Report App Status",
    description: "Internal tool for apps to report whether they drew their data",
    inputSchema: reportAppStatusSchema,
    handler: reportAppStatusHandler,
    visibility: "app",
    openWorldHint: false,
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
 * Reading an optional field (`visibility`, `app`, `refetch`) off that union
 * doesn't type-check, so anything walking the table uses this view instead.
 */
export const TOOL_ENTRIES: readonly ToolEntry[] = TOOL_REGISTRY;

const ENTRIES = TOOL_ENTRIES;

/** The tools the model sees — everything except the app-internal plumbing. */
export const DEFAULT_TOOLS: readonly ToolEntry[] = ENTRIES.filter(
  (entry) => (entry.visibility ?? "agent") === "agent"
);

/**
 * `examplePrompts` for every model-visible tool, keyed by tool name.
 *
 * The tool-selection eval suite reads this so a registry edit propagates to the
 * tests on the next run — same contract as the agent toolkit's
 * `getDefaultToolPrompts()`.
 */
export const getDefaultToolPrompts = (): Record<string, readonly string[]> =>
  Object.fromEntries(DEFAULT_TOOLS.map((entry) => [entry.name, entry.examplePrompts ?? []]));
