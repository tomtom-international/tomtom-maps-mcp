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
 * GeoJSON normalisation, shared by the tools that accept caller-supplied shapes.
 *
 * Extracted from `tools/services/data-viz.ts`, where it was private. Phase 3
 * needs the same coercion for sandbox code, which returns whatever
 * an LLM felt like returning — a FeatureCollection, a lone Feature, a bare
 * geometry, or a plain array of features. Two copies of these rules would drift,
 * and the error messages are part of the contract with the model.
 */

/** GeoJSON types, minimal — enough to validate and normalise. */
export interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

/**
 * Coerces a caller-supplied value into a FeatureCollection.
 *
 * Accepts, in order of how often a model produces it:
 * a FeatureCollection, a bare `Feature[]`, a single Feature, a bare geometry.
 *
 * Throws with a message aimed at whoever has to fix the input — for sandbox code
 * that is the model, and a vague "invalid GeoJSON" costs a whole retry.
 */
export function normalizeToFeatureCollection(data: unknown): GeoJSONFeatureCollection {
  if (!data || typeof data !== "object") {
    throw new Error(
      `Invalid GeoJSON: expected an object, got ${data === null ? "null" : typeof data}.`
    );
  }

  // A bare array of Features — the single most common shape returned by
  // generated code, since `features.filter(...)` yields exactly that.
  if (Array.isArray(data)) {
    const invalid = data.findIndex(
      (item) => !item || typeof item !== "object" || (item as { type?: string }).type !== "Feature"
    );
    if (invalid !== -1) {
      throw new Error(
        `Invalid GeoJSON: array element ${invalid} is not a Feature. Return an array of whole ` +
          'features (each with `type: "Feature"`), or a FeatureCollection.'
      );
    }
    return { type: "FeatureCollection", features: data as GeoJSONFeature[] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.type === "FeatureCollection") {
    if (!Array.isArray(obj.features)) {
      throw new Error("Invalid GeoJSON: FeatureCollection is missing its 'features' array.");
    }
    return obj as unknown as GeoJSONFeatureCollection;
  }

  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [obj as unknown as GeoJSONFeature] };
  }

  // Bare geometry — wrap in a Feature, then a FeatureCollection.
  if (obj.type && obj.coordinates) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: obj as { type: string; coordinates: unknown },
          properties: {},
        },
      ],
    };
  }

  throw new Error(
    "Invalid GeoJSON: expected a FeatureCollection, a Feature, an array of Features, or a " +
      `geometry. Got an object with type="${String(obj.type)}".`
  );
}
