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
 * `where` — the scope a place search or traffic query covers (*Scope* in
 * CONTEXT.md): `within` an area, `nearby` a point, or `global`. The resolvers in
 * `tools/shared/inputs/resolve-where.ts` turn it into areas and points.
 */

import { z } from "zod";
import { coordinateSchema } from "../routing/common";

/**
 * Most names, and most polygons, one `within` takes. Each name costs a geocode,
 * and each area its share of a traffic request.
 */
const MAX_WITHIN_AREAS = 10;

const geometrySchema = z
  .object({
    type: z.enum(["Polygon", "MultiPolygon"]),
    coordinates: z.array(z.unknown()),
  })
  .describe("A GeoJSON Polygon or MultiPolygon, [longitude, latitude] positions.");

/**
 * One `where` mode. Strict, so an input of another mode is an error rather than
 * dropped, and the error names what this mode takes: the SDK shows the model
 * only each issue's message.
 */
export const modeBranch = <Mode extends string, Shape extends z.ZodRawShape>(
  mode: Mode,
  shape: Shape
) => {
  const inputs = Object.keys(shape);
  return z.strictObject(
    { mode: z.literal(mode), ...shape },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `Mode "${mode}" does not take ${issue.keys.join(", ")}; it takes ` +
            `${inputs.join(", ") || "nothing besides mode"}.`
          : undefined,
    }
  );
};

type ModeBranch = ReturnType<typeof modeBranch>;

/** The `where` modes a tool accepts; an input matching none names each mode and its inputs. */
export const modeUnion = <const Branches extends readonly [ModeBranch, ...ModeBranch[]]>(
  branches: Branches
) => {
  const modes = branches.map(({ shape }) => {
    const inputs = Object.keys(shape).filter((key) => key !== "mode");
    return `"${shape.mode.value}"${inputs.length ? ` (${inputs.join(", ")})` : ""}`;
  });
  return z.union(branches, {
    error: (issue) => {
      if (issue.code !== "invalid_union") return undefined;
      // The branch whose `mode` matched: its own issues say what to fix, where
      // "mode must be one of" would send the model to another mode.
      const matched = issue.errors.find((errors) => !errors.some(({ path }) => path[0] === "mode"));
      if (!matched?.length) return `\`mode\` must be one of ${modes.join(", ")}.`;
      return matched
        .map(({ path, message }) => (path.length ? `${path.join(".")}: ${message}` : message))
        .join(" ");
    },
  });
};

export const knownAreaSchema = z.object({
  name: z.string().describe("The area's name, as the earlier result gave it."),
  boundingBox: z.array(z.number()).length(4).describe("[west, south, east, north] in degrees."),
});

/** `within` — an AREA. Every supplied field resolves and the results are unioned. */
export const withinWhereSchema = modeBranch("within", {
  queries: z
    .array(z.string())
    .min(1)
    .max(MAX_WITHIN_AREAS)
    .optional()
    .describe(
      'Names of the CITIES, DISTRICTS OR NEIGHBOURHOODS to search inside, e.g. ["Amsterdam"], ' +
        '["De Jordaan, Amsterdam"]. Answers "search WHERE", never "search for WHAT": for ' +
        '"restaurants in Paris" the subject goes in `poiCategories`/`query` and "Paris" goes here. ' +
        "Each name resolves to that area's bounding box. Qualify a name that several places " +
        'share ("Westminster, London"). A landmark or venue is not an area: use mode "nearby".'
    ),
  areas: z
    .array(knownAreaSchema)
    .min(1)
    .max(MAX_WITHIN_AREAS)
    .optional()
    .describe(
      "Areas an earlier result already resolved: copy each `searched.resolvedAreas[].area`, or a " +
        "located area's `area`, here unchanged to search the same area again instead of naming " +
        "it in `queries`. It resolves to the same bounds without geocoding the name again."
    ),
  boundingBox: z
    .array(z.number())
    .length(4)
    .optional()
    .describe("Explicit [west, south, east, north] in degrees. Use when you already have bounds."),
  geometries: z
    .array(geometrySchema)
    .min(1)
    .max(MAX_WITHIN_AREAS)
    .optional()
    .describe("Explicit GeoJSON Polygons / MultiPolygons. For named areas use `queries` instead."),
});

/** `nearby` — a POINT bias plus a radius. */
export const nearbyWhereSchema = modeBranch("nearby", {
  position: coordinateSchema.optional().describe("The point to search around."),
  query: z
    .string()
    .optional()
    .describe(
      'A place name to search around, e.g. "Amsterdam Centraal" or "Dam Square, Amsterdam". ' +
        "Resolved to a point for you: name a landmark here rather than locating it first."
    ),
  radiusMeters: z
    .number()
    .positive()
    .optional()
    .describe("Search radius in metres (default 1000)."),
});

/** `global` — no geographic constraint. */
export const globalWhereSchema = modeBranch("global", {});

/** The opening of every `where` description, through the modes all of them share. */
export const WHERE_DOC =
  "Geographic scope, selected by `mode`. " +
  "`within` — an AREA: any combination of `queries` (city, district or neighbourhood names → " +
  "their bounding boxes), `areas` (an earlier result's `resolvedAreas[].area`), `boundingBox` or " +
  "`geometries`; all supplied fields are unioned. " +
  "`nearby` — a POINT bias with `radiusMeters`, given as `position` or `query`. ";

/** A place's scope: an area, a point bias, or nowhere in particular. */
export const whereSchema = modeUnion([
  withinWhereSchema,
  nearbyWhereSchema,
  globalWhereSchema,
]).describe(`${WHERE_DOC}\`global\` — no constraint, for a uniquely-named target.`);

export type Where = z.infer<typeof whereSchema>;
export type WithinWhere = z.infer<typeof withinWhereSchema>;
export type NearbyWhere = z.infer<typeof nearbyWhereSchema>;
