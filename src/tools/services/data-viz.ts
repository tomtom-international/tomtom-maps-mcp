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
 * and caches the full data for the App to retrieve.
 */

import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import axios from "axios";
import * as ipaddr from "ipaddr.js";
import type { DataVizParams } from "../../schemas/dataViz/dataVizSchema";
import {
  datasetMeta,
  explainMissingDataset,
  getDataset,
  storeDataset,
} from "../../services/datasets/dataset-store";
import {
  type GeoJSONFeatureCollection,
  normalizeToFeatureCollection,
} from "../../services/datasets/geojson";
import { summarize } from "../../services/datasets/summarize";
import { handleApiError } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import type { ToolResponse } from "../shared/tool-entry";

const MAX_URL_SIZE = 50 * 1024 * 1024; // 50MB for URL fetch
const MAX_INLINE_SIZE = 10 * 1024 * 1024; // 10MB for inline GeoJSON
const MAX_FEATURES = 100_000; // 100K features
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
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only https URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
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
    throw new Error("URL resolves to a non-public IP address");
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
  } finally {
    agent.destroy();
  }
}

// ---------------------------------------------------------------------------

interface VizLayer {
  type: string;
  color_property?: string;
  [key: string]: unknown;
}

/**
 * BYOD data-visualization tool executor.
 *
 * Hand-written rather than built with `defineDataTool`: it has no upstream API
 * call to wrap, and it already does what phase 1 generalises — it returns a
 * SUMMARY of the data plus a handle, never the data itself. `computeSummary`
 * below is the seed of the shared `summarize()` the other tools will adopt.
 */
export async function dataVizHandler(params: DataVizParams): Promise<ToolResponse> {
  try {
    const { show_ui = true, dataset_id, data_url, geojson, layers, title } = params;

    // Exactly one source. Listing them makes the error name the actual mistake
    // ("you passed two") rather than restating the rule.
    const sources = [
      dataset_id && "dataset_id",
      data_url && "data_url",
      geojson && "geojson",
    ].filter(Boolean);
    if (sources.length === 0) {
      throw new Error(
        "Provide one data source: 'dataset_id' (cheapest — data already server-side), " +
          "'data_url', or 'geojson'."
      );
    }
    if (sources.length > 1) {
      throw new Error(`Provide only ONE data source; got ${sources.join(" and ")}.`);
    }

    // Validate layer count
    if (layers.length > MAX_LAYERS) {
      throw new Error(`Too many layers: ${layers.length}. Maximum is ${MAX_LAYERS}.`);
    }

    // Validate choropleth requires color_property
    for (const layer of layers) {
      if (layer.type === "choropleth" && !layer.color_property) {
        throw new Error("'choropleth' layer type requires 'color_property'");
      }
    }

    logger.info(
      { source: sources[0], dataset_id, data_url, layerCount: layers.length, title },
      "Data viz request"
    );

    // Fetch, read, or parse the GeoJSON
    let rawData: unknown;
    if (dataset_id) {
      const dataset = getDataset(dataset_id);
      if (!dataset) throw new Error(explainMissingDataset(dataset_id));
      // A dataset holds a tool response, whose features may sit under `features`,
      // `incidents`, or (for a BYOD dataset) `geojson`. Normalisation below wants
      // a GeoJSON-shaped value, so unwrap the BYOD envelope first.
      const held = dataset.data as { geojson?: unknown } | null;
      rawData = held && typeof held === "object" && held.geojson ? held.geojson : dataset.data;
    } else if (data_url) {
      rawData = await fetchGeoJSON(data_url);
    } else {
      // Validate inline GeoJSON size
      if (geojson!.length > MAX_INLINE_SIZE) {
        const sizeMB = (geojson!.length / (1024 * 1024)).toFixed(1);
        throw new Error(
          `Inline GeoJSON too large: ${sizeMB}MB. Maximum is ${MAX_INLINE_SIZE / (1024 * 1024)}MB. ` +
            `For large datasets, host the file and use 'data_url' instead (up to ${MAX_URL_SIZE / (1024 * 1024)}MB).`
        );
      }
      try {
        rawData = JSON.parse(geojson!) as unknown;
      } catch {
        throw new Error("Invalid 'geojson' parameter: failed to parse JSON string");
      }
    }

    // Normalize to FeatureCollection
    const fc = normalizeToFeatureCollection(rawData);

    if (fc.features.length === 0) {
      throw new Error("GeoJSON contains no features");
    }

    // Validate feature count
    if (fc.features.length > MAX_FEATURES) {
      throw new Error(
        `Too many features: ${fc.features.length.toLocaleString()}. Maximum is ${MAX_FEATURES.toLocaleString()}. ` +
          `Consider filtering or aggregating the data before visualization.`
      );
    }

    // The shared summarizer, same as every other dataset gets. This tool's own
    // `computeSummary` was the prototype for it; keeping a second implementation
    // would just let the two descriptions drift.
    const summary = summarize(fc, "byod");

    logger.info(
      { featureCount: summary.count, geometryTypes: summary.geometryTypes },
      "Data viz: GeoJSON processed"
    );

    // Store the full GeoJSON + layer config; the app redeems it to draw, and
    // describe-dataset / analyse-data can query it.
    const dataset = storeDataset({
      data: { geojson: fc, layers, title, bbox: summary.bbox },
      kind: "byod",
      provenance: { tool: "tomtom-data-viz", params: { dataset_id, data_url, layers, title } },
    });

    // Return summary (no coordinates) to the agent, dataset_id for the app
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              summary,
              layers_applied: layers.map((l) => l.type),
              title: title || null,
              _meta: datasetMeta(dataset, show_ui),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const formattedError = handleApiError(error, "Data visualization");
    logger.error({ error: formattedError.message }, "Data viz failed");
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: formattedError.message }) }],
      isError: true,
    };
  }
}
