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

import type { BBox, Place, Places } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Geometry, MultiPolygon, Polygon, Position } from "geojson";
import { z } from "zod";
import { coordinateSchema } from "../../../schemas/routing/common";
import { geocodeAddress, poiSearch } from "../../../services/search/searchService";
import { toBBox } from "../../../services/shared/sdkInputs";
import { IncorrectError } from "../../../types/types";
import { fulfilledValues } from "../in-batches";

/** Where a resolved area came from, for reporting back what was actually searched. */
export type AreaSource = "boundingBox" | "query" | "geometry";

export interface ResolvedArea {
  bbox?: BBox;
  polygon?: Polygon | MultiPolygon;
  /** The GROUNDED match — what the data was loaded for, not the query echo. */
  label?: string;
  source: AreaSource;
  /** The input text for a `query` area, so "asked" can be paired with "matched". */
  query?: string;
}

/** A point bias for `nearby`, with the radius the caller asked for. */
export interface ResolvedBias {
  position?: Position;
  radiusMeters: number;
  label?: string;
}

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
  position: coordinateSchema.optional().describe("The point to search around."),
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
 *
 * @throws IncorrectError when a field is missing or a query does not name an area.
 */
export async function resolveWithin(where: WithinWhere): Promise<ResolvedArea[]> {
  const areas: ResolvedArea[] = [];

  if (where.boundingBox) {
    areas.push({ bbox: toBBox(where.boundingBox), source: "boundingBox" });
  }

  for (const geometry of where.geometries ?? []) {
    // The schema checks the type, not the ring structure.
    areas.push({ polygon: geometry as Polygon | MultiPolygon, source: "geometry" });
  }

  for (const query of where.queries ?? []) {
    areas.push(await resolveAreaQuery(query));
  }

  if (areas.length === 0) {
    throw new IncorrectError(
      '`where` with mode "within" needs at least one of: queries, boundingBox, geometries.'
    );
  }
  return areas;
}

/**
 * Geocodes an area name to its boundary polygon, or its bbox as a fallback.
 *
 * The polygon is the whole point — see the module header. `limit: 5` then take
 * the first: the geocoder's own ranking decides, because with no viewport there
 * is nothing better to re-rank against (see the header's note on ambiguity).
 */
async function resolveAreaQuery(query: string): Promise<ResolvedArea> {
  const response = await geocodeAddress(query, { limit: 5 });
  const top = response.features[0];

  if (!top) {
    throw new IncorrectError(
      'Could not resolve the query to an area. Give a more specific name (e.g. "De Jordaan, ' +
        'Amsterdam" rather than "Jordaan"), or supply a boundingBox.',
      { query }
    );
  }

  const label = top.properties.address?.freeformAddress ?? query;
  // The SDK types a geocode result as a point; area matches carry their boundary.
  const geometry = top.geometry as Geometry;

  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    return { polygon: geometry, label, source: "query", query };
  }

  if (top.bbox?.length !== 4) {
    throw new IncorrectError(
      "The query resolved to a point rather than an area, so there is nothing to search " +
        'within. Use mode "nearby" with it as the `query` if you meant "around here".',
      { query }
    );
  }
  return { bbox: top.bbox as BBox, label, source: "query", query };
}

/** Default radius for `nearby` when the caller does not say. */
export const DEFAULT_NEARBY_RADIUS_METERS = 1000;

/**
 * Case-, accent- and punctuation-insensitive form, for comparing place names.
 *
 * Shared with `discover-places`, which needs the same comparison when it ranks
 * candidates for `locate-place`.
 */
export const normaliseName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Splits "Dam Square, Amsterdam" into the thing being looked for and the place
 * that qualifies it. The tail is what stops a global index answering in the
 * wrong country.
 */
export const splitNamedQuery = (query: string): { subject: string; area?: string } => {
  const parts = query
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { subject: query.trim() };
  return { subject: parts[0], area: parts.slice(1).join(", ") };
};

/** A place's own name: the venue's for a POI, the address for anything else. */
export const placeName = (place: Place): string | undefined =>
  place.properties.poi?.name ?? place.properties.address?.freeformAddress;

/** Whether a candidate sits in the area the query named, read off its address text. */
export const inNamedArea = (place: Place, area: string | undefined): boolean => {
  if (!area) return true;
  const address = place.properties.address;
  const haystack = normaliseName(
    [address?.freeformAddress, address?.municipality, address?.country].filter(Boolean).join(" ")
  );
  return haystack.length === 0 || haystack.includes(normaliseName(area));
};

/**
 * Resolves a place NAME to a point, consulting both indexes.
 *
 * The address geocoder alone is not enough and the failure is not subtle: asked
 * for "Dam Square, Amsterdam" it returns Mill Dam Place in Leesburg, Virginia —
 * measured, and the reason this function exists. A named square, station or
 * landmark lives in the POI index; a street or a city lives in the geocoder; a
 * `where.nearby.query` can be either and does not say which.
 *
 * So both are asked, and any candidate that contradicts the area the query
 * named ("…, Amsterdam") is discarded rather than ranked. `locate-place` does a
 * richer version of this for its own answer; this is the part a bias needs.
 */
const resolveNamedPoint = async (
  query: string
): Promise<{ position: Position; label: string } | undefined> => {
  const { subject, area } = splitNamedQuery(query);
  const settled = await Promise.allSettled([
    poiSearch(subject, { limit: 5 }),
    geocodeAddress(query, { limit: 5 }),
  ]);
  const match = fulfilledValues<Places>(settled)
    .flatMap((response) => response.features)
    .find((candidate) => inNamedArea(candidate, area));
  return match && { position: match.geometry.coordinates, label: placeName(match) ?? query };
};

/**
 * Resolves a `nearby` scope to a bias point.
 *
 * An unresolvable bias is a HARD failure, which reverses this function's
 * original behaviour. It used to fall through to an unbiased search on the
 * reasoning that a missing bias means a wider search rather than a failed one.
 * Measured, that reasoning produced restaurants in Leesburg, Virginia for
 * "within 800m of Dam Square, Amsterdam" — and the response still reported the
 * scope it had been ASKED for, so nothing downstream could tell. A wider search
 * is a defensible fallback; a search on the wrong continent, described as one on
 * the right one, is not.
 */
export async function resolveNearby(where: NearbyWhere): Promise<ResolvedBias> {
  const radiusMeters = where.radiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS;

  if (where.position) {
    return { position: where.position as Position, radiusMeters };
  }

  if (where.query) {
    const resolved = await resolveNamedPoint(where.query);
    if (!resolved) {
      throw new IncorrectError(
        "Could not resolve the query to a point to search around. Give `where.position` as " +
          '[longitude, latitude], or name the area with `where: { mode: "within", queries: [...] }` instead.',
        { query: where.query }
      );
    }
    return { position: resolved.position, radiusMeters, label: resolved.label };
  }

  return { radiusMeters };
}

/** What a `nearby` search was centred on, for reporting alongside results. */
export const describeBias = ({ position, radiusMeters, label }: ResolvedBias): string =>
  position ? `within ${radiusMeters}m of ${label ?? position.join(", ")}` : "no bias";

/** What was actually searched, for reporting alongside results. */
export const describeAreas = (areas: readonly ResolvedArea[]): string =>
  areas
    .map((area) => area.label ?? (area.polygon ? `${area.source} polygon` : area.source))
    .join(", ");

/** A resolved area's bounds, derived from its polygon when it has no bbox of its own. */
export const areaBBox = (area: ResolvedArea): BBox | undefined =>
  area.bbox ?? (area.polygon && (turf.bbox(area.polygon) as BBox));
