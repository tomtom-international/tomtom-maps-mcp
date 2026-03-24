#!/usr/bin/env node
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
 * HTTP Integration Test for TomTom MCP Server Tools
 *
 * Starts the HTTP server, calls ALL tools via MCP-over-HTTP (SSE),
 * validates response structures deeply, and tests both compact/full modes.
 *
 * Usage:
 *   node tests/test-http-tools.js [toolName] [--verbose] [--backend=tomtom-orbis-maps]
 *
 * Examples:
 *   node tests/test-http-tools.js                              # Test all tools, both backends
 *   node tests/test-http-tools.js tomtom-ev-routing             # Test single tool
 *   node tests/test-http-tools.js --backend=tomtom-orbis-maps   # Test orbis only
 *   node tests/test-http-tools.js --verbose                     # Show full responses
 */

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// CLI args
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const backendArg = args.find((a) => a.startsWith("--backend="));
const BACKEND_FILTER = backendArg ? backendArg.split("=")[1] : null;
const TOOL_FILTER = args.find((a) => !a.startsWith("--"));

const PORT = 3999;
const API_KEY = process.env.TOMTOM_API_KEY;

if (!API_KEY) {
  console.error("Missing TOMTOM_API_KEY in environment or .env file");
  process.exit(1);
}

// ─── Deep Validators ─────────────────────────────────────────────────────────
// Each returns null on success, or an error string on failure.

/**
 * Validate standard search response (geocode, fuzzy-search, poi-search, nearby).
 * Expected: { summary: { numResults }, results: [{ position, address, poi? }] }
 */
function validateSearchResponse(data, mode, expectPoi = false) {
  const errors = [];
  if (!data.summary) errors.push("missing summary");
  else if (typeof data.summary.numResults !== "number") errors.push("summary.numResults not a number");

  if (!Array.isArray(data.results)) return "missing results array";
  if (data.results.length === 0) return "empty results array";

  const r = data.results[0];
  if (!r.position) errors.push("result[0] missing position");
  else {
    if (typeof r.position.lat !== "number") errors.push("position.lat not a number");
    if (typeof r.position.lon !== "number") errors.push("position.lon not a number");
  }
  if (!r.address) errors.push("result[0] missing address");
  else if (!r.address.freeformAddress && !r.address.streetName) errors.push("address missing freeformAddress/streetName");

  if (expectPoi) {
    if (!r.poi) errors.push("result[0] missing poi object");
    else if (!r.poi.name) errors.push("poi.name missing");
  }

  if (mode === "compact") {
    if (r.dataSources) errors.push("compact should not have dataSources");
    if (r.matchConfidence) errors.push("compact should not have matchConfidence");
  }

  return errors.length > 0 ? errors.join("; ") : null;
}

/**
 * Validate SDK search response (Orbis GeoJSON FeatureCollection).
 * Expected: { type: "FeatureCollection", features: [{ properties: { address, poi? } }] }
 */
function validateGeoJSONSearchResponse(data, mode, expectPoi = false) {
  if (data.type !== "FeatureCollection") return `expected FeatureCollection, got ${data.type}`;
  if (!Array.isArray(data.features)) return "missing features array";
  if (data.features.length === 0) return "empty features array";

  const f = data.features[0];
  if (!f.geometry) return "feature[0] missing geometry";
  if (!f.properties) return "feature[0] missing properties";
  if (!f.properties.address) return "feature[0] missing address";

  if (expectPoi) {
    if (!f.properties.poi?.name) return "feature[0] missing poi.name";
  }

  return null;
}

/**
 * Validate reverse geocode response (Genesis REST format).
 * Expected: { summary, addresses: [{ address: { freeformAddress } }] }
 */
function validateReverseGeocodeResponse(data, mode) {
  if (!data.summary) return "missing summary";
  if (!Array.isArray(data.addresses)) return "missing addresses array";
  if (data.addresses.length === 0) return "empty addresses array";

  const a = data.addresses[0];
  if (!a.address) return "addresses[0] missing address";
  if (!a.address.freeformAddress && !a.address.streetName) return "address missing freeformAddress/streetName";

  return null;
}

/**
 * Validate reverse geocode response (Orbis SDK GeoJSON Feature).
 * Expected: { type: "Feature", properties: { address: { freeformAddress } } }
 */
function validateGeoJSONReverseGeocodeResponse(data, mode) {
  if (data.type !== "Feature") return `expected Feature, got ${data.type}`;
  if (!data.properties) return "missing properties";
  if (!data.properties.address) return "missing properties.address";
  const addr = data.properties.address;
  if (!addr.freeformAddress && !addr.streetName) return "address missing freeformAddress/streetName";

  return null;
}

/**
 * Validate routing response (standard routing, waypoint routing).
 * Genesis: { routes: [{ summary, legs }] }
 * Orbis: { routes: [{ summary, legs }] } or { features: [...] }
 */
function validateRoutingResponse(data, mode, isWaypoint = false) {
  // Orbis might return GeoJSON FeatureCollection
  if (data.features && Array.isArray(data.features)) {
    if (data.features.length === 0) return "empty features array";
    const f = data.features[0];
    const summary = f.properties?.summary || f.summary;
    if (summary) {
      if (typeof summary.lengthInMeters !== "number") return "features[0] summary.lengthInMeters not a number";
      if (typeof summary.travelTimeInSeconds !== "number") return "features[0] summary.travelTimeInSeconds not a number";
    }
    return null;
  }

  // Standard routes format
  if (!Array.isArray(data.routes)) return "missing routes array (and no features)";
  if (data.routes.length === 0) return "empty routes array";

  const route = data.routes[0];
  if (!route.summary) return "routes[0] missing summary";
  if (typeof route.summary.lengthInMeters !== "number") return "summary.lengthInMeters not a number";
  if (typeof route.summary.travelTimeInSeconds !== "number") return "summary.travelTimeInSeconds not a number";

  if (!Array.isArray(route.legs)) return "routes[0] missing legs array";
  if (route.legs.length === 0) return "empty legs array";

  if (isWaypoint && route.legs.length < 2) return `expected multiple legs for waypoint routing, got ${route.legs.length}`;

  return null;
}

/**
 * Validate reachable range response (Genesis REST format).
 * Expected: { reachableRange: { boundary: { ... } } }
 */
function validateReachableRangeResponse(data, mode) {
  if (!data.reachableRange) return "missing reachableRange";
  if (!data.reachableRange.center) return "missing reachableRange.center";
  // boundary may not be present if the API couldn't compute a full range polygon
  return null;
}

/**
 * Validate reachable range response (Orbis SDK GeoJSON FeatureCollection format).
 * Expected: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", ... } }, ...] }
 * Multiple concentric range polygons at different budget levels.
 */
function validateGeoJSONReachableRangeResponse(data, mode) {
  if (data.type !== "FeatureCollection") return `expected FeatureCollection, got ${data.type}`;
  if (!Array.isArray(data.features)) return "missing features array";
  if (data.features.length === 0) return "features array is empty";

  // Validate first feature is a Polygon
  const first = data.features[0];
  if (first.type !== "Feature") return `expected Feature in features[0], got ${first.type}`;
  if (!first.geometry) return "missing geometry in features[0]";
  if (first.geometry.type !== "Polygon") return `expected Polygon geometry, got ${first.geometry.type}`;
  if (mode === "full") {
    if (!Array.isArray(first.geometry.coordinates)) return "missing geometry.coordinates in features[0]";
    if (first.geometry.coordinates[0]?.length < 3) return "polygon has too few points";
  }
  return null;
}

/**
 * Validate traffic response.
 * Expected: { incidents: [...] }
 */
function validateTrafficResponse(data, mode) {
  if (!data.hasOwnProperty("incidents")) return "missing incidents key";
  if (!Array.isArray(data.incidents)) return "incidents is not an array";
  // incidents can be empty (no traffic issues), that's fine
  if (data.incidents.length > 0) {
    const inc = data.incidents[0];
    if (!inc.properties && !inc.type) return "incident[0] missing properties/type";
  }
  return null;
}

/**
 * Validate EV search response (orbis only, GeoJSON).
 * Expected: { type: "FeatureCollection", features: [{ properties: { poi, address, chargingPark } }] }
 */
function validateEvSearchResponse(data, mode) {
  if (data.type !== "FeatureCollection") return `expected FeatureCollection, got ${data.type}`;
  if (!Array.isArray(data.features)) return "missing features array";
  if (data.features.length === 0) return "empty features array";

  const f = data.features[0];
  if (!f.geometry) return "feature[0] missing geometry";
  if (f.geometry.type !== "Point") return `expected Point geometry, got ${f.geometry.type}`;
  if (!f.properties) return "feature[0] missing properties";
  if (!f.properties.poi?.name) return "feature[0] missing poi.name";
  if (!f.properties.address) return "feature[0] missing address";
  if (!f.properties.chargingPark) return "feature[0] missing chargingPark";

  if (mode === "compact") {
    if (f.properties.dataSources) return "compact should not have dataSources";
  }
  return null;
}

/**
 * Validate area search response (orbis only, GeoJSON).
 * Expected: { type: "FeatureCollection", features: [{ properties: { poi, address } }] }
 */
function validateAreaSearchResponse(data, mode) {
  if (data.type !== "FeatureCollection") return `expected FeatureCollection, got ${data.type}`;
  if (!Array.isArray(data.features)) return "missing features array";
  if (data.features.length === 0) return "empty features array";

  const f = data.features[0];
  if (!f.geometry) return "feature[0] missing geometry";
  if (!f.properties) return "feature[0] missing properties";
  if (!f.properties.poi?.name) return "feature[0] missing poi.name";
  if (!f.properties.address) return "feature[0] missing address";

  if (mode === "compact") {
    if (f.properties.dataSources) return "compact should not have dataSources";
    if (f.properties.entryPoints) return "compact should not have entryPoints";
  }
  return null;
}

/**
 * Validate EV routing response (orbis only, GeoJSON).
 * Expected: { type: "FeatureCollection", features: [{ properties: { summary } }] }
 */
function validateEvRoutingResponse(data, mode) {
  if (data.type !== "FeatureCollection") return `expected FeatureCollection, got ${data.type}`;
  if (!Array.isArray(data.features)) return "missing features array";
  if (data.features.length === 0) return "empty features array";

  const f = data.features[0];
  if (!f.geometry) return "feature[0] missing geometry";
  if (!f.properties) return "feature[0] missing properties";

  const summary = f.properties.summary;
  if (!summary) return "feature[0] missing summary";
  if (typeof summary.lengthInMeters !== "number") return "summary.lengthInMeters not a number";
  if (typeof summary.travelTimeInSeconds !== "number") return "summary.travelTimeInSeconds not a number";

  if (mode === "compact") {
    if (f.geometry.coordinates?.length > 10) return "compact should have trimmed coordinates";
  }
  return null;
}

/**
 * Validate search along route response (orbis only).
 * Expected: { route: { features }, pois: { features }, summary }
 */
function validateSearchAlongRouteResponse(data, mode) {
  if (!data.route) return "missing route";
  if (!data.route.features || !Array.isArray(data.route.features)) return "missing route.features";

  if (!data.pois) return "missing pois";
  if (!data.pois.features || !Array.isArray(data.pois.features)) return "missing pois.features";
  if (data.pois.features.length === 0) return "empty pois.features array";

  const poi = data.pois.features[0];
  if (!poi.properties?.poi?.name) return "poi feature[0] missing poi.name";
  if (!poi.properties?.address) return "poi feature[0] missing address";

  if (!data.summary) return "missing summary";
  if (typeof data.summary.corridorWidthMeters !== "number") return "summary.corridorWidthMeters not a number";

  if (mode === "compact") {
    if (poi.properties.dataSources) return "compact poi should not have dataSources";
  }
  return null;
}

/**
 * Validate image response from SSE content (static-map, dynamic-map).
 */
function validateImageResponse(content) {
  const img = content.find((c) => c.type === "image");
  if (!img) return "no image content in response";
  if (!img.mimeType || !img.mimeType.startsWith("image/")) return `invalid mimeType: ${img.mimeType}`;
  if (!img.data || img.data.length < 100) return "image data too small";
  return null;
}

// ─── Test Scenarios ─────────────────────────────────────────────────────────

const ORBIS_SCENARIOS = {
  // ── Search tools ──────────────────────────────────────
  // Orbis SDK returns GeoJSON FeatureCollection, not { summary, results }
  "tomtom-geocode": [
    {
      name: "Geocode compact",
      params: { query: "Amsterdam Central Station", limit: 3, language: "en-US", response_detail: "compact" },
      validate: (data) => validateGeoJSONSearchResponse(data, "compact"),
    },
    {
      name: "Geocode full",
      params: { query: "Amsterdam Central Station", limit: 3, language: "en-US", response_detail: "full" },
      validate: (data) => validateGeoJSONSearchResponse(data, "full"),
    },
  ],

  "tomtom-reverse-geocode": [
    {
      name: "Reverse geocode compact",
      params: { position: [4.8897, 52.374], language: "en-US", response_detail: "compact" },
      validate: (data) => validateGeoJSONReverseGeocodeResponse(data, "compact"),
    },
    {
      name: "Reverse geocode full",
      params: { position: [4.8897, 52.374], language: "en-US", response_detail: "full" },
      validate: (data) => validateGeoJSONReverseGeocodeResponse(data, "full"),
    },
  ],

  "tomtom-fuzzy-search": [
    {
      name: "Fuzzy search compact",
      params: { query: "restaurants in Amsterdam", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "compact" },
      validate: (data) => validateGeoJSONSearchResponse(data, "compact"),
    },
    {
      name: "Fuzzy search full",
      params: { query: "restaurants in Amsterdam", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "full" },
      validate: (data) => validateGeoJSONSearchResponse(data, "full"),
    },
  ],

  "tomtom-poi-search": [
    {
      name: "POI search compact",
      params: { query: "coffee shop", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "compact" },
      validate: (data) => validateGeoJSONSearchResponse(data, "compact", true),
    },
    {
      name: "POI search full",
      params: { query: "coffee shop", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "full" },
      validate: (data) => validateGeoJSONSearchResponse(data, "full", true),
    },
  ],

  "tomtom-nearby": [
    {
      name: "Nearby search compact",
      params: { position: [4.89707, 52.377956], poiCategories: ["RESTAURANT"], radius: 5000, limit: 3, response_detail: "compact" },
      validate: (data) => validateGeoJSONSearchResponse(data, "compact", true),
    },
    {
      name: "Nearby search full",
      params: { position: [4.89707, 52.377956], poiCategories: ["RESTAURANT"], radius: 5000, limit: 3, response_detail: "full" },
      validate: (data) => validateGeoJSONSearchResponse(data, "full", true),
    },
  ],

  // ── SDK-based search tools (orbis only) ───────────────
  "tomtom-ev-search": [
    {
      name: "EV search compact",
      params: { position: [4.9041, 52.3676], radius: 5000, limit: 3, response_detail: "compact" },
      validate: (data) => validateEvSearchResponse(data, "compact"),
    },
    {
      name: "EV search full",
      params: { position: [4.9041, 52.3676], radius: 5000, limit: 3, response_detail: "full" },
      validate: (data) => validateEvSearchResponse(data, "full"),
    },
  ],

  "tomtom-area-search": [
    {
      name: "Area search compact",
      params: { query: "restaurant", center: [4.9041, 52.3676], radius: 2000, limit: 3, response_detail: "compact" },
      validate: (data) => validateAreaSearchResponse(data, "compact"),
    },
    {
      name: "Area search full",
      params: { query: "restaurant", center: [4.9041, 52.3676], radius: 2000, limit: 3, response_detail: "full" },
      validate: (data) => validateAreaSearchResponse(data, "full"),
    },
  ],

  "tomtom-search-along-route": [
    {
      name: "Search along route compact",
      params: {
        origin: [4.9041, 52.3676],
        destination: [5.4697, 51.4416],
        query: "gas station",
        limit: 3,
        response_detail: "compact",
      },
      validate: (data) => validateSearchAlongRouteResponse(data, "compact"),
    },
    {
      name: "Search along route full",
      params: {
        origin: [4.9041, 52.3676],
        destination: [5.4697, 51.4416],
        query: "gas station",
        limit: 3,
        response_detail: "full",
      },
      validate: (data) => validateSearchAlongRouteResponse(data, "full"),
    },
  ],

  // ── Routing tools ─────────────────────────────────────
  // Orbis routing uses locations: [[lon, lat], ...] tuples (GeoJSON convention)
  "tomtom-routing": [
    {
      name: "Route compact",
      params: {
        locations: [[4.8897, 52.374], [13.405, 52.52]],
        travelMode: "car",
        routeType: "fast",
        traffic: "live",
        response_detail: "compact",
      },
      validate: (data) => validateRoutingResponse(data, "compact"),
    },
    {
      name: "Route full",
      params: {
        locations: [[4.8897, 52.374], [13.405, 52.52]],
        travelMode: "car",
        routeType: "fast",
        traffic: "live",
        response_detail: "full",
      },
      validate: (data) => validateRoutingResponse(data, "full"),
    },
  ],

  "tomtom-waypoint-routing": [
    {
      name: "Waypoint routing compact",
      params: {
        waypoints: [
          { lat: 52.374, lon: 4.8897 },
          { lat: 51.2217, lon: 4.4051 },
          { lat: 50.8503, lon: 4.3517 },
        ],
        travelMode: "car",
        routeType: "fast",
        traffic: "live",
        response_detail: "compact",
      },
      validate: (data) => validateRoutingResponse(data, "compact", true),
    },
    {
      name: "Waypoint routing full",
      params: {
        waypoints: [
          { lat: 52.374, lon: 4.8897 },
          { lat: 51.2217, lon: 4.4051 },
          { lat: 50.8503, lon: 4.3517 },
        ],
        travelMode: "car",
        routeType: "fast",
        traffic: "live",
        response_detail: "full",
      },
      validate: (data) => validateRoutingResponse(data, "full", true),
    },
  ],

  "tomtom-reachable-range": [
    // ── Time budget ──
    {
      name: "Reachable range - time budget (compact)",
      params: {
        origin: [4.8897, 52.374],
        timeBudgetInSec: 1800,
        travelMode: "car",
        routeType: "fast",
        response_detail: "compact",
      },
      validate: (data) => validateGeoJSONReachableRangeResponse(data, "compact"),
    },
    {
      name: "Reachable range - time budget (full)",
      params: {
        origin: [4.8897, 52.374],
        timeBudgetInSec: 1800,
        travelMode: "car",
        routeType: "fast",
        response_detail: "full",
      },
      validate: (data) => validateGeoJSONReachableRangeResponse(data, "full"),
    },
    // ── Distance budget ──
    {
      name: "Reachable range - distance budget",
      params: {
        origin: [4.8897, 52.374],
        distanceBudgetInMeters: 50000,
        travelMode: "car",
        response_detail: "compact",
      },
      validate: (data) => validateGeoJSONReachableRangeResponse(data, "compact"),
    },
    // ── Fuel budget (combustion) ──
    {
      name: "Reachable range - fuel budget (combustion)",
      params: {
        origin: [4.8897, 52.374],
        fuelBudgetInLiters: 20,
        vehicleEngineType: "combustion",
        constantSpeedConsumptionInLitersPerHundredkm: "50,6.5:130,11.5",
        currentFuelInLiters: 40,
        response_detail: "compact",
      },
      validate: (data) => validateGeoJSONReachableRangeResponse(data, "compact"),
    },
    // ── Charge budget (EV percentage) ──
    {
      name: "Reachable range - charge budget percent (EV)",
      params: {
        origin: [4.8897, 52.374],
        chargeBudgetPercent: 80,
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
        currentChargeInkWh: 48,
        maxChargeInkWh: 60,
        response_detail: "compact",
      },
      validate: (data) => validateGeoJSONReachableRangeResponse(data, "compact"),
    },
    // ── Energy budget (EV kWh) ──
    {
      name: "Reachable range - energy budget kWh (EV)",
      params: {
        origin: [4.8897, 52.374],
        energyBudgetInkWh: 20,
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
        currentChargeInkWh: 48,
        maxChargeInkWh: 60,
        response_detail: "compact",
      },
      validate: (data) => validateGeoJSONReachableRangeResponse(data, "compact"),
    },
    // ── Remaining charge budget (EV) ──
    {
      name: "Reachable range - remaining charge percent (EV)",
      params: {
        origin: [4.8897, 52.374],
        remainingChargeBudgetPercent: 20,
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
        currentChargeInkWh: 48,
        maxChargeInkWh: 60,
        response_detail: "compact",
      },
      validate: (data) => validateGeoJSONReachableRangeResponse(data, "compact"),
    },
  ],

  // ── SDK-based routing tools (orbis only) ──────────────
  "tomtom-ev-routing": [
    {
      name: "EV routing compact",
      params: {
        origin: [4.9041, 52.3676],
        destination: [5.4697, 51.4416],
        currentChargePercent: 80,
        maxChargeKWH: 60,
        response_detail: "compact",
      },
      validate: (data) => validateEvRoutingResponse(data, "compact"),
    },
    {
      name: "EV routing full",
      params: {
        origin: [4.9041, 52.3676],
        destination: [5.4697, 51.4416],
        currentChargePercent: 80,
        maxChargeKWH: 60,
        response_detail: "full",
      },
      validate: (data) => validateEvRoutingResponse(data, "full"),
    },
  ],

  // ── Traffic ───────────────────────────────────────────
  "tomtom-traffic": [
    {
      name: "Traffic compact",
      params: { bbox: [4.8, 52.3, 4.95, 52.4], language: "en-US", response_detail: "compact" },
      validate: (data) => validateTrafficResponse(data, "compact"),
    },
    {
      name: "Traffic full",
      params: { bbox: [4.8, 52.3, 4.95, 52.4], language: "en-US", response_detail: "full" },
      validate: (data) => validateTrafficResponse(data, "full"),
    },
  ],

  // ── Map tools ─────────────────────────────────────────
  "tomtom-dynamic-map": [
    {
      name: "Dynamic map with markers",
      params: {
        markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam" }],
        width: 400,
        height: 300,
      },
      expectImage: true,
      validate: (content) => validateImageResponse(content),
    },
  ],
};

const GENESIS_SCENARIOS = {
  // ── Search tools ──────────────────────────────────────
  "tomtom-geocode": [
    {
      name: "Geocode compact",
      params: { query: "Amsterdam Central Station", limit: 3, language: "en-US", response_detail: "compact" },
      validate: (data) => validateSearchResponse(data, "compact"),
    },
    {
      name: "Geocode full",
      params: { query: "Amsterdam Central Station", limit: 3, language: "en-US", response_detail: "full" },
      validate: (data) => validateSearchResponse(data, "full"),
    },
  ],

  "tomtom-reverse-geocode": [
    {
      name: "Reverse geocode compact",
      params: { lat: 52.374, lon: 4.8897, language: "en-US", response_detail: "compact" },
      validate: (data) => validateReverseGeocodeResponse(data, "compact"),
    },
    {
      name: "Reverse geocode full",
      params: { lat: 52.374, lon: 4.8897, language: "en-US", response_detail: "full" },
      validate: (data) => validateReverseGeocodeResponse(data, "full"),
    },
  ],

  "tomtom-fuzzy-search": [
    {
      name: "Fuzzy search compact",
      params: { query: "restaurants in Amsterdam", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "compact" },
      validate: (data) => validateSearchResponse(data, "compact"),
    },
    {
      name: "Fuzzy search full",
      params: { query: "restaurants in Amsterdam", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "full" },
      validate: (data) => validateSearchResponse(data, "full"),
    },
  ],

  "tomtom-poi-search": [
    {
      name: "POI search compact",
      params: { query: "coffee shop", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "compact" },
      validate: (data) => validateSearchResponse(data, "compact", true),
    },
    {
      name: "POI search full",
      params: { query: "coffee shop", lat: 52.374, lon: 4.8897, limit: 3, response_detail: "full" },
      validate: (data) => validateSearchResponse(data, "full", true),
    },
  ],

  "tomtom-nearby": [
    {
      name: "Nearby search compact",
      params: { lat: 52.374, lon: 4.8897, categorySet: "7315", radius: 2000, limit: 3, response_detail: "compact" },
      validate: (data) => validateSearchResponse(data, "compact", true),
    },
    {
      name: "Nearby search full",
      params: { lat: 52.374, lon: 4.8897, categorySet: "7315", radius: 2000, limit: 3, response_detail: "full" },
      validate: (data) => validateSearchResponse(data, "full", true),
    },
  ],

  // ── Routing tools ─────────────────────────────────────
  "tomtom-routing": [
    {
      name: "Route compact",
      params: {
        origin: { lat: 52.374, lon: 4.8897 },
        destination: { lat: 52.52, lon: 13.405 },
        travelMode: "car",
        routeType: "fastest",
        traffic: true,
        response_detail: "compact",
      },
      validate: (data) => validateRoutingResponse(data, "compact"),
    },
    {
      name: "Route full",
      params: {
        origin: { lat: 52.374, lon: 4.8897 },
        destination: { lat: 52.52, lon: 13.405 },
        travelMode: "car",
        routeType: "fastest",
        traffic: true,
        response_detail: "full",
      },
      validate: (data) => validateRoutingResponse(data, "full"),
    },
  ],

  "tomtom-waypoint-routing": [
    {
      name: "Waypoint routing compact",
      params: {
        waypoints: [
          { lat: 52.374, lon: 4.8897 },
          { lat: 51.2217, lon: 4.4051 },
          { lat: 50.8503, lon: 4.3517 },
        ],
        travelMode: "car",
        routeType: "fastest",
        traffic: true,
        response_detail: "compact",
      },
      validate: (data) => validateRoutingResponse(data, "compact", true),
    },
    {
      name: "Waypoint routing full",
      params: {
        waypoints: [
          { lat: 52.374, lon: 4.8897 },
          { lat: 51.2217, lon: 4.4051 },
          { lat: 50.8503, lon: 4.3517 },
        ],
        travelMode: "car",
        routeType: "fastest",
        traffic: true,
        response_detail: "full",
      },
      validate: (data) => validateRoutingResponse(data, "full", true),
    },
  ],

  "tomtom-reachable-range": [
    {
      name: "Reachable range compact",
      params: {
        origin: { lat: 52.374, lon: 4.8897 },
        timeBudgetInSec: 1800,
        travelMode: "car",
        routeType: "fastest",
        traffic: true,
        response_detail: "compact",
      },
      validate: (data) => validateReachableRangeResponse(data, "compact"),
    },
    {
      name: "Reachable range full",
      params: {
        origin: { lat: 52.374, lon: 4.8897 },
        timeBudgetInSec: 1800,
        travelMode: "car",
        routeType: "fastest",
        traffic: true,
        response_detail: "full",
      },
      validate: (data) => validateReachableRangeResponse(data, "full"),
    },
  ],

  // ── Traffic ───────────────────────────────────────────
  "tomtom-traffic": [
    {
      name: "Traffic compact",
      params: { bbox: "4.8,52.3,4.95,52.4", language: "en-US", maxResults: 10, response_detail: "compact" },
      validate: (data) => validateTrafficResponse(data, "compact"),
    },
    {
      name: "Traffic full",
      params: { bbox: "4.8,52.3,4.95,52.4", language: "en-US", maxResults: 10, response_detail: "full" },
      validate: (data) => validateTrafficResponse(data, "full"),
    },
  ],

  // ── Map tools ─────────────────────────────────────────
  "tomtom-static-map": [
    {
      name: "Static map",
      params: { center: { lat: 52.374, lon: 4.8897 }, zoom: 12, width: 400, height: 300 },
      expectImage: true,
      validate: (content) => validateImageResponse(content),
    },
  ],

  "tomtom-dynamic-map": [
    {
      name: "Dynamic map with markers",
      params: {
        markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam" }],
        width: 400,
        height: 300,
      },
      expectImage: true,
      validate: (content) => validateImageResponse(content),
    },
  ],
};

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

function parseSSE(text) {
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) throw new Error(`No data line in SSE: ${text.slice(0, 200)}`);
  return JSON.parse(dataLine.slice(6));
}

async function callTool(toolName, params, backend, expectImage = false) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: params },
  });

  const res = await fetch(`http://localhost:${PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
      "tomtom-api-key": API_KEY,
      "tomtom-maps-backend": backend,
      Connection: "close",
    },
    body,
  });

  const text = await res.text();
  const sse = parseSSE(text);

  if (sse.result?.isError) {
    const errText = sse.result.content?.[0]?.text || "Unknown error";
    return { _error: true, error: errText };
  }

  const content = sse.result?.content || [];

  // For image tools, return the raw content array
  if (expectImage) {
    return { _image: true, content };
  }

  // For text tools, find the text content and parse JSON
  const textContent = content.find((c) => c.type === "text");
  if (!textContent?.text) return { _error: true, error: "No text content in response" };

  return JSON.parse(textContent.text);
}

async function callToolsList(backend) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });

  const res = await fetch(`http://localhost:${PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
      "tomtom-api-key": API_KEY,
      "tomtom-maps-backend": backend,
      Connection: "close",
    },
    body,
  });

  const sse = parseSSE(await res.text());
  return sse.result?.tools?.map((t) => t.name) || [];
}

// ─── Server Management ──────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const serverFile = `${PROJECT_ROOT}/dist/indexHttp.esm.js`;
    const child = spawn("node", [serverFile], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error("Server startup timed out (15s)"));
      }
    }, 15000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (VERBOSE) process.stdout.write(`  [server] ${text}`);
      if (text.includes("TomTom MCP HTTP Server started") && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      // pino logs to stderr
      if (text.includes("TomTom MCP HTTP Server started") && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
      if (VERBOSE) process.stderr.write(`  [server] ${text}`);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start server: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code} before starting`));
      }
    });
  });
}

// ─── Test Runner ────────────────────────────────────────────────────────────

class TestResults {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  addResult(toolName, name, status, message, duration = null, details = null) {
    this.results.push({ toolName, name, status, message, duration, details });

    if (status === "PASS") {
      this.passed++;
      console.log(`  ✅ ${name} - ${message}${duration ? ` (${duration}ms)` : ""}`);
    } else if (status === "FAIL") {
      this.failed++;
      console.log(`  ❌ ${name} - ${message}${duration ? ` (${duration}ms)` : ""}`);
      if (VERBOSE && details) {
        console.log(`    Details: ${JSON.stringify(details, null, 2)}`);
      }
    } else if (status === "SKIP") {
      this.skipped++;
      console.log(`  ⏭️  ${name} - ${message}`);
    }
  }

  printSummary() {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`TEST SUMMARY: ${this.passed + this.failed + this.skipped} tests`);
    console.log(`${"=".repeat(60)}`);
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`⏭️  Skipped: ${this.skipped}`);
    console.log(`${"=".repeat(60)}`);

    if (this.failed > 0) {
      console.log("\nFailed tests:");
      this.results
        .filter((r) => r.status === "FAIL")
        .forEach((r) => console.log(`  - ${r.toolName}/${r.name}: ${r.message}`));
    }
  }

  getResultsByTool() {
    const byTool = {};
    for (const result of this.results) {
      if (!byTool[result.toolName]) {
        byTool[result.toolName] = { passed: 0, failed: 0, skipped: 0, total: 0 };
      }
      byTool[result.toolName].total++;
      if (result.status === "PASS") byTool[result.toolName].passed++;
      else if (result.status === "FAIL") byTool[result.toolName].failed++;
      else if (result.status === "SKIP") byTool[result.toolName].skipped++;
    }
    return byTool;
  }

  printDetailedSummary() {
    const byTool = this.getResultsByTool();

    console.log("\nRESULTS BY TOOL:");
    console.log("----------------");

    for (const [toolName, counts] of Object.entries(byTool)) {
      const passRate =
        counts.total > 0
          ? Math.round((counts.passed / (counts.passed + counts.failed)) * 100)
          : 0;
      const statusSymbol = counts.failed > 0 ? "❌" : "✅";
      console.log(
        `${statusSymbol} ${toolName}: ${passRate}% passed (${counts.passed}/${counts.passed + counts.failed})`
      );
    }
  }
}

async function runBackendTests(backend, scenarios, results) {
  console.log(`\nBackend: ${backend}`);
  console.log("-".repeat(40));

  // List available tools
  let availableTools;
  try {
    availableTools = await callToolsList(backend);
    console.log(`Available tools: ${availableTools.join(", ")}\n`);
  } catch (e) {
    console.log(`Failed to list tools: ${e.message}`);
    return;
  }

  const toolsToTest = TOOL_FILTER
    ? Object.keys(scenarios).filter((t) => t === TOOL_FILTER)
    : Object.keys(scenarios);

  for (const toolName of toolsToTest) {
    console.log(`\n${toolName.toUpperCase()} TESTS`);
    console.log("-".repeat(40));

    if (!availableTools.includes(toolName)) {
      results.addResult(toolName, "availability", "SKIP", `Tool ${toolName} not available on ${backend}`);
      continue;
    }

    for (const scenario of scenarios[toolName]) {
      // Small delay between tests to avoid TomTom API rate limits
      await new Promise((r) => setTimeout(r, 1000));
      console.log(`  Testing: ${scenario.name}...`);

      if (VERBOSE) {
        console.log(`    Parameters: ${JSON.stringify(scenario.params)}`);
      }

      const start = Date.now();
      try {
        const data = await callTool(toolName, scenario.params, backend, scenario.expectImage);
        const duration = Date.now() - start;

        // Check for MCP-level errors
        if (data._error) {
          results.addResult(toolName, scenario.name, "FAIL", `Error: ${data.error?.slice(0, 150)}`, duration);
          continue;
        }

        // For image responses, validate content array directly
        if (data._image) {
          const err = scenario.validate(data.content);
          if (err) {
            results.addResult(toolName, scenario.name, "FAIL", err, duration);
          } else {
            const imgSize = data.content.find((c) => c.type === "image")?.data?.length || 0;
            results.addResult(
              toolName,
              scenario.name,
              "PASS",
              `Image generated (${(imgSize * 0.75 / 1024).toFixed(0)} KB)`,
              duration
            );
          }
          continue;
        }

        if (VERBOSE) {
          const preview = JSON.stringify(data).slice(0, 500);
          console.log(`    Response: ${preview}${preview.length > 499 ? "..." : ""}`);
        }

        // Validate response structure
        const err = scenario.validate(data);
        if (err) {
          results.addResult(toolName, scenario.name, "FAIL", err, duration, data);
        } else {
          const size = JSON.stringify(data).length;
          results.addResult(
            toolName,
            scenario.name,
            "PASS",
            `Valid response (${(size / 1024).toFixed(1)} KB)`,
            duration
          );
        }
      } catch (e) {
        const duration = Date.now() - start;
        results.addResult(toolName, scenario.name, "FAIL", `Unexpected error: ${e.message}`, duration, {
          error: e.message,
        });
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("TomTom MCP HTTP Tools Test — Comprehensive");
  console.log("=".repeat(60));

  // Start the server
  console.log(`\nStarting HTTP server on port ${PORT}...`);
  let serverProcess;
  try {
    serverProcess = await startServer();
    console.log("✓ HTTP server started\n");
  } catch (e) {
    console.error(`\n✗ Failed to start server: ${e.message}`);
    process.exit(1);
  }

  const results = new TestResults();

  try {
    // Wait for server to be fully ready
    await new Promise((r) => setTimeout(r, 500));

    // Test backends
    const backends = BACKEND_FILTER
      ? [BACKEND_FILTER]
      : ["tomtom-orbis-maps", "tomtom-maps"];

    for (const backend of backends) {
      const scenarios = backend === "tomtom-orbis-maps" ? ORBIS_SCENARIOS : GENESIS_SCENARIOS;
      await runBackendTests(backend, scenarios, results);
    }
  } finally {
    // Shutdown server
    console.log("\nShutting down...");
    serverProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }

  // Print summary
  results.printSummary();
  results.printDetailedSummary();

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Handle signals to ensure clean shutdown
process.on("SIGINT", () => {
  console.log("\nReceived interrupt signal, shutting down...");
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.log("\nReceived terminate signal, shutting down...");
  process.exit(1);
});

main().catch((err) => {
  console.error(`\n✗ Test execution failed: ${err.message}`);
  if (VERBOSE) {
    console.error(err.stack);
  }
  process.exit(1);
});
