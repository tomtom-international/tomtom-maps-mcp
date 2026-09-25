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
 * Comprehensive Test Suite for TomTom MCP Server Tools
 * 
 * This script thoroughly tests all TomTom MCP server tools with all parameters,
 * including optional ones, to verify proper functionality.
 * 
 * Usage: 
 *   node test-comprehensive.js [toolName] [--verbose]
 */

import dotenv from 'dotenv';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import process from 'process';
import console from 'console';

// Load environment variables
dotenv.config();

// Get directory paths and find server
const __dirname = dirname(fileURLToPath(import.meta.url));

// Try different possible locations for the server
const possibleServerPaths = [
  resolve(__dirname, '..', 'bin', 'tomtom-mcp.js'),     // if script is in tests/ folder
  resolve(__dirname, 'bin', 'tomtom-mcp.js'),           // if script is in project root
  resolve(__dirname, '..', 'tomtom-mcp.js'),            // if server is one level up
  resolve(__dirname, 'tomtom-mcp.js'),                  // if server is in same folder
];

let serverPath = null;
for (const path of possibleServerPaths) {
  if (existsSync(path)) {
    serverPath = path;
    break;
  }
}

if (!serverPath) {
  console.error('❌ Could not find TomTom MCP server file!');
  console.error('Searched in:');
  possibleServerPaths.forEach(path => console.error(`  - ${path}`));
  console.error('\nPlease ensure your server file exists and update the path in the script.');
  process.exit(1);
}

// Configuration
const TEST_TOOL = process.argv[2]?.toLowerCase();
const VERBOSE = process.argv.includes('--verbose');

// ── Data Viz SSRF protection tests ─────────────────────
const DATA_VIZ_SCENARIOS = [
  {
    name: 'SSRF: reject http URL',
    params: {
      data_url: 'http://example.com/data.geojson',
      layers: [{ type: 'markers' }],
    },
    expected: { shouldFail: true, expectedError: 'https' }
  },
  {
    name: 'SSRF: reject localhost IP',
    params: {
      data_url: 'https://127.0.0.1/data.geojson',
      layers: [{ type: 'markers' }],
    },
    expected: { shouldFail: true, expectedError: 'non-public' }
  },
  {
    name: 'SSRF: reject private IP 10.x',
    params: {
      data_url: 'https://10.0.0.1/data.geojson',
      layers: [{ type: 'markers' }],
    },
    expected: { shouldFail: true, expectedError: 'non-public' }
  },
  {
    name: 'SSRF: reject private IP 192.168.x',
    params: {
      data_url: 'https://192.168.1.1/data.geojson',
      layers: [{ type: 'markers' }],
    },
    expected: { shouldFail: true, expectedError: 'non-public' }
  },
  {
    name: 'SSRF: reject cloud metadata IP',
    params: {
      data_url: 'https://169.254.169.254/latest/meta-data/',
      layers: [{ type: 'markers' }],
    },
    expected: { shouldFail: true, expectedError: 'non-public' }
  },
  {
    name: 'SSRF: reject file:// scheme',
    params: {
      data_url: 'file:///etc/passwd',
      layers: [{ type: 'markers' }],
    },
    expected: { shouldFail: true, expectedError: 'https' }
  },
  {
    name: 'SSRF: reject URL with credentials',
    params: {
      data_url: 'https://user:pass@example.com/data.geojson',
      layers: [{ type: 'markers' }],
    },
    expected: { shouldFail: true, expectedError: 'credentials' }
  },
  {
    name: 'Data viz: valid inline GeoJSON',
    params: {
      geojson: JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [4.89, 52.37] },
          properties: { name: 'Amsterdam' },
        }],
      }),
      layers: [{ type: 'markers' }],
      title: 'Test',
    },
    expected: { hasResults: true }
  },
];

// Test scenarios — [lon, lat] arrays and GeoJSON conventions
const TEST_SCENARIOS = {
  "tomtom-traffic": [
    {
      name: 'Traffic with bbox',
      params: { bbox: [4.8, 52.3, 4.95, 52.4], language: 'en-US', maxResults: 20 },
      expected: { hasResults: true, validStructure: true }
    },
    {
      name: 'negative: Missing bbox',
      params: { language: 'en-US', maxResults: 10 },
      expected: { shouldFail: true }
    },
    {
      name: 'negative: Invalid maxResults (too high)',
      params: { bbox: [4.8, 52.3, 4.95, 52.4], maxResults: 2000 },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-routing": [
    {
      name: 'Basic routing',
      params: {
        locations: [[4.8897, 52.374], [13.405, 52.52]],
        travelMode: 'car',
        routeType: 'fast',
        traffic: 'live',
      },
      expected: { hasResults: true, hasRoute: true }
    },
    {
      name: 'Multi-stop routing',
      params: {
        locations: [[4.8897, 52.374], [4.4051, 51.2217], [13.405, 52.52]],
        travelMode: 'car',
        routeType: 'fast',
        traffic: 'live',
      },
      expected: { hasResults: true, hasRoute: true }
    },
    {
      name: 'negative: Missing locations',
      params: { travelMode: 'car' },
      expected: { shouldFail: true }
    },
    {
      name: 'negative: Invalid travelMode',
      params: { locations: [[4.8897, 52.374], [13.405, 52.52]], travelMode: 'spaceship' },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-reachable-range": [
    {
      name: 'Time-based reachable range',
      params: {
        origin: [4.8897, 52.374],
        timeBudgetInSec: 1800,
        travelMode: 'car',
        routeType: 'fast',
      },
      expected: { hasData: true }
    },
    {
      name: 'Distance-based reachable range',
      params: {
        origin: [4.8897, 52.374],
        distanceBudgetInMeters: 50000,
        travelMode: 'car',
      },
      expected: { hasData: true }
    },
    {
      name: 'negative: Missing budget',
      params: { origin: [4.8897, 52.374] },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-ev-routing": [
    {
      name: 'EV routing without charging stops',
      params: {
        origin: [4.9041, 52.3676], // Amsterdam
        destination: [5.4697, 51.4416], // Eindhoven
        currentChargePercent: 80,
        maxChargeKWH: 60,
      },
      expected: { hasResults: true, hasRoute: true }
    },
    {
      name: 'EV routing with charging stops',
      params: {
        origin: [4.8897, 52.374], // Amsterdam
        destination: [13.405, 52.52], // Berlin
        currentChargePercent: 50,
        maxChargeKWH: 60,
      },
      expected: { hasResults: true, hasRoute: true, hasChargingStops: true }
    },
    {
      name: 'negative: Missing currentChargePercent',
      params: { origin: [4.9041, 52.3676], destination: [5.4697, 51.4416], maxChargeKWH: 60 },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-geocode": [
    {
      name: 'Geocode address',
      params: { query: 'Amsterdam Central Station, Netherlands', limit: 5, language: 'en-US' },
      expected: { hasResults: true, contains: ['Amsterdam'] }
    },
    {
      name: 'negative: Missing query',
      params: { limit: 5 },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-reverse-geocode": [
    {
      name: 'Reverse geocode',
      params: { position: [4.8897, 52.374], language: 'en-US' },
      expected: { hasResults: true }
    },
    {
      name: 'negative: Missing position',
      params: { language: 'en-US' },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-nearby": [
    {
      name: 'Nearby search',
      params: {
        position: [4.8897, 52.374],
        poiCategories: ['RESTAURANT'],
        radius: 2000,
        limit: 10,
      },
      expected: { hasResults: true }
    },
    {
      name: 'negative: Missing position',
      params: { radius: 1000 },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-fuzzy-search": [
    {
      name: 'Fuzzy search',
      params: { query: 'restaurants in Amsterdam', limit: 10, language: 'en-US' },
      expected: { hasResults: true, contains: ['Amsterdam'] }
    },
    {
      name: 'negative: Missing query',
      params: { limit: 5 },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-poi-search": [
    {
      name: 'POI search with position bias',
      params: { query: 'coffee shop', position: [4.8897, 52.374], radius: 5000, limit: 5, language: 'en-US' },
      expected: { hasResults: true, contains: ['Amsterdam'] }
    },
    {
      name: 'negative: Missing query',
      params: { position: [4.8897, 52.374] },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-poi-categories": [
    {
      name: 'POI categories with filter',
      params: { filters: ['coffee'] },
      expected: { hasResults: true, containsCode: 'COFFEE_SHOP' }
    },
    {
      name: 'POI categories with multiple filters',
      params: { filters: ['parking', 'garage'] },
      expected: { hasResults: true, containsCode: 'PARKING_GARAGE' }
    },
  ],
  "tomtom-area-search": [
    {
      name: 'Area search with circle',
      params: { query: 'restaurant', center: [4.9041, 52.3676], radius: 2000, limit: 5 },
      expected: { hasResults: true }
    },
    {
      name: 'Area search with bounding box',
      params: { query: 'hotel', boundingBox: [[4.85, 52.39], [4.93, 52.35]], limit: 5 },
      expected: { hasResults: true, withinBbox: [4.85, 52.35, 4.93, 52.39] }
    },
    {
      name: 'negative: Missing query',
      params: { center: [4.9041, 52.3676], radius: 2000 },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-ev-search": [
    {
      name: 'EV search near Amsterdam Central',
      params: { position: [4.9041, 52.3676], radius: 5000, limit: 5 },
      expected: { hasResults: true }
    },
    {
      name: 'EV search with connector type',
      params: { position: [4.9041, 52.3676], radius: 20000, connectorTypes: ['IEC62196Type2CCS'], limit: 5 },
      expected: { hasResults: true, connectorType: 'IEC62196Type2CCS' }
    },
    {
      name: 'negative: Missing position',
      params: { radius: 5000 },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-search-along-route": [
    {
      name: 'Search along route',
      params: {
        origin: [4.9041, 52.3676], // Amsterdam
        destination: [5.4697, 51.4416], // Eindhoven
        query: 'gas station',
        limit: 5,
      },
      expected: { hasResults: true }
    },
    {
      name: 'negative: Missing query',
      params: { origin: [4.9041, 52.3676], destination: [5.4697, 51.4416] },
      expected: { shouldFail: true }
    },
  ],
  "tomtom-dynamic-map": [
    {
      name: 'Dynamic map with markers',
      params: {
        markers: [
          { lat: 52.3740, lon: 4.8897, label: "Amsterdam", color: "#ff0000" },
          { lat: 48.8566, lon: 2.3522, label: "Paris", color: "#0066cc" }
        ],
        showLabels: true,
        width: 800,
        height: 600
      },
      expected: { hasMapSummary: true }
    },
    {
      name: 'Dynamic map route planning mode',
      params: {
        // Dynamic map routePlans take { lat, lon } objects
        routePlans: [{
          origin: { lat: 52.3740, lon: 4.8897 },
          destination: { lat: 48.8566, lon: 2.3522 },
          waypoints: [{ lat: 50.8503, lon: 4.3517 }], // Brussels
        }],
        showLabels: true,
      },
      expected: { hasMapSummary: true, hasRoutes: true }
    },
    {
      name: 'Dynamic map with basic markers',
      params: {
        markers: [{ lat: 52.3740, lon: 4.8897, label: "Amsterdam Test" }],
        width: 400,
        height: 300
      },
      expected: { hasMapSummary: true }
    },
  ],
  "tomtom-data-viz": DATA_VIZ_SCENARIOS,
};

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the validation passed
 * @property {string} message - Description of the validation result
 */

/**
 * Helper function to validate response structure and handle negative test cases
 * @param {Object} result - The result object from the MCP tool call
 * @param {Object} expected - Expected test outcomes
 * @param {boolean} [expected.shouldFail] - Whether the test is expected to fail
 * @returns {ValidationResult|null} Validation result object if validation fails, null if validation passes
 */
function validateResponseStructure(result, expected) {
  if (!result.content || !result.content[0] || !result.content[0].text) {
    // If negative test, treat any error/invalid as pass
    if (expected.shouldFail) {
      return { valid: true, message: 'Failed as expected (invalid response structure)' };
    }
    return { valid: false, message: 'Invalid response structure' };
  }
  if (expected.shouldFail && result.isError) {
    return { valid: true, message: `Failed as expected (${result.content[0].text})` };
  }
  return null; // Validation passed, continue with specific checks
}

/**
 * Helper function to check for API errors in response data
 * @param {Object} data - Parsed JSON response data
 * @param {Object} expected - Expected test outcomes
 * @param {boolean} [expected.shouldFail] - Whether the test is expected to fail
 * @returns {ValidationResult|null} Validation result if error is found, null otherwise
 */
function checkForApiError(data, expected) {
  if (data.error && typeof data.error === 'string') {
    // If negative test, treat any error as pass
    if (expected.shouldFail) {
      return { valid: true, message: `Failed as expected (${data.error})` };
    }
    // Check if it's a handled API failure
    if (data.error.includes('Request failed') || data.error.includes('API call failed') || data.error.includes('Invalid arguments')) {
      return { valid: true, message: `API call failed but handled gracefully: ${data.error}` };
    }
    return { valid: false, message: `API error: ${data.error}` };
  }
  return null; // No error, continue with validation
}

/**
 * Helper function to parse a successful JSON tool response for the SDK tools.
 * Runs the shared structure and API-error checks and rejects unexpected successes.
 * @param {Object} result - The result object from the MCP tool call
 * @param {Object} expected - Expected test outcomes
 * @returns {{ done: ValidationResult }|{ data: Object }} Final validation result, or the parsed data to validate further
 */
function parseToolResponse(result, expected) {
  const structureCheck = validateResponseStructure(result, expected);
  if (structureCheck) return { done: structureCheck };

  if (result.isError) {
    return { done: { valid: false, message: `Tool error: ${result.content[0].text.slice(0, 200)}` } };
  }

  const data = JSON.parse(result.content[0].text);

  const errorCheck = checkForApiError(data, expected);
  if (errorCheck) return { done: errorCheck };

  if (expected.shouldFail) {
    return { done: { valid: false, message: 'Expected failure but got success' } };
  }
  return { data };
}

/**
 * Helper function to validate a GeoJSON FeatureCollection of POI results (SDK search tools)
 * @param {Object} data - Parsed FeatureCollection
 * @param {Object} expected - Expected test outcomes
 * @param {boolean} [expected.hasResults] - Whether at least one feature is required
 * @param {string[]} [expected.contains] - Terms that must appear in the features
 * @param {number[]} [expected.withinBbox] - [minLon, minLat, maxLon, maxLat] every feature must fall inside
 * @returns {ValidationResult|null} Validation result if a check fails, null if all checks pass
 */
function checkPoiFeatureCollection(data, expected) {
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    return { valid: false, message: `Expected GeoJSON FeatureCollection, got ${data.type}` };
  }
  if (expected.hasResults && data.features.length === 0) {
    return { valid: false, message: 'No results found (empty features)' };
  }

  for (const [i, feature] of data.features.entries()) {
    if (feature.geometry?.type !== 'Point') {
      return { valid: false, message: `features[${i}] geometry is ${feature.geometry?.type}, expected Point` };
    }
    if (!feature.properties?.address) {
      return { valid: false, message: `features[${i}] missing properties.address` };
    }
    if (!feature.properties.poi?.name) {
      return { valid: false, message: `features[${i}] missing properties.poi.name` };
    }
    if (expected.withinBbox) {
      const [lon, lat] = feature.geometry.coordinates;
      const [minLon, minLat, maxLon, maxLat] = expected.withinBbox;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
        return { valid: false, message: `features[${i}] at [${lon}, ${lat}] is outside the requested area` };
      }
    }
  }

  if (expected.contains) {
    const featuresStr = JSON.stringify(data.features).toLowerCase();
    for (const term of expected.contains) {
      if (!featuresStr.includes(term.toLowerCase())) {
        return { valid: false, message: `Results don't contain "${term}"` };
      }
    }
  }

  return null;
}

/**
 * @typedef {Function} ValidatorFunction
 * @param {Object} result - The result object from the MCP tool call
 * @param {Object} expected - Expected test outcomes from test scenario
 * @returns {ValidationResult} The validation result
 */

/**
 * Validators - enhanced for comprehensive testing
 * @type {Object.<string, ValidatorFunction>}
 */
const validators = {
  "tomtom-traffic": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;
      
      const data = JSON.parse(result.content[0].text);
      
      const errorCheck = checkForApiError(data, expected);
      if (errorCheck) return errorCheck;
      
      if (!data.hasOwnProperty('incidents')) {
        if (expected.shouldFail) {
          return { valid: true, message: 'Failed as expected (missing incidents array)' };
        }
        return { valid: false, message: 'Missing incidents array in response' };
      }
      
      if (expected.hasResults && (!data.incidents || data.incidents.length === 0)) {
        return { valid: true, message: 'No incidents found (which is fine for testing)' };
      }
      
      return { valid: true, message: `Valid traffic data with ${data.incidents?.length || 0} incidents` };
      
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },
  
  "tomtom-routing": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;

      const data = JSON.parse(result.content[0].text);

      const errorCheck = checkForApiError(data, expected);
      if (errorCheck) return errorCheck;

      // Returns a GeoJSON FeatureCollection
      if (data.features && Array.isArray(data.features)) {
        if (data.features.length === 0) return { valid: true, message: 'No routes found (empty features)' };
        const summary = data.features[0]?.properties?.summary;
        const km = summary?.lengthInMeters ? ` (${(summary.lengthInMeters/1000).toFixed(1)}km)` : '';
        return { valid: true, message: `Valid routing GeoJSON with ${data.features.length} features${km}` };
      }

      return { valid: false, message: 'Expected a GeoJSON response' };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },
  
  "tomtom-reachable-range": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;

      const data = JSON.parse(result.content[0].text);

      const errorCheck = checkForApiError(data, expected);
      if (errorCheck) return errorCheck;

      // Returns a GeoJSON FeatureCollection with Polygon features
      if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        if (data.features.length === 0) return { valid: true, message: 'Empty features array but structure exists' };
        const first = data.features[0];
        if (first.geometry?.type !== 'Polygon') {
          return { valid: true, message: `Feature geometry is ${first.geometry?.type}, expected Polygon` };
        }
        return { valid: true, message: `Valid reachable range GeoJSON with ${data.features.length} range polygons` };
      }

      return { valid: false, message: 'Expected a GeoJSON response' };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },
  
  "tomtom-geocode": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;

      const data = JSON.parse(result.content[0].text);

      const errorCheck = checkForApiError(data, expected);
      if (errorCheck) return errorCheck;

      // Returns a GeoJSON FeatureCollection
      if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        if (data.features.length === 0) return { valid: true, message: 'No results found (empty features)' };
        return { valid: true, message: `Valid geocoding GeoJSON with ${data.features.length} features` };
      }

      return { valid: false, message: 'Expected a GeoJSON response' };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },
  
  "tomtom-reverse-geocode": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;

      const data = JSON.parse(result.content[0].text);

      const errorCheck = checkForApiError(data, expected);
      if (errorCheck) return errorCheck;

      // Returns a GeoJSON Feature
      if (data.type === 'Feature' && data.properties) {
        const addr = data.properties.address;
        if (!addr) return { valid: false, message: 'Missing properties.address in GeoJSON Feature' };
        return { valid: true, message: `Valid reverse geocoding GeoJSON Feature` };
      }

      return { valid: false, message: 'Expected a GeoJSON response' };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },
  
  "tomtom-nearby": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;

      const data = JSON.parse(result.content[0].text);

      const errorCheck = checkForApiError(data, expected);
      if (errorCheck) return errorCheck;

      // Returns a GeoJSON FeatureCollection
      if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        if (data.features.length === 0) return { valid: true, message: 'No nearby POIs found (empty features)' };
        return { valid: true, message: `Valid nearby search GeoJSON with ${data.features.length} POIs` };
      }

      return { valid: false, message: 'Expected a GeoJSON response' };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },
  
  "tomtom-fuzzy-search": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;

      const data = JSON.parse(result.content[0].text);

      const errorCheck = checkForApiError(data, expected);
      if (errorCheck) return errorCheck;

      // Returns a GeoJSON FeatureCollection
      if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        if (data.features.length === 0) return { valid: true, message: 'No search results found (empty features)' };
        return { valid: true, message: `Valid fuzzy search GeoJSON with ${data.features.length} features` };
      }

      return { valid: false, message: 'Expected a GeoJSON response' };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },
  
  "tomtom-dynamic-map": (result, expected) => {
    try {
      if (!result.content || !result.content[0]) {
        if (expected.shouldFail) {
          return { valid: true, message: 'Failed as expected (no content)' };
        }
        return { valid: false, message: 'No content in response' };
      }
      if (expected.shouldFail && result.isError) {
        return { valid: true, message: `Failed as expected (${result.content[0].text})` };
      }

      // Check for error responses in any text content block
      for (const c of result.content) {
        if (c.type === 'text' && c.text) {
          try {
            const errorData = JSON.parse(c.text);
            if (errorData.error) {
              if (expected.shouldFail && expected.expectedError) {
                if (errorData.error.includes(expected.expectedError)) {
                  return { valid: true, message: `Failed as expected: ${errorData.error}` };
                }
              }

              // Check if it's a helpful server unavailable error
              if (errorData.help && errorData.help.includes('Dynamic Map server')) {
                return { valid: true, message: 'Server unavailable with helpful guidance provided' };
              }

              if (expected.shouldFail) {
                return { valid: true, message: `Failed as expected: ${errorData.error}` };
              }

              return { valid: false, message: `Dynamic Map error: ${errorData.error}` };
            }
          } catch {
            // Not JSON or no error field, skip to next content block
          }
        }
      }

      if (expected.shouldFail) {
        return { valid: false, message: 'Expected failure but got a map' };
      }

      // content[0] is the text summary, content[1] the _meta block the MCP app reads
      if (result.content.some(c => c.type === 'image')) {
        return { valid: false, message: 'Dynamic map should not return an image block' };
      }
      const summary = result.content[0]?.type === 'text' ? result.content[0].text : '';
      if (!summary.startsWith('Dynamic map:') || !summary.includes('Contents:')) {
        return { valid: false, message: `Unexpected dynamic map summary: ${summary.slice(0, 120)}` };
      }
      if (expected.hasRoutes && !/\d+\.\d km, .+ by /.test(summary)) {
        return { valid: false, message: `Summary has no calculated route: ${summary}` };
      }

      let meta;
      try {
        meta = JSON.parse(result.content[1]?.text ?? '')._meta;
      } catch {
        meta = undefined;
      }
      if (!meta || meta.show_ui !== true || !meta.viz_id) {
        return { valid: false, message: 'Missing _meta block with show_ui and viz_id' };
      }

      return { valid: true, message: `Dynamic map state cached (viz_id ${meta.viz_id})` };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },

  "tomtom-data-viz": (result, expected) => {
    try {
      const structureCheck = validateResponseStructure(result, expected);
      if (structureCheck) return structureCheck;

      const rawText = result.content[0].text;

      // Schema validation errors come as plain text (not JSON) — e.g. "MCP error ..."
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        // Non-JSON error text (schema-level rejection)
        if (expected.shouldFail) {
          if (expected.expectedError && rawText.includes(expected.expectedError)) {
            return { valid: true, message: `Correctly rejected at schema level: ${rawText.slice(0, 100)}` };
          }
          return { valid: true, message: `Failed as expected at schema level: ${rawText.slice(0, 100)}` };
        }
        return { valid: false, message: `Unexpected non-JSON response: ${rawText.slice(0, 150)}` };
      }

      // For SSRF tests, check that the expected error message is present
      if (expected.shouldFail) {
        if (data.error && expected.expectedError && data.error.includes(expected.expectedError)) {
          return { valid: true, message: `Correctly rejected: ${data.error}` };
        }
        if (data.error) {
          return { valid: true, message: `Failed as expected: ${data.error}` };
        }
        return { valid: false, message: 'Expected failure but got success' };
      }

      // Happy path: validate summary structure
      if (!data.summary) return { valid: false, message: 'Missing summary in response' };
      if (typeof data.summary.feature_count !== 'number') return { valid: false, message: 'summary.feature_count not a number' };
      if (!data._meta?.viz_id) return { valid: false, message: 'Missing _meta.viz_id' };

      return { valid: true, message: `Valid data viz (${data.summary.feature_count} features, viz_id: ${data._meta.viz_id})` };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },

  "tomtom-poi-search": (result, expected) => {
    try {
      const parsed = parseToolResponse(result, expected);
      if (parsed.done) return parsed.done;
      const data = parsed.data;

      const poiCheck = checkPoiFeatureCollection(data, expected);
      if (poiCheck) return poiCheck;

      return { valid: true, message: `Valid POI search GeoJSON with ${data.features.length} POIs` };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },

  "tomtom-poi-categories": (result, expected) => {
    try {
      const parsed = parseToolResponse(result, expected);
      if (parsed.done) return parsed.done;
      const data = parsed.data;

      if (!Array.isArray(data.poiCategories)) {
        return { valid: false, message: 'Missing poiCategories array in response' };
      }
      if (expected.hasResults && data.poiCategories.length === 0) {
        return { valid: false, message: 'No POI categories found (empty poiCategories)' };
      }

      // Codes must be UPPER_SNAKE_CASE text, since search tools accept only these
      const invalid = data.poiCategories.find(c => typeof c.code !== 'string' || !/^[A-Z0-9_]+$/.test(c.code) || !c.name);
      if (invalid) {
        return { valid: false, message: `Invalid category entry: ${JSON.stringify(invalid).slice(0, 150)}` };
      }

      const codes = data.poiCategories.map(c => c.code);
      if (expected.containsCode && !codes.includes(expected.containsCode)) {
        return { valid: false, message: `Missing category code ${expected.containsCode} (got ${codes.join(', ')})` };
      }

      return { valid: true, message: `Valid POI categories: ${codes.join(', ')}` };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },

  "tomtom-area-search": (result, expected) => {
    try {
      const parsed = parseToolResponse(result, expected);
      if (parsed.done) return parsed.done;
      const data = parsed.data;

      const poiCheck = checkPoiFeatureCollection(data, expected);
      if (poiCheck) return poiCheck;

      return {
        valid: true,
        message: `Valid area search GeoJSON with ${data.features.length} POIs${expected.withinBbox ? ' (all inside area)' : ''}`
      };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },

  "tomtom-ev-search": (result, expected) => {
    try {
      const parsed = parseToolResponse(result, expected);
      if (parsed.done) return parsed.done;
      const data = parsed.data;

      const poiCheck = checkPoiFeatureCollection(data, expected);
      if (poiCheck) return poiCheck;

      for (const [i, feature] of data.features.entries()) {
        const connectors = feature.properties.chargingPark?.connectors;
        if (!Array.isArray(connectors) || connectors.length === 0) {
          return { valid: false, message: `features[${i}] missing chargingPark.connectors` };
        }
        if (expected.connectorType && !connectors.some(c => c.type === expected.connectorType)) {
          return { valid: false, message: `features[${i}] has no ${expected.connectorType} connector` };
        }
      }

      return { valid: true, message: `Valid EV search GeoJSON with ${data.features.length} charging stations` };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },

  "tomtom-search-along-route": (result, expected) => {
    try {
      const parsed = parseToolResponse(result, expected);
      if (parsed.done) return parsed.done;
      const data = parsed.data;

      const routeFeature = data.route?.features?.[0];
      if (routeFeature?.geometry?.type !== 'LineString') {
        return { valid: false, message: 'Missing route LineString feature in response' };
      }
      if (!data.pois) {
        return { valid: false, message: 'Missing pois in response' };
      }

      const poiCheck = checkPoiFeatureCollection(data.pois, expected);
      if (poiCheck) return poiCheck;

      if (typeof data.summary?.corridorWidthMeters !== 'number') {
        return { valid: false, message: 'summary.corridorWidthMeters not a number' };
      }
      if (data.summary.poiCount !== data.pois.features.length) {
        return { valid: false, message: `summary.poiCount (${data.summary.poiCount}) != pois returned (${data.pois.features.length})` };
      }

      return {
        valid: true,
        message: `Valid search along route with ${data.pois.features.length} POIs` +
                 `${data.summary.routeLengthMeters ? ' (' + (data.summary.routeLengthMeters/1000).toFixed(1) + 'km route)' : ''}`
      };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  },

  "tomtom-ev-routing": (result, expected) => {
    try {
      const parsed = parseToolResponse(result, expected);
      if (parsed.done) return parsed.done;
      const data = parsed.data;

      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        return { valid: false, message: `Expected GeoJSON FeatureCollection, got ${data.type}` };
      }
      if (expected.hasRoute && data.features.length === 0) {
        return { valid: false, message: 'No routes found (empty features)' };
      }

      const route = data.features[0];
      if (route.geometry?.type !== 'LineString') {
        return { valid: false, message: `Route geometry is ${route.geometry?.type}, expected LineString` };
      }
      const summary = route.properties?.summary;
      if (typeof summary?.lengthInMeters !== 'number' || typeof summary.travelTimeInSeconds !== 'number') {
        return { valid: false, message: 'Route summary missing lengthInMeters/travelTimeInSeconds' };
      }
      if (typeof summary.remainingChargeAtArrivalInPCT !== 'number') {
        return { valid: false, message: 'Route summary missing remainingChargeAtArrivalInPCT' };
      }

      const chargingStops = (route.properties.sections?.leg || [])
        .filter(leg => leg.summary?.chargingInformationAtEndOfLeg).length;
      if (expected.hasChargingStops && (chargingStops === 0 || !(summary.totalChargingTimeInSeconds > 0))) {
        return { valid: false, message: 'Expected charging stops but route has none' };
      }

      return {
        valid: true,
        message: `Valid EV route (${(summary.lengthInMeters/1000).toFixed(1)}km, ${chargingStops} charging stops, ` +
                 `${Math.round(summary.remainingChargeAtArrivalInPCT)}% at arrival)`
      };
    } catch (error) {
      return { valid: false, message: `Unexpected error: ${error.message}` };
    }
  }
};

// Results tracker
class TestResults {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }
  
  addResult(toolName, name, status, message, duration = null, details = null) {
    const result = {
      toolName,
      name,
      status,
      message,
      duration,
      details
    };
    
    this.results.push(result);
    
    if (status === 'PASS') {
      this.passed++;
      console.log(`  ✅ ${name} - ${message}${duration ? ` (${duration}ms)` : ''}`);
    } else if (status === 'FAIL') {
      this.failed++;
      console.log(`  ❌ ${name} - ${message}${duration ? ` (${duration}ms)` : ''}`);
      if (VERBOSE && details) {
        console.log(`    Details: ${JSON.stringify(details, null, 2)}`);
      }
    } else if (status === 'SKIP') {
      this.skipped++;
      console.log(`  ⏭️  ${name} - ${message}`);
    }
  }
  
  printSummary() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST SUMMARY: ${this.passed + this.failed + this.skipped} tests`);
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`⏭️  Skipped: ${this.skipped}`);
    console.log(`${'='.repeat(60)}`);
    
    if (this.failed > 0) {
      console.log('\nFailed tests:');
      this.results
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`  - ${r.toolName}/${r.name}: ${r.message}`));
    }
  }
  
  getPassPercentage() {
    const total = this.passed + this.failed;
    return total > 0 ? Math.round((this.passed / total) * 100) : 0;
  }
  
  getResultsByTool() {
    const byTool = {};
    
    for (const result of this.results) {
      if (!byTool[result.toolName]) {
        byTool[result.toolName] = { passed: 0, failed: 0, skipped: 0, total: 0 };
      }
      
      byTool[result.toolName].total++;
      
      if (result.status === 'PASS') {
        byTool[result.toolName].passed++;
      } else if (result.status === 'FAIL') {
        byTool[result.toolName].failed++;
      } else if (result.status === 'SKIP') {
        byTool[result.toolName].skipped++;
      }
    }
    
    return byTool;
  }
  
  printDetailedSummary() {
    const byTool = this.getResultsByTool();
    
    console.log('\nRESULTS BY TOOL:');
    console.log('----------------');
    
    for (const [toolName, counts] of Object.entries(byTool)) {
      const passRate = counts.total > 0 ? 
        Math.round((counts.passed / (counts.passed + counts.failed)) * 100) : 0;
      
      const statusSymbol = counts.failed > 0 ? '❌' : '✅';
      
      console.log(`${statusSymbol} ${toolName}: ${passRate}% passed (${counts.passed}/${counts.passed + counts.failed})`);
    }
  }
}

async function main() {
  
  try {
    // Check if server file exists
    console.log(`Found server at: ${serverPath}`);
    
    // Connect to server via STDIO
    console.log('Starting MCP server and connecting...');
    
    const client = new McpClient({
      name: "TomTom-MCP-Comprehensive-Test",
      version: "1.0.0"
    });
    
    // Create transport that will spawn the server
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: { ...process.env }
    });
    
    await client.connect(transport);
    console.log('✓ Connected to MCP server\n');
    
    // Get available tools
    const toolsResponse = await client.listTools();
    const availableTools = toolsResponse.tools.map(t => t.name);
    console.log(`Available tools: ${availableTools.join(', ')}\n`);
    
    // Determine which tools to test
    const toolsToTest = TEST_TOOL ?
      [TEST_TOOL] :
      Object.keys(TEST_SCENARIOS);

    // Track results
    const results = new TestResults();

    // Run tests for each tool
    for (const toolName of toolsToTest) {
      if (!TEST_SCENARIOS[toolName]) {
        results.addResult(toolName, 'setup', 'SKIP', `No test scenarios defined for tool ${toolName}`);
        continue;
      }

      console.log(`\n${toolName.toUpperCase()} TESTS`);
      console.log('-'.repeat(40));

      if (!availableTools.includes(toolName)) {
        results.addResult(toolName, 'availability', 'SKIP', `Tool ${toolName} not available on server`);
        continue;
      }

      // Run scenarios for this tool
      for (const scenario of TEST_SCENARIOS[toolName]) {
        const startTime = Date.now();
        
        try {
          // Delay between tests to avoid TomTom API rate limits
          await new Promise((r) => setTimeout(r, 1000));
          console.log(`  Testing: ${scenario.name}...`);
          
          if (VERBOSE) {
            console.log(`    Parameters: ${JSON.stringify(scenario.params)}`);
          }
          
          const result = await client.callTool({
            name: toolName,
            arguments: scenario.params
          });
          
          const duration = Date.now() - startTime;
          
          // Validate the result
          const validator = validators[toolName];
          if (validator) {
            const validation = validator(result, scenario.expected);
            
            if (validation.valid) {
              results.addResult(toolName, scenario.name, 'PASS', validation.message, duration);
            } else {
              results.addResult(toolName, scenario.name, 'FAIL', validation.message, duration, result);
            }
          } else {
            results.addResult(toolName, scenario.name, 'PASS', 'No validator available for tool', duration);
          }
          
        } catch (error) {
          const duration = Date.now() - startTime;
          if (scenario.expected?.shouldFail) {
            const msg = error.message || String(error);
            if (scenario.expected.expectedError && msg.includes(scenario.expected.expectedError)) {
              results.addResult(toolName, scenario.name, 'PASS', `Correctly rejected: ${msg.slice(0, 100)}`, duration);
            } else {
              results.addResult(toolName, scenario.name, 'PASS', `Failed as expected: ${msg.slice(0, 100)}`, duration);
            }
          } else {
            results.addResult(toolName, scenario.name, 'FAIL', `Unexpected error: ${error.message}`, duration, { error: error.message });
          }
        }
      }
    }
    
    // Print summary
    results.printSummary();
    results.printDetailedSummary();
    
    // Clean shutdown
    console.log('\nShutting down...');
    await client.close();
    
    // Exit with appropriate code
    process.exit(results.failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error(`\n✗ Test execution failed: ${error.message}`);
    if (VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Handle signals to ensure clean shutdown
process.on('SIGINT', () => {
  console.log('\nReceived interrupt signal, shutting down...');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\nReceived terminate signal, shutting down...');
  process.exit(1);
});

main().catch(err => {
  console.error(`Unhandled error: ${err.message}`);
  if (VERBOSE) {
    console.error(err.stack);
  }
  process.exit(1);
});
