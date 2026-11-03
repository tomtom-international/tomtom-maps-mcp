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
 * `locationInput` — the two ways to name a place, accepted everywhere
 * (*Location input* in CONTEXT.md). `tools/shared/inputs/location-input.ts`
 * resolves it.
 */

import { z } from "zod";
import { coordinateSchema } from "../routing/common";
import { orJsonString } from "./jsonString";

export const locationInputSchema = orJsonString(
  z.union(
    [
      z.object({
        query: z
          .string()
          .describe(
            'Place name or address to resolve, e.g. "Amsterdam Centraal" or "Damrak 1, ' +
              'Amsterdam". Qualify a name several places share: "Paris, France".'
          ),
      }),
      z.object({
        position: coordinateSchema.describe(
          "Explicit [longitude, latitude] — GeoJSON order, longitude FIRST. Use when you already " +
            "have coordinates, e.g. from an earlier result: it skips looking the name up again. " +
            "lng in [-180, 180], lat in [-90, 90]."
        ),
      }),
    ],
    {
      error: (issue) =>
        issue.code === "invalid_union"
          ? "A location is an object: { query } or { position: [longitude, latitude] }."
          : undefined,
    }
  )
);

export type LocationInput = z.infer<typeof locationInputSchema>;
