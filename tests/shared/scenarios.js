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

/**
 * Cases and response checks used by both test-stdio-tools.js and
 * test-http-tools.js, so the two transports exercise the same inputs.
 */

/**
 * tomtom-data-viz URLs the SSRF guard must reject, each with a word the
 * error message has to contain.
 */
export const DATA_VIZ_SSRF_CASES = [
  { name: "SSRF: reject http URL", data_url: "http://example.com/data.geojson", keyword: "https" },
  { name: "SSRF: reject localhost IP", data_url: "https://127.0.0.1/data.geojson", keyword: "non-public" },
  { name: "SSRF: reject private IP 10.x", data_url: "https://10.0.0.1/data.geojson", keyword: "non-public" },
  { name: "SSRF: reject private IP 192.168.x", data_url: "https://192.168.1.1/data.geojson", keyword: "non-public" },
  {
    name: "SSRF: reject cloud metadata IP (link-local)",
    data_url: "https://169.254.169.254/latest/meta-data/",
    keyword: "non-public",
  },
  { name: "SSRF: reject file:// scheme", data_url: "file:///etc/passwd", keyword: "https" },
  {
    name: "SSRF: reject URL with credentials",
    data_url: "https://user:pass@example.com/data.geojson",
    keyword: "credentials",
  },
];

/**
 * tomtom-discover-places scopes beyond each transport's own cases: no geographic
 * constraint, explicit or by default, and a caller's polygon. `expected` takes
 * the `checkDiscoverResponse` options.
 */
export const DISCOVER_SCOPE_CASES = [
  {
    name: "Global search",
    params: { query: "Rijksmuseum", poiCategories: ["museum"], where: { mode: "global" }, countries: ["NL"], limit: 3 },
    expected: { mode: "global", contains: ["Rijksmuseum"] },
  },
  {
    name: "Global by default, without where",
    params: { query: "Schiphol", poiCategories: ["airport"], countries: ["NL"], limit: 3 },
    expected: { mode: "global", contains: ["Schiphol"] },
  },
  {
    name: "Inside a polygon",
    params: {
      poiCategories: ["cafe"],
      where: {
        mode: "within",
        geometries: [
          {
            type: "Polygon",
            coordinates: [[[4.88, 52.365], [4.91, 52.365], [4.91, 52.38], [4.88, 52.38], [4.88, 52.365]]],
          },
        ],
      },
      limit: 5,
    },
    expected: { mode: "within", withinBbox: [4.88, 52.365, 4.91, 52.38] },
  },
  {
    name: "Within a distance of the last part of a drive",
    params: {
      poiCategories: ["parking garage"],
      where: {
        mode: "alongRoute",
        locations: [{ position: [4.9041, 52.3676] }, { position: [5.4697, 51.4416] }],
        withinMeters: 1000,
        stretch: { lastMeters: 20000 },
      },
      limit: 5,
    },
    expected: { mode: "alongRoute" },
  },
  {
    name: "Within a detour of one country's part of a drive",
    params: {
      poiCategories: ["fuel station"],
      where: {
        mode: "maxDetour",
        locations: [{ position: [4.9041, 52.3676] }, { position: [4.3517, 50.8503] }],
        maxDetourTimeSeconds: 600,
        sortBy: "detourOffset",
        stretch: { includeCountries: ["BE"] },
      },
      limit: 5,
    },
    expected: { mode: "maxDetour" },
  },
];

/**
 * Check a GeoJSON FeatureCollection of POI results from the search tools.
 * @param {Object} data - Parsed FeatureCollection
 * @param {Object} [options]
 * @param {boolean} [options.hasResults] - Whether at least one feature is required
 * @param {string[]} [options.contains] - Terms that must appear in the features
 * @param {number[]} [options.withinBbox] - [minLon, minLat, maxLon, maxLat] every feature must fall inside
 * @returns {string|null} What is wrong, or null if every check passes
 */
export function checkPoiFeatureCollection(data, { hasResults, contains, withinBbox } = {}) {
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return `Expected GeoJSON FeatureCollection, got ${data.type}`;
  }
  if (hasResults && data.features.length === 0) {
    return "No results found (empty features)";
  }

  for (const [i, feature] of data.features.entries()) {
    if (feature.geometry?.type !== "Point") {
      return `features[${i}] geometry is ${feature.geometry?.type}, expected Point`;
    }
    if (!feature.properties?.address) {
      return `features[${i}] missing properties.address`;
    }
    if (!feature.properties.poi?.name) {
      return `features[${i}] missing properties.poi.name`;
    }
    if (withinBbox) {
      const [lon, lat] = feature.geometry.coordinates;
      const [minLon, minLat, maxLon, maxLat] = withinBbox;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
        return `features[${i}] at [${lon}, ${lat}] is outside the requested area`;
      }
    }
  }

  if (contains) {
    const featuresStr = JSON.stringify(data.features).toLowerCase();
    for (const term of contains) {
      if (!featuresStr.includes(term.toLowerCase())) {
        return `Results don't contain "${term}"`;
      }
    }
  }

  return null;
}

/**
 * Check a tomtom-discover-places response: POI results, and the scope it reports searching.
 * @param {Object} data - Parsed response
 * @param {Object} options - `checkPoiFeatureCollection` options, plus `mode`, the `where.mode` searched
 * @returns {string|null} What is wrong, or null if every check passes
 */
export function checkDiscoverResponse(data, { mode, ...options }) {
  const poiError = checkPoiFeatureCollection(data, options);
  if (poiError) return poiError;
  if (data.searched?.mode !== mode) return `searched.mode is ${data.searched?.mode}, expected ${mode}`;
  return null;
}

/**
 * Check a tomtom-locate-place response.
 * @param {Object} data - Parsed response
 * @param {Object} options
 * @param {string} [options.located] - A term the located place's name must contain
 * @param {boolean} [options.boundary] - Whether a boundary Polygon or MultiPolygon is required
 * @returns {string|null} What is wrong, or null if every check passes
 */
export function checkLocateResponse(data, { located, boundary } = {}) {
  if (typeof data.located !== "string") return "missing located";
  if (located && !data.located.toLowerCase().includes(located.toLowerCase())) {
    return `located "${data.located}", expected it to name ${located}`;
  }
  if (data.features?.[0]?.geometry?.type !== "Point") return "features[0] is not a Point";
  if (boundary) {
    const type = data.geometry?.features?.[0]?.geometry?.type;
    if (type !== "Polygon" && type !== "MultiPolygon") return `boundary geometry is ${type}`;
  }
  return null;
}

/** A retired tool and a tool its error must name instead (ADR 0010). */
export const RETIRED_TOOL_CASE = { name: "tomtom-static-map", replacement: "tomtom-dynamic-map" };

/**
 * Check the answer to a call to a retired tool.
 * @param {boolean} isError - Whether the result was a tool error
 * @param {string} [text] - The result's text
 * @param {{ name: string, replacement: string }} retired - The retired tool and its replacement
 * @returns {string|null} What is wrong, or null if the error names the tool and its replacement
 */
export function checkRetiredToolError(isError, text, { name, replacement }) {
  if (!isError) return `${name} answered without an error`;
  let details;
  try {
    details = JSON.parse(text ?? "").details;
  } catch {
    return `error is not the retired tool's: ${String(text).slice(0, 100)}`;
  }
  if (details?.tool !== name) return `error names ${details?.tool}, not ${name}`;
  if (!details.replacedBy?.includes(replacement)) return `error does not name ${replacement}`;
  return null;
}

/**
 * A tool call as both suites make it: the result's error flag, its parsed JSON
 * payload when it has one, and its text.
 * @typedef {(tool: string, args: Object) => Promise<{ isError: boolean, data?: Object, text: string }>} ToolCall
 */

const countryOf = (data) => data.features?.[0]?.properties?.address?.countryCode;
/** A check that the located place is in `code`. */
const inCountry = (code) => ({ data }) =>
  countryOf(data) === code ? null : `located ${data.located} in ${countryOf(data)}`;
const waypointNames = (data) => (data.waypoints ?? []).map(({ name }) => name);
/** A check that the call failed with a message matching `pattern`. */
const refusedWith = (pattern) => (result) =>
  result.isError && pattern.test(errorOf(result)) ? null : `answered: ${result.text.slice(0, 160)}`;

/** An error result's message: the payload's `error` when the text is JSON, else the text. */
const errorOf = ({ data, text }) => {
  if (data?.error) return data.error;
  try {
    return JSON.parse(text).error ?? text;
  } catch {
    return text;
  }
};

/**
 * Behaviour each case holds, with the check that fails if it regresses: names
 * resolve to the place meant from one search, `response_detail`
 * never changes the place, an area check reads states and country aliases, a country is
 * refused as an area, an unsupported search language fails early, and an
 * optional part of a route does not fail the route.
 * @type {{ name: string, tool: string, args: Object, check: (result: Awaited<ReturnType<ToolCall>>) => string|null }[]}
 */
export const REVIEW_REGRESSION_CASES = [
  {
    name: "a country's name is the country, not a town named after it",
    tool: "tomtom-locate-place",
    args: { query: "Greece" },
    check: inCountry("GR"),
  },
  {
    name: "Belgium is the country, not Belgium, WI",
    tool: "tomtom-locate-place",
    args: { query: "Belgium" },
    check: inCountry("BE"),
  },
  {
    name: "The Hague is the Dutch city",
    tool: "tomtom-locate-place",
    args: { query: "The Hague" },
    check: inCountry("NL"),
  },
  {
    name: "a city named with its country is the city, not a business named so",
    tool: "tomtom-locate-place",
    args: { query: "Amsterdam, Netherlands" },
    check: ({ data }) => (data.located === "Amsterdam" ? null : `located ${data.located}`),
  },
  {
    name: "an unqualified Frankfurt is Frankfurt am Main, not a hamlet of that name",
    tool: "tomtom-locate-place",
    args: { query: "Frankfurt" },
    check: ({ data }) => (/frankfurt am main/i.test(data.located) ? null : `located ${data.located}`),
  },
  {
    name: "a town qualified by its state is matched by name",
    tool: "tomtom-locate-place",
    args: { query: "Paris, Texas" },
    check: ({ data }) =>
      countryOf(data) === "US" && !data.matchNote ? null : `located ${data.located}, matchNote ${data.matchNote}`,
  },
  {
    name: "response_detail does not change the place found",
    tool: "tomtom-locate-place",
    args: { query: "Zeeland, Netherlands", response_detail: "geometry" },
    compareWith: { query: "Zeeland, Netherlands" },
    check: ({ data }, compact) =>
      data.located === compact?.data?.located ? null : `geometry located ${data.located}, compact ${compact?.data?.located}`,
  },
  {
    name: "a where that repeats the query's area still finds the place there",
    tool: "tomtom-locate-place",
    args: { query: "Dam Square, Amsterdam", where: { mode: "within", queries: ["Amsterdam"] } },
    check: inCountry("NL"),
  },
  {
    name: "route stops qualified by state and by a country alias resolve",
    tool: "tomtom-plan-route",
    args: { locations: [{ query: "Paris, Texas" }, { query: "Dallas, Texas" }] },
    check: ({ isError, text, data }) =>
      !isError && waypointNames(data).length === 2 ? null : `failed: ${text.slice(0, 160)}`,
  },
  {
    name: "a country alias qualifies a route stop",
    tool: "tomtom-plan-route",
    args: { locations: [{ query: "London, UK" }, { query: "Cambridge, UK" }] },
    check: ({ isError, text }) => (isError ? `failed: ${text.slice(0, 160)}` : null),
  },
  {
    name: "one stop between an origin and a destination goes between them",
    tool: "tomtom-plan-route",
    args: {
      locations: [{ position: [4.9, 52.37] }, { position: [5.48, 51.44] }],
      insertStops: [{ position: [5.12, 52.09] }],
    },
    check: ({ data }) => {
      const [, middle] = data.waypoints ?? [];
      return data.waypoints?.length === 3 && middle?.inserted ? null : `waypoints ${JSON.stringify(data.waypoints)}`;
    },
  },
  {
    name: "the usual-traffic comparison comes back beside the route",
    tool: "tomtom-plan-route",
    args: { locations: [{ query: "Amsterdam" }, { query: "Utrecht" }], compareWithUsualRoute: true },
    check: ({ data }) =>
      data.usualRoute && ("sameRoads" in data.usualRoute || "unavailable" in data.usualRoute)
        ? null
        : `usualRoute ${JSON.stringify(data.usualRoute)}`,
  },
  {
    name: "a country is refused as a traffic area, naming what to ask instead",
    tool: "tomtom-get-traffic",
    args: { where: { mode: "within", queries: ["Greece"] } },
    check: refusedWith(/is a country/),
  },
  {
    name: "a country is refused as a places area",
    tool: "tomtom-discover-places",
    args: { poiCategories: ["museum"], where: { mode: "within", queries: ["Belgium"] } },
    check: refusedWith(/is a country/),
  },
  {
    name: "two nearby cities' traffic comes back together",
    tool: "tomtom-get-traffic",
    args: { where: { mode: "within", queries: ["Rotterdam", "Utrecht"] } },
    check: ({ isError, text, data }) =>
      !isError && data.searched?.areasQueried === 2 && !data.searched.failedRequests
        ? null
        : `got: ${text.slice(0, 200)}`,
  },
  {
    name: "an unsupported search language fails early, listing the supported ones",
    tool: "tomtom-discover-places",
    args: { query: "Rijksmuseum", language: "en-NL", limit: 1 },
    check: (result) => {
      const refused = refusedWith(/does not support this language/)(result);
      if (refused) return refused;
      const validValues = JSON.parse(result.text).details?.valid_values ?? [];
      return validValues.includes("en-GB") ? null : `valid_values: ${validValues.join(", ")}`;
    },
  },
  {
    name: "a search language is read in any case",
    tool: "tomtom-discover-places",
    args: { query: "Rijksmuseum", language: "NL-nl", limit: 1 },
    check: ({ isError, text }) => (isError ? `failed: ${text.slice(0, 160)}` : null),
  },
];

/**
 * Runs {@link REVIEW_REGRESSION_CASES}, a second apart for the API's rate limit,
 * recording each under "review-regressions".
 * @param {ToolCall} call
 * @param {{ addResult: (tool: string, name: string, status: string, message: string) => void }} results
 */
export async function runReviewRegressions(call, results) {
  console.log("\nREVIEW REGRESSIONS");
  console.log("-".repeat(40));
  const record = (name, problem) =>
    results.addResult("review-regressions", name, problem ? "FAIL" : "PASS", problem ?? "holds");
  for (const { name, tool, args, compareWith, check } of REVIEW_REGRESSION_CASES) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const compared = compareWith && (await call(tool, compareWith));
      const result = await call(tool, args);
      record(name, check({ ...result, data: result.data ?? {} }, compared));
    } catch (error) {
      record(name, `threw: ${error.message}`);
    }
  }
}
