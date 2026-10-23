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
 * Handler for BYOD Data Visualization tool.
 * Fetches/parses GeoJSON data, validates it, computes a summary for the agent,
 * and hands the full data to the App.
 */

import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import axios from "axios";
import * as ipaddr from "ipaddr.js";
import type { DataVizParams } from "../../schemas/dataViz/dataVizSchema";
import { normalizeToFeatureCollection } from "../../services/datasets/geojson";
import { summarize } from "../../services/datasets/summarize";
import { IncorrectError } from "../../types/types";
import { fromUrlStatus } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { buildCompressedResponse, buildErrorResponse } from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

const MAX_URL_SIZE = 50 * 1024 * 1024; // 50MB for URL fetch
const MAX_INLINE_SIZE = 10 * 1024 * 1024; // 10MB for inline GeoJSON
const MAX_FEATURES = 100_000;
const MAX_LAYERS = 10;
const FETCH_TIMEOUT = 30_000; // 30s

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function validateUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IncorrectError("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new IncorrectError("Only https URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new IncorrectError("URLs with credentials are not allowed");
  }

  const hostname = parsed.hostname;

  // Resolve DNS to get the actual IP (or use the IP literal directly)
  let resolvedIp: string;
  if (isIP(hostname)) {
    resolvedIp = hostname;
  } else {
    const result = await lookup(hostname);
    resolvedIp = result.address;
  }

  // ipaddr.js classifies the IP — only allow "unicast" (public internet)
  const addr = ipaddr.process(resolvedIp);
  if (addr.range() !== "unicast") {
    logger.warn({ hostname, resolvedIp, range: addr.range() }, "Blocked non-public URL");
    throw new IncorrectError("URL resolves to a non-public IP address");
  }

  return resolvedIp;
}

async function fetchGeoJSON(url: string): Promise<unknown> {
  const resolvedIp = await validateUrl(url);

  // Pin DNS to the validated IP to prevent DNS rebinding.
  // Node 20+ enables autoSelectFamily (Happy Eyeballs) by default, which calls
  // lookup with { all: true } and expects an array of { address, family }
  // entries — answering with a plain string there makes net read
  // addresses[0].address as undefined ("Invalid IP address: undefined").
  const agent = new https.Agent({
    lookup: (_hostname, options, callback) => {
      const family = isIP(resolvedIp) === 6 ? 6 : 4;
      if (options.all) {
        callback(null, [{ address: resolvedIp, family }]);
      } else {
        callback(null, resolvedIp, family);
      }
    },
  });

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT,
      maxContentLength: MAX_URL_SIZE,
      maxBodyLength: MAX_URL_SIZE,
      headers: { Accept: "application/geo+json, application/json" },
      responseType: "json",
      httpsAgent: agent,
      maxRedirects: 0,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw fromUrlStatus(error.response.status, error);
    }
    throw error;
  } finally {
    agent.destroy();
  }
}

// ---------------------------------------------------------------------------

/**
 * BYOD data-visualization tool executor.
 *
 * Builds its own response, as it has no upstream API call to trim: the model gets
 * a summary of the data, and only the app gets the data itself.
 */
export async function dataVizHandler(params: DataVizParams): Promise<ToolResponse> {
  try {
    const { show_ui = true, data_url, geojson, layers, title } = params;

    // Exactly one source. Listing them makes the error name the actual mistake
    // ("you passed two") rather than restating the rule.
    const sources = [data_url && "data_url", geojson && "geojson"].filter(Boolean);
    if (sources.length === 0) {
      throw new IncorrectError("Provide one data source: 'data_url' or 'geojson'.");
    }
    if (sources.length > 1) {
      throw new IncorrectError("Provide only ONE data source.", { sources });
    }

    if (layers.length > MAX_LAYERS) {
      throw new IncorrectError("Too many layers", {
        layerCount: layers.length,
        maxLayers: MAX_LAYERS,
      });
    }

    for (const layer of layers) {
      if (layer.type === "choropleth" && !layer.color_property) {
        throw new IncorrectError("'choropleth' layer type requires 'color_property'");
      }
    }

    logger.info(
      { source: sources[0], data_url, layerCount: layers.length, title },
      "Data viz request"
    );

    let rawData: unknown;
    if (data_url) {
      rawData = await fetchGeoJSON(data_url);
    } else {
      if (geojson!.length > MAX_INLINE_SIZE) {
        throw new IncorrectError(
          "Inline GeoJSON too large. For large datasets, host the file and use 'data_url' instead.",
          {
            sizeBytes: geojson!.length,
            maxInlineBytes: MAX_INLINE_SIZE,
            maxUrlBytes: MAX_URL_SIZE,
          }
        );
      }
      try {
        rawData = JSON.parse(geojson!) as unknown;
      } catch {
        throw new IncorrectError("Invalid 'geojson' parameter: failed to parse JSON string");
      }
    }

    const fc = normalizeToFeatureCollection(rawData);

    if (fc.features.length === 0) {
      throw new IncorrectError("GeoJSON contains no features");
    }

    if (fc.features.length > MAX_FEATURES) {
      throw new IncorrectError(
        "Too many features. Filter or aggregate the data before visualizing it.",
        { featureCount: fc.features.length, maxFeatures: MAX_FEATURES }
      );
    }

    const summary = summarize(fc, "byod");

    logger.info(
      { featureCount: summary.count, geometryTypes: summary.geometryTypes },
      "Data viz: GeoJSON processed"
    );

    return await buildCompressedResponse(
      { summary, layers_applied: layers.map((layer) => layer.type), title: title || null },
      { geojson: fc, layers, title, bbox: summary.bbox },
      // The caller's own data is drawn as given, never simplified.
      { showUI: show_ui, exact: true }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Data visualization");
  }
}
