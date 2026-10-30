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

import { z } from "zod";

const decodeJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * `schema`, also taking what it accepts sent as a JSON string, or as an array of
 * JSON strings, as Claude's clients sometimes send an object or array argument.
 * Only a value `schema` rejects is decoded, so a string input such as a GeoJSON
 * document stays a string; the tool's advertised JSON Schema is `schema`'s own.
 */
export const orJsonString = <T extends z.core.$ZodType>(schema: T) =>
  z.preprocess<unknown, T, z.input<T>>((value) => {
    if (z.safeParse(schema, value).success) return value;
    const decoded = decodeJson(value);
    return Array.isArray(decoded) ? decoded.map(decodeJson) : decoded;
  }, schema);
