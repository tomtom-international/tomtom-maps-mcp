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
