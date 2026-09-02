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
 * `where` — one geographic-scope field with four modes, and the resolver behind it.
 *
 * Ported from the agent toolkit's `tools/shared/resolve-where.ts`. This is what
 * collapses seven search tools into one: `area-search` (polygon/bbox),
 * `nearby` (radius from a point), `search-along-route` (corridor),
 * `poi-search` / `fuzzy-search` (biased or unbiased) stop being separate tools and
 * become `mode` values on a shared field.
 *
 * The other thing it buys is the reason "restaurants in De Jordaan" used to be
 * hopeless: a `queries` entry resolves to the area's **boundary polygon** where
 * one is available, not a bounding box. Searching De Jordaan by bbox returns half
 * of central Amsterdam.
 *
 * Two deliberate divergences from the toolkit, both forced by statelessness:
 *
 * - **No `viewport`.** The toolkit falls back to live map bounds and re-ranks
 *   geocode candidates by distance to the viewport centre. A stateless server has
 *   no map, so that mode is gone — and ambiguity resolution is genuinely weaker
 *   as a result. `bias` exists so a caller that knows the user's rough location
 *   can supply it; without one, nothing distinguishes Springfield MO from
 *   Springfield IL and the geocoder's own ranking decides.
 */

import type { BBox } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { z } from "zod";
import { geocodeAddress } from "../../../services/search/searchService";

/** Where a resolved area came from, for reporting back what was actually searched. */
export type AreaSource = "boundingBox" | "query" | "geometry" | "dataset" | "route";

export interface ResolvedArea {
  bbox?: BBox;
  polygon?: { type: string; coordinates: unknown };
  /** The GROUNDED match — what the data was loaded for, not the query echo. */
  label?: string;
  source: AreaSource;
  /** The input text for a `query` area, so "asked" can be paired with "matched". */
  query?: string;
}

/** A point bias for `nearby`, with the radius the caller asked for. */
export interface ResolvedBias {
  position?: Position;
  radiusMeters?: number;
  label?: string;
}

const positionSchema = z
  .array(z.number())
  .length(2)
  .describe("[longitude, latitude] — GeoJSON order, longitude FIRST.");

const geometrySchema = z
  .object({
    type: z.enum(["Polygon", "MultiPolygon"]),
    coordinates: z.array(z.unknown()),
  })
  .describe("A GeoJSON Polygon or MultiPolygon.");

/** `within` — an AREA. Every supplied field resolves and the results are unioned. */
const withinWhereSchema = z.object({
  mode: z.literal("within"),
  queries: z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      'Names of CONTAINING areas to search inside — e.g. ["Amsterdam"], ["De Jordaan, Amsterdam"]. ' +
        'Answers "search WHERE", never "search for WHAT". ' +
        'For "restaurants in Paris": the subject "restaurants" goes in `poiCategories`/`query`, ' +
        'and "Paris" goes here. Each name resolves to its boundary polygon where one exists, so ' +
        "a neighbourhood search is genuinely confined to the neighbourhood."
    ),
  boundingBox: z
    .array(z.number())
    .length(4)
    .optional()
    .describe("Explicit [west, south, east, north]. Use when you already have exact bounds."),
  geometries: z
    .array(geometrySchema)
    .min(1)
    .optional()
    .describe("Explicit GeoJSON Polygons / MultiPolygons. For named areas use `queries` instead."),
});

/** `nearby` — a POINT bias plus a radius. */
const nearbyWhereSchema = z.object({
  mode: z.literal("nearby"),
  position: positionSchema.optional().describe("The point to search around."),
  query: z
    .string()
    .optional()
    .describe('A place name to search around, e.g. "Amsterdam Centraal". Resolved to a point.'),
  radiusMeters: z
    .number()
    .positive()
    .optional()
    .describe("Search radius in metres (default 1000)."),
});

/** `global` — no geographic constraint. */
const globalWhereSchema = z.object({
  mode: z.literal("global"),
});

export const whereSchema = z
  .union([withinWhereSchema, nearbyWhereSchema, globalWhereSchema])
  .describe(
    "Geographic scope, selected by `mode`. " +
      "`within` — an AREA: any combination of `queries` (area names → boundary polygons), " +
      "`boundingBox` or `geometries`; all supplied fields are unioned. " +
      "`nearby` — a POINT bias with `radiusMeters`, given as `position` or `query`. " +
      "`global` — no constraint, for a uniquely-named target. " +
      'Default when omitted: `{ mode: "nearby" }` around any bias the tool has, else `global`.'
  );

export type Where = z.infer<typeof whereSchema>;
export type WithinWhere = z.infer<typeof withinWhereSchema>;
export type NearbyWhere = z.infer<typeof nearbyWhereSchema>;

/**
 * Resolves a `within` scope to one or more areas.
 *
 * Explicit fields are unioned. A `queries` entry that resolves to nothing is a
 * hard failure rather than a silent widening: "restaurants in Atlantis" returning
 * results from wherever the geocoder guessed is worse than an error.
 */
export async function resolveWithin(
  where: WithinWhere
): Promise<{ value: ResolvedArea[] } | { error: string }> {
  const areas: ResolvedArea[] = [];

  if (where.boundingBox) {
    areas.push({ bbox: where.boundingBox as BBox, source: "boundingBox" });
  }

  for (const geometry of where.geometries ?? []) {
    areas.push({ polygon: geometry, source: "geometry" });
  }

  for (const query of where.queries ?? []) {
    const area = await resolveAreaQuery(query);
    if ("error" in area) return area;
    areas.push(area.value);
  }

  if (areas.length === 0) {
    return {
      error: '`where` with mode "within" needs at least one of: queries, boundingBox, geometries.',
    };
  }
  return { value: areas };
}

/**
 * Geocodes an area name to its boundary polygon, or its bbox as a fallback.
 *
 * The polygon is the whole point — see the module header. `limit: 5` then take
 * the first: the geocoder's own ranking decides, because with no viewport there
 * is nothing better to re-rank against (see the header's note on ambiguity).
 */
async function resolveAreaQuery(
  query: string
): Promise<{ value: ResolvedArea } | { error: string }> {
  try {
    const response = await geocodeAddress(query, { limit: 5 });
    const features = (response as { features?: unknown[] }).features ?? [];
    const top = features[0] as
      | {
          bbox?: unknown;
          geometry?: { type?: string; coordinates?: unknown };
          properties?: { address?: { freeformAddress?: string } };
        }
      | undefined;

    if (!top) {
      return {
        error:
          `Could not resolve "${query}" to an area. Give a more specific name (e.g. ` +
          '"De Jordaan, Amsterdam" rather than "Jordaan"), or supply a boundingBox.',
      };
    }

    const label = top.properties?.address?.freeformAddress ?? query;

    if (top.geometry?.type === "Polygon" || top.geometry?.type === "MultiPolygon") {
      return {
        value: {
          polygon: { type: top.geometry.type, coordinates: top.geometry.coordinates },
          label,
          source: "query",
          query,
        },
      };
    }

    const bbox = Array.isArray(top.bbox) && top.bbox.length === 4 ? (top.bbox as BBox) : undefined;
    if (!bbox) {
      return {
        error:
          `"${query}" resolved to a point rather than an area, so there is nothing to search ` +
          'within. Use mode "nearby" with this as the `query` if you meant "around here".',
      };
    }
    return { value: { bbox, label, source: "query", query } };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { error: `Failed to resolve area "${query}": ${message}` };
  }
}

/** Default radius for `nearby` when the caller does not say. */
export const DEFAULT_NEARBY_RADIUS_METERS = 1000;

/**
 * Resolves a `nearby` scope to a bias point.
 *
 * Unlike `within`, an unresolvable input here is NOT fatal — a missing bias means
 * a wider search, not a failed one, which matches how the toolkit treats it.
 */
export async function resolveNearby(where: NearbyWhere): Promise<ResolvedBias> {
  const radiusMeters = where.radiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS;

  if (where.position) {
    return { position: where.position as Position, radiusMeters };
  }

  if (where.query) {
    try {
      const response = await geocodeAddress(where.query, { limit: 1 });
      const feature = (response as { features?: unknown[] }).features?.[0];
      const coords = (feature as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
      if (Array.isArray(coords) && typeof coords[0] === "number") {
        return { position: coords as Position, radiusMeters, label: where.query };
      }
    } catch {
      // A failed bias is not a failed search; fall through to no bias.
    }
  }

  return { radiusMeters };
}

/** What was actually searched, for reporting alongside results. */
export const describeAreas = (areas: readonly ResolvedArea[]): string =>
  areas
    .map((area) => area.label ?? (area.polygon ? `${area.source} polygon` : area.source))
    .join(", ");
