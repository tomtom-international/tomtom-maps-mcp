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
 * Schema for BYOD (Bring Your Own Data) visualization tool.
 * Lets users visualize their own GeoJSON data on a TomTom basemap
 * with support for multiple layer types: markers, heatmap, clusters,
 * lines, fills, and choropleths.
 */

import { z } from "zod";
import { uiVisibilityParam } from "../search/commonOrbis";

/**
 * Layer configuration schema.
 * Each layer defines how a subset (or all) of the GeoJSON data should be rendered.
 */
const layerConfigSchema = z.object({
  type: z
    .enum(["markers", "heatmap", "clusters", "line", "fill", "choropleth"])
    .describe(
      "Visualization type. " +
        "'markers': circle markers for Point data. " +
        "'heatmap': density heatmap for Point data. " +
        "'clusters': clustered markers that aggregate nearby points. " +
        "'line': rendered lines for LineString/MultiLineString data. " +
        "'fill': solid polygon fills for Polygon/MultiPolygon data. " +
        "'choropleth': data-driven colored polygons — requires color_property."
    ),

  color_property: z
    .string()
    .optional()
    .describe(
      "Property name for data-driven coloring. The property value determines the color of each feature. " +
        "Required for 'choropleth'. Optional for 'markers', 'line', 'fill'. " +
        "Example: 'population', 'temperature', 'category'."
    ),

  color_scale: z
    .array(z.string())
    .length(2)
    .optional()
    .describe(
      "Two-color gradient for data-driven styling: [min_color, max_color]. " +
        "Colors as hex strings. Example: ['#2196F3', '#F44336'] for blue-to-red. " +
        "Defaults to ['#2196F3', '#F44336'] if color_property is set."
    ),

  size_property: z
    .string()
    .optional()
    .describe(
      "Property name for data-driven sizing. Applies to 'markers' (circle radius) " +
        "and 'line' (line width). Example: 'magnitude', 'count'."
    ),

  label_property: z
    .string()
    .optional()
    .describe(
      "Property name used as the popup title when a feature is clicked. " +
        "Example: 'name', 'title', 'id'."
    ),

  popup_fields: z
    .array(z.string())
    .optional()
    .describe(
      "Property names to display in the click popup. " +
        "Example: ['name', 'address', 'phone']. If omitted, all properties are shown."
    ),

  cluster_radius: z
    .number()
    .optional()
    .describe("Cluster radius in pixels for 'clusters' type. Default: 50."),

  heatmap_weight: z
    .string()
    .optional()
    .describe(
      "Property name for heatmap weight. Higher values create hotter spots. " +
        "Example: 'intensity', 'count'. If omitted, all points are weighted equally."
    ),

  heatmap_intensity: z
    .number()
    .optional()
    .describe("Heatmap intensity multiplier. Default: 1. Increase for sparser data."),

  line_width: z.number().optional().describe("Line width in pixels for 'line' type. Default: 2."),

  fill_opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Fill opacity for 'fill' and 'choropleth' types. 0 = transparent, 1 = opaque. Default: 0.7."
    ),

  filter_property: z
    .string()
    .optional()
    .describe(
      "Property name to filter features for this layer. Use with filter_values to split " +
        "a single dataset across multiple layers. Example: 'type'."
    ),

  filter_values: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe(
      "Values of filter_property to include in this layer. " +
        "Example: ['restaurant', 'cafe'] to show only those types."
    ),
});

export const tomtomDataVizSchema = {
  data_url: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), { message: "Only https URLs are allowed" })
    .optional()
    .describe(
      "HTTPS URL to fetch GeoJSON data from (server-side). Supports FeatureCollection or single Feature. " +
        "Max 50MB, 30s timeout. Mutually exclusive with 'geojson'. " +
        "Preferred for large datasets. Example: 'https://example.com/data.geojson'."
    ),

  geojson: z
    .string()
    .optional()
    .describe(
      "Inline GeoJSON string. Must be a valid FeatureCollection or Feature object. " +
        "Max 10MB. Mutually exclusive with 'data_url'. " +
        "For larger datasets, host the file and use 'data_url' instead."
    ),

  layers: z
    .array(layerConfigSchema)
    .min(1)
    .max(10)
    .describe(
      "Array of layer configurations (max 10). Each layer defines how to visualize the data. " +
        "Multiple layers can overlay different visualization types on the same data. " +
        "Example: [{ type: 'heatmap' }, { type: 'markers', label_property: 'name' }]."
    ),

  title: z
    .string()
    .optional()
    .describe("Display title shown as an overlay on the map. Example: 'Store Locations'."),

  ...uiVisibilityParam,
};

export type DataVizOrbisParams = z.input<z.ZodObject<typeof tomtomDataVizSchema>>;
