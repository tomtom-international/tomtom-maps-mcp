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
 * `within` is an area (names, bounds or polygons), `nearby` a point plus radius,
 * `global` no constraint (*Scope* in CONTEXT.md); `tomtom-discover-places` adds a
 * route mode of its own. A name in `queries` resolves to the AREA it names — a
 * city, district or neighbourhood — and to its boundary polygon where the
 * Geometry Data service has one, so a neighbourhood search stays inside it. The
 * geocoder's own ranking decides, and the response names where each query resolved.
 */

import type { BBox, Place, Places } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { z } from "zod";
import { coordinateSchema } from "../../../schemas/routing/common";
import {
  boundaryIdOf,
  fetchBoundaries,
  fuzzySearch,
  geocodeAreas,
  hasBoundary,
  type LookupOptions,
} from "../../../services/search/searchService";
import { toBBox } from "../../../services/shared/sdkInputs";
import { IncorrectError } from "../../../types/types";
import { logger } from "../../../utils/logger";
import { isPath } from "../geometry-response";
import { inNamedArea, placeName, rankPlaceCandidates } from "./place-names";

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
    | { source: "query"; query: string; label: string; boundaryId?: string }
    | { source: "area"; label: string }
  );

/**
 * A named area as a result reports it and `within.areas` takes it back: what a
 * later call needs to search the same area without geocoding its name again.
 */
export interface KnownArea {
  name: string;
  boundingBox: BBox;
  boundaryId?: string;
}

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

const knownAreaSchema = z.object({
  name: z.string().describe("The area's name, as the earlier result gave it."),
  boundingBox: z.array(z.number()).length(4).describe("[west, south, east, north] in degrees."),
  boundaryId: z
    .string()
    .regex(/^[\w-]{1,64}$/, 'A boundaryId is the id an earlier result gave, e.g. "10794339".')
    .optional()
    .describe("The id its boundary polygon is held under, when it has one."),
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
        "Each name resolves to that area's boundary polygon. Qualify a name that several places " +
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
        "it in `queries`. It resolves to the same boundary without geocoding the name again."
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
  "boundary polygons), `areas` (an earlier result's `resolvedAreas[].area`), `boundingBox` or " +
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

  const [named, known] = await Promise.all([
    resolveAreaQueries(where.queries ?? [], options.boundsOnly),
    resolveKnownAreas(where.areas ?? [], options.boundsOnly),
  ]);
  areas.push(...named, ...known);

  if (areas.length === 0) {
    throw new IncorrectError(
      '`where` with mode "within" needs at least one of: queries, areas, boundingBox, geometries.'
    );
  }
  return areas;
}

/**
 * Geocodes area names to their bounds and, where the Geometry Data service has
 * them, their boundaries, all in one request. The first match wins: with no map
 * there is nothing to re-rank by.
 */
async function resolveAreaQueries(
  queries: readonly string[],
  boundsOnly = false
): Promise<ResolvedArea[]> {
  const matches = await Promise.all(
    queries.map(async (query) => {
      const [top] = (await geocodeAreas(query, { limit: 1 })).features;
      if (!top?.bbox) {
        throw new IncorrectError(
          "Could not resolve the query to a city, district or neighbourhood. Qualify the name " +
            '("De Jordaan, Amsterdam"), use mode "nearby" for a landmark or venue, or give a ' +
            "boundingBox.",
          { query }
        );
      }
      return { query, top, bbox: top.bbox };
    })
  );
  const polygons = boundsOnly ? undefined : await boundariesOf(matches.map(({ top }) => top));
  return matches.map(
    ({ query, top, bbox }, index): ResolvedArea => ({
      bbox,
      ...(polygons && { polygon: polygons[index] }),
      label: placeName(top) ?? query,
      source: "query",
      query,
      ...(hasBoundary(top) && { boundaryId: boundaryIdOf(top) }),
    })
  );
}

/** Areas an earlier result resolved, from their bounds and boundary ids: no geocode. */
async function resolveKnownAreas(
  known: readonly z.infer<typeof knownAreaSchema>[],
  boundsOnly = false
): Promise<ResolvedArea[]> {
  const boundaryIds = boundsOnly
    ? []
    : known.flatMap(({ boundaryId }) => (boundaryId ? [boundaryId] : []));
  const polygons = await boundariesById(boundaryIds);
  return known.map(({ name, boundingBox: [west, south, east, north], boundaryId }) => {
    const polygon = boundaryId === undefined ? undefined : polygons.get(boundaryId);
    return {
      bbox: [west, south, east, north],
      ...(polygon && { polygon }),
      label: name,
      source: "area",
    };
  });
}

/**
 * Each place's boundary polygon, in their order, from one request: undefined for a
 * place without one. A failed fetch falls back to the bounds, which `describeAreas`
 * reports, rather than failing the search.
 */
export async function boundariesOf(
  places: readonly Place[]
): Promise<(Polygon | MultiPolygon | undefined)[]> {
  const byId = await boundariesById(places.flatMap((place) => boundaryIdOf(place) ?? []));
  return places.map((place) => {
    const id = boundaryIdOf(place);
    return id === undefined ? undefined : byId.get(id);
  });
}

/** The known area `within.areas` takes for a city, district or neighbourhood a lookup returned. */
export const knownAreaOf = (place: Place): KnownArea | undefined => {
  const name = placeName(place);
  if (place.properties.type !== "Geography" || !place.bbox || !name) return undefined;
  const [west, south, east, north] = place.bbox;
  const boundaryId = boundaryIdOf(place);
  return { name, boundingBox: [west, south, east, north], ...(boundaryId && { boundaryId }) };
};

/** The polygons held under these boundary ids, from one request; empty when the fetch fails. */
async function boundariesById(boundaryIds: string[]): Promise<Map<string, Polygon | MultiPolygon>> {
  if (boundaryIds.length === 0) return new Map();
  try {
    const { features } = await fetchBoundaries([...new Set(boundaryIds)]);
    return new Map(features.map((feature) => [String(feature.id), feature.geometry]));
  } catch (caught) {
    logger.warn({ error: String(caught) }, "Boundary fetch failed; searching the bounding box");
    return new Map();
  }
}

/** Default radius for `nearby` when the caller does not say. */
const DEFAULT_NEARBY_RADIUS_METERS = 1000;

/**
 * Splits "Dam Square, Amsterdam" into the thing being looked for and the place
 * that qualifies it. The tail is what puts the candidates in that place first,
 * so a global index does not answer in the wrong country.
 */
export const splitNamedQuery = (query: string): { subject: string; area?: string } => {
  const parts = query
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { subject: query.trim() };
  return { subject: parts[0], area: parts.slice(1).join(", ") };
};

/** How many candidates a name search weighs: enough to report the alternatives too. */
export const NAME_CANDIDATES = 10;

/**
 * Searches for a place NAME: one fuzzy search, which asks the POI index and the
 * geocoder together, ranked by `rankPlaceCandidates`. The whole query goes in,
 * tail and all: the POI index asked for "Sagrada Família" alone answers with
 * churches of that name in Galați and A Coruña.
 */
export async function searchPlaceName(
  query: string,
  scope: Omit<LookupOptions, "limit"> = {},
  { boundaryWanted = false }: { boundaryWanted?: boolean } = {}
): Promise<{ response: Places } & ReturnType<typeof rankPlaceCandidates<Place>>> {
  const { subject, area } = splitNamedQuery(query);
  const response = await fuzzySearch(query, { limit: NAME_CANDIDATES, ...scope });
  return { response, ...rankPlaceCandidates(response.features, subject, { area, boundaryWanted }) };
}

/**
 * Resolves a place NAME to a point, as tomtom-locate-place resolves it. The best
 * candidate is refused when it lies outside the area the query names ("…,
 * Amsterdam") and is not named exactly what was asked for either.
 */
export async function resolvePlaceName(
  query: string
): Promise<{ position: Position; label: string } | undefined> {
  const { area } = splitNamedQuery(query);
  const {
    ranked: [match],
    matchedByName,
  } = await searchPlaceName(query);
  if (!match || (!matchedByName && !inNamedArea(match, area))) return undefined;
  return { position: match.geometry.coordinates, label: placeName(match) ?? query };
}

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
    const resolved = await resolvePlaceName(where.query);
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
      if (!("label" in area)) return area.polygon ? "geometry polygon" : "boundingBox";
      return area.polygon ? area.label : `${area.label} (bounding box)`;
    })
    .join("; ");

/**
 * Where each named area resolved. A name several places share resolves to one of
 * them ("Westminster" to Westminster, CO), and this is how the model can tell.
 * `area` is what a later call passes in `within.areas` to skip the geocode.
 */
export const resolvedAreasOf = (
  areas: readonly ResolvedArea[]
): { query: string; matched: string; area: KnownArea }[] =>
  areas.flatMap((area) =>
    area.source === "query"
      ? [
          {
            query: area.query,
            matched: area.label,
            area: {
              name: area.label,
              boundingBox: area.bbox,
              ...(area.boundaryId && { boundaryId: area.boundaryId }),
            },
          },
        ]
      : []
  );
