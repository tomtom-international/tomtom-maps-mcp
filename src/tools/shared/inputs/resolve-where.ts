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
 * `where` — one geographic-scope field with several modes, and the resolver behind it.
 *
 * Ported from the agent toolkit's `tools/shared/resolve-where.ts`. `within` is an
 * area (names, bounds or polygons), `nearby` a point plus radius, `global` no
 * constraint; `tomtom-discover-places` adds a route mode of its own. A name in
 * `queries` resolves to the AREA it names — a city, district or neighbourhood —
 * and to its boundary polygon where the Geometry Data service has one, so a
 * neighbourhood search stays inside the neighbourhood.
 *
 * Unlike the toolkit there is no `viewport`: a stateless server has no map to
 * read bounds from or to re-rank same-named areas against, so the geocoder's own
 * ranking decides and the response names where each query resolved.
 */

import type { BBox, Place, Places } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { z } from "zod";
import { coordinateSchema } from "../../../schemas/routing/common";
import {
  fetchBoundaries,
  geocodeAddress,
  geocodeAreas,
  hasBoundary,
  poiSearch,
} from "../../../services/search/searchService";
import { toBBox } from "../../../services/shared/sdkInputs";
import { IncorrectError } from "../../../types/types";
import { logger } from "../../../utils/logger";
import { isPath } from "../geometry-response";
import { fulfilledValues } from "../in-batches";
import { inNamedArea, placeName, rankLocateCandidates } from "./place-names";

/**
 * Most names, and most polygons, one `within` takes. Each name costs a geocode
 * and a boundary fetch, and each area a traffic request.
 */
const MAX_WITHIN_AREAS = 10;

/** An area to search: always its bounds, and its boundary where one is known. */
interface AreaBounds {
  bbox: BBox;
  polygon?: Polygon | MultiPolygon;
}

/** A resolved area, and where it came from, for reporting back what was searched. */
export type ResolvedArea = AreaBounds &
  (
    | { source: "boundingBox" | "geometry" }
    /** `label` is the GROUNDED match, `query` what was asked for. */
    | { source: "query"; query: string; label: string }
  );

/** A point bias for `nearby`, with the radius the caller asked for. */
export interface ResolvedBias {
  position: Position;
  radiusMeters: number;
  label?: string;
}

const geometrySchema = z
  .object({
    type: z.enum(["Polygon", "MultiPolygon"]),
    coordinates: z.array(z.unknown()),
  })
  .describe("A GeoJSON Polygon or MultiPolygon, [longitude, latitude] positions.");

/** `within` — an AREA. Every supplied field resolves and the results are unioned. */
export const withinWhereSchema = z.object({
  mode: z.literal("within"),
  queries: z
    .array(z.string())
    .min(1)
    .max(MAX_WITHIN_AREAS)
    .optional()
    .describe(
      'Names of the CITIES, DISTRICTS OR NEIGHBOURHOODS to search inside, e.g. ["Amsterdam"], ' +
        '["De Jordaan, Amsterdam"]. Answers "search WHERE", never "search for WHAT": for ' +
        '"restaurants in Paris" the subject goes in `poiCategories`/`query` and "Paris" goes here. ' +
        "Each name resolves to that area's boundary polygon. Qualify a name that several places " +
        'share ("Westminster, London"). A landmark or venue is not an area: use mode "nearby".'
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
export const nearbyWhereSchema = z.object({
  mode: z.literal("nearby"),
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
export const globalWhereSchema = z.object({
  mode: z.literal("global"),
});

const WITHIN_DOC =
  "`within` — an AREA: any combination of `queries` (city, district or neighbourhood names → " +
  "boundary polygons), `boundingBox` or `geometries`; all supplied fields are unioned. ";
const NEARBY_DOC = "`nearby` — a POINT bias with `radiusMeters`, given as `position` or `query`. ";

/** A place's scope: an area, a point bias, or nowhere in particular. */
export const whereSchema = z
  .union([withinWhereSchema, nearbyWhereSchema, globalWhereSchema])
  .describe(
    `Geographic scope, selected by \`mode\`. ${WITHIN_DOC}${NEARBY_DOC}` +
      "`global` — no constraint, for a uniquely-named target."
  );

/** A scope that is always somewhere: an area or a radius around a point. */
export const areaWhereSchema = z
  .union([withinWhereSchema, nearbyWhereSchema])
  .describe(`Geographic scope, selected by \`mode\`. ${WITHIN_DOC}${NEARBY_DOC}`);

export type Where = z.infer<typeof whereSchema>;
export type WithinWhere = z.infer<typeof withinWhereSchema>;
export type NearbyWhere = z.infer<typeof nearbyWhereSchema>;

/** Whether a `geometries` entry nests its rings as its type requires; the schema checks only the type. */
const isPolygonal = (geometry: {
  type: Polygon["type"] | MultiPolygon["type"];
  coordinates: unknown[];
}): geometry is Polygon | MultiPolygon => {
  const isRings = (rings: unknown): boolean =>
    Array.isArray(rings) && rings.length > 0 && rings.every(isPath);
  return geometry.type === "Polygon"
    ? isRings(geometry.coordinates)
    : geometry.coordinates.length > 0 && geometry.coordinates.every(isRings);
};

/**
 * Resolves a `within` scope to one or more areas.
 *
 * Explicit fields are unioned. A `queries` entry that resolves to nothing is a
 * hard failure rather than a silent widening: "restaurants in Atlantis" returning
 * results from wherever the geocoder guessed is worse than an error.
 *
 * @param options.boundsOnly Skips the boundary fetch, for a caller that reads only `bbox`.
 * @throws IncorrectError when no field is given, a geometry is malformed or a query names no area.
 */
export async function resolveWithin(
  where: WithinWhere,
  options: { boundsOnly?: boolean } = {}
): Promise<ResolvedArea[]> {
  const areas: ResolvedArea[] = [];

  const boundingBox = toBBox(where.boundingBox);
  if (boundingBox) areas.push({ bbox: boundingBox, source: "boundingBox" });

  for (const [index, geometry] of (where.geometries ?? []).entries()) {
    if (!isPolygonal(geometry)) {
      throw new IncorrectError(
        "A `where.geometries` entry is not a valid GeoJSON geometry. A Polygon's `coordinates` " +
          "is an array of rings, each an array of [longitude, latitude] positions; a " +
          "MultiPolygon's is an array of those.",
        { index, type: geometry.type }
      );
    }
    areas.push({ bbox: turf.bbox(geometry) as BBox, polygon: geometry, source: "geometry" });
  }

  areas.push(
    ...(await Promise.all(
      (where.queries ?? []).map((query) => resolveAreaQuery(query, options.boundsOnly))
    ))
  );

  if (areas.length === 0) {
    throw new IncorrectError(
      '`where` with mode "within" needs at least one of: queries, boundingBox, geometries.'
    );
  }
  return areas;
}

/**
 * Geocodes an area name to its bounds and, where the Geometry Data service has it,
 * its boundary. The first match wins: with no map there is nothing to re-rank by.
 */
async function resolveAreaQuery(query: string, boundsOnly = false): Promise<ResolvedArea> {
  const [top] = (await geocodeAreas(query, { limit: 1 })).features;
  const bbox = top?.bbox;
  if (!bbox) {
    throw new IncorrectError(
      "Could not resolve the query to a city, district or neighbourhood. Qualify the name " +
        '("De Jordaan, Amsterdam"), use mode "nearby" for a landmark or venue, or give a ' +
        "boundingBox.",
      { query }
    );
  }
  return {
    bbox,
    ...(!boundsOnly && { polygon: await boundaryOf(top) }),
    label: placeName(top) ?? query,
    source: "query",
    query,
  };
}

/**
 * A place's boundary polygon, or undefined when it has none. A failed fetch falls
 * back to the bounds, which `describeAreas` reports, rather than failing the search.
 */
export async function boundaryOf(place: Place): Promise<Polygon | MultiPolygon | undefined> {
  if (!hasBoundary(place)) return undefined;
  try {
    return (await fetchBoundaries([place])).features[0]?.geometry;
  } catch (caught) {
    logger.warn({ error: String(caught) }, "Boundary fetch failed; searching the bounding box");
    return undefined;
  }
}

/** Default radius for `nearby` when the caller does not say. */
const DEFAULT_NEARBY_RADIUS_METERS = 1000;

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

/**
 * Resolves a place NAME to a point, consulting both indexes.
 *
 * The address geocoder alone is not enough and the failure is not subtle: asked
 * for "Dam Square, Amsterdam" it returns Mill Dam Place in Leesburg, Virginia.
 * A named square, station or landmark lives in the POI index; a street or a city
 * lives in the geocoder; a `where.nearby.query` can be either and does not say which.
 *
 * So both are asked and ranked as `locate-place` ranks them. The best candidate is
 * refused when it lies outside the area the query named ("…, Amsterdam") and is
 * not named exactly what was asked for either.
 */
const resolveNamedPoint = async (
  query: string
): Promise<{ position: Position; label: string } | undefined> => {
  const { subject, area } = splitNamedQuery(query);
  // The whole query to both: the POI index asked for "Sagrada Família" alone
  // answers with churches of that name in Galați and A Coruña.
  const settled = await Promise.allSettled([
    poiSearch(query, { limit: 5 }),
    geocodeAddress(query, { limit: 5 }),
  ]);
  const candidates = fulfilledValues<Places>(settled).flatMap((response) => response.features);
  const {
    ranked: [match],
    matchedByName,
  } = rankLocateCandidates(candidates, subject, { area });
  if (!match || (!matchedByName && !inNamedArea(match, area))) return undefined;
  return { position: match.geometry.coordinates, label: placeName(match) ?? query };
};

/**
 * Resolves a `nearby` scope to a bias point.
 *
 * An unresolvable or missing bias is a HARD failure, not an unbiased search: that
 * search answers "within 800m of Dam Square, Amsterdam" with restaurants in
 * Leesburg, Virginia, under the scope that was asked for.
 *
 * @throws IncorrectError when neither `position` nor `query` is given, or the query does not resolve.
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

  throw new IncorrectError(
    '`where` with mode "nearby" needs `position` ([longitude, latitude]) or `query` (a place ' +
      'name). For no geographic constraint, use mode "global".'
  );
}

/** What a `nearby` search was centred on, for reporting alongside results. */
export const describeBias = ({ position, radiusMeters, label }: ResolvedBias): string =>
  `within ${radiusMeters}m of ${label ?? position.join(", ")}`;

/** What was actually searched, for reporting alongside results. */
export const describeAreas = (areas: readonly ResolvedArea[]): string =>
  areas
    .map((area) => {
      if (area.source !== "query") return area.polygon ? "geometry polygon" : "boundingBox";
      return area.polygon ? area.label : `${area.label} (bounding box)`;
    })
    .join("; ");

/**
 * Where each named area resolved. A name several places share resolves to one of
 * them ("Westminster" to Westminster, CO), and this is how the model can tell.
 */
export const resolvedAreasOf = (
  areas: readonly ResolvedArea[]
): { query: string; matched: string }[] =>
  areas.flatMap((area) =>
    area.source === "query" ? [{ query: area.query, matched: area.label }] : []
  );
