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
 * GeoJSON normalisation for caller-supplied shapes: a model passes whatever it
 * produced — a FeatureCollection, a lone Feature, a bare geometry, or a plain
 * array of features. The error messages are part of the contract with the model.
 */

import type { Feature, FeatureCollection, Geometry } from "geojson";
import { IncorrectError } from "../../types/types";

/**
 * Coerces a caller-supplied value into a FeatureCollection.
 *
 * Accepts, in order of how often a model produces it:
 * a FeatureCollection, a bare `Feature[]`, a single Feature, a bare geometry.
 *
 * Throws with a message aimed at the model, which has to fix the input: a vague
 * "invalid GeoJSON" costs a whole retry.
 */
export function normalizeToFeatureCollection(data: unknown): FeatureCollection {
  if (!data || typeof data !== "object") {
    throw new IncorrectError("Invalid GeoJSON: expected an object.", {
      type: data === null ? "null" : typeof data,
    });
  }

  // A bare array of Features — what `features.filter(...)` yields.
  if (Array.isArray(data)) {
    const invalid = data.findIndex(
      (item) => !item || typeof item !== "object" || (item as { type?: string }).type !== "Feature"
    );
    if (invalid !== -1) {
      throw new IncorrectError(
        "Invalid GeoJSON: an array element is not a Feature. Return an array of whole " +
          'features (each with `type: "Feature"`), or a FeatureCollection.',
        { index: invalid }
      );
    }
    return { type: "FeatureCollection", features: data as Feature[] };
  }

  const record = data as Record<string, unknown>;

  if (record.type === "FeatureCollection") {
    if (!Array.isArray(record.features)) {
      throw new IncorrectError(
        "Invalid GeoJSON: FeatureCollection is missing its 'features' array."
      );
    }
    return record as unknown as FeatureCollection;
  }

  if (record.type === "Feature") {
    return { type: "FeatureCollection", features: [record as unknown as Feature] };
  }

  // Bare geometry — wrap in a Feature, then a FeatureCollection. A
  // GeometryCollection holds `geometries` rather than `coordinates`.
  if (record.type && (record.coordinates || record.type === "GeometryCollection")) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: record as unknown as Geometry,
          properties: {},
        },
      ],
    };
  }

  throw new IncorrectError(
    "Invalid GeoJSON: expected a FeatureCollection, a Feature, an array of Features, or a geometry.",
    { type: String(record.type) }
  );
}
