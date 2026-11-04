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
 * Search service: maps the place tools' inputs to the maps-sdk's place searches,
 * geocoding, reverse geocoding, geometry data and POI category lookups.
 */

import type {
  GeographyType,
  Place,
  Places,
  PolygonFeatures,
  Route,
} from "@tomtom-org/maps-sdk/core";
import {
  type AlongRoutePlaceProps,
  type AlongRouteSearchParams,
  type DiscoverPlacesResponse,
  discoverPlaces,
  type FuzzySearchParams,
  type GeocodingParams,
  type GeocodingResponse,
  type GeometrySearchParams,
  geocode,
  geometryData,
  getPOICategories,
  type PlaceFilters,
  type POICategoriesParams,
  type POICategoriesResponse,
  type ResolvedPOICategories,
  type ReverseGeocodingParams,
  type ReverseGeocodingResponse,
  resolvePOICategories,
  type SearchSummary,
  reverseGeocode as sdkReverseGeocode,
} from "@tomtom-org/maps-sdk/services";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type {
  DiscoverPlacesParams,
  MaxDetourWhere,
} from "../../schemas/search/discoverPlacesSchema";
import type { ReverseGeocodeSearchParams } from "../../schemas/search/searchSchema";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { tomtomCallParams } from "../base/tomtomClient";
import {
  toGeoBias,
  toGeographyTypes,
  toPOICategories,
  toSupportedLanguage,
} from "../shared/sdkInputs";

/** The tool inputs every places search takes, whatever its scope. */
export type PlacesSearchOptions = Pick<
  DiscoverPlacesParams,
  "limit" | "language" | "poiCategories" | "minPowerKW" | "maxPowerKW" | "connectors"
>;
/** Around a position, within a radius, or inside a bounding box: see {@link toGeoBias}. */
type GeoBiasOptions = Parameters<typeof toGeoBias>[0];
/** A name lookup's candidates and where to look for them. */
export type LookupOptions = { limit?: number } & GeoBiasOptions;
export type FuzzySearchOptions = PlacesSearchOptions &
  Pick<DiscoverPlacesParams, "countries"> &
  GeoBiasOptions;
export type ReverseGeocodeOptions = Pick<
  ReverseGeocodeSearchParams,
  "language" | "view" | "radius" | "heading" | "entityType"
>;

function nonEmpty<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

/** The `language` input as the SDK takes it, for the searches and the category lookup. */
function buildLanguageField(options: { language?: string }): Pick<FuzzySearchParams, "language"> {
  const language = toSupportedLanguage(options.language);
  return language ? { language } : {};
}

/** Asked of every places search: the API adds them to each POI that has them, in the same request. */
const OPENING_HOURS = { openingHours: "nextSevenDays", timeZone: "iana" } as const;

/** The filters every places search but geocoding takes; the API applies them to the whole result set. */
function toPlaceFilters(
  options: Pick<PlacesSearchOptions, "poiCategories" | "minPowerKW" | "maxPowerKW" | "connectors">
): PlaceFilters {
  const { minPowerKW, maxPowerKW, connectors } = options;
  if (minPowerKW !== undefined && maxPowerKW !== undefined && minPowerKW > maxPowerKW) {
    throw new IncorrectError("minPowerKW is above maxPowerKW: no charger can meet both.", {
      minPowerKW,
      maxPowerKW,
    });
  }
  const poiCategories = toPOICategories(options.poiCategories);
  return {
    ...(poiCategories && { poiCategories }),
    ...(minPowerKW !== undefined && { minPowerKW }),
    ...(maxPowerKW !== undefined && { maxPowerKW }),
    ...(connectors?.length && { connectors }),
  };
}

/**
 * Performs a fuzzy search for places, addresses, and POIs
 */
export async function fuzzySearch(
  query: string,
  options: FuzzySearchOptions = {}
): Promise<DiscoverPlacesResponse> {
  const callParams = tomtomCallParams();

  logger.debug({ query }, "Fuzzy searching via SDK");

  const params: FuzzySearchParams = {
    ...callParams,
    query,
    limit: options.limit ?? 10,
    ...OPENING_HOURS,
    ...buildLanguageField(options),
  };
  const filters = toPlaceFilters(options);
  params.filters = nonEmpty(
    options.countries?.length ? { ...filters, countries: options.countries } : filters
  );
  const geoBias = toGeoBias(options);
  if (geoBias) params.geoBias = geoBias;

  return discoverPlaces(params);
}

/**
 * Reverse geocodes coordinates to an address.
 * @param position [longitude, latitude] (GeoJSON convention)
 */
export async function reverseGeocode(
  position: Position,
  options: ReverseGeocodeOptions = {}
): Promise<ReverseGeocodingResponse> {
  const callParams = tomtomCallParams();

  logger.debug({ lng: position[0], lat: position[1] }, "Reverse geocoding via SDK");

  if (options.entityType !== undefined && options.heading !== undefined) {
    throw new IncorrectError("entityType ignores heading: give one or the other", {
      entityType: options.entityType,
      heading: options.heading,
    });
  }

  const params: ReverseGeocodingParams = {
    ...callParams,
    position,
  };

  const language = toSupportedLanguage(options.language);
  if (language) params.language = language;
  if (options.view) params.geopoliticalView = options.view;
  if (options.radius !== undefined) params.radiusMeters = options.radius;
  if (options.heading !== undefined) params.heading = options.heading;
  const geographyTypes = toGeographyTypes(options.entityType, "entityType");
  if (geographyTypes) params.geographyTypes = geographyTypes;

  return sdkReverseGeocode(params);
}

/**
 * Retrieves POI categories, optionally filtered by keywords
 */
export async function fetchPOICategories(filters?: string[]): Promise<POICategoriesResponse> {
  const callParams = tomtomCallParams();

  logger.debug({ filters }, "Fetching POI categories via SDK");

  const params: POICategoriesParams = { ...callParams };
  if (filters?.length) params.filters = filters;

  return getPOICategories(params);
}

/**
 * Resolves category codes and plain words ("italian food", "gym") to the codes a search takes.
 * Codes stay as they are; `unmatched` holds the words no category matched.
 */
export async function resolveCategories(
  inputs: string[],
  options: Pick<PlacesSearchOptions, "language"> = {}
): Promise<ResolvedPOICategories> {
  logger.debug({ inputs }, "Resolving POI categories via SDK");
  return resolvePOICategories({
    ...tomtomCallParams(),
    filters: inputs,
    ...buildLanguageField(options),
  });
}

/**
 * Administrative areas, for resolving a name to the area it CONTAINS. Without this filter
 * "De Jordaan, Amsterdam" geocodes to a street in it. Countries are included so a name
 * that IS a country ("Greece") is not taken for a town of that name (Greece, NY); postcode
 * areas match unrelated codes elsewhere.
 */
const AREA_GEOGRAPHY_TYPES: GeographyType[] = [
  "Country",
  "CountrySubdivision",
  "CountrySecondarySubdivision",
  "Municipality",
  "MunicipalitySubdivision",
  "Neighbourhood",
];

/** Geocodes a name to administrative areas only, each with its bounding box. */
export async function geocodeAreas(
  query: string,
  options: LookupOptions = {}
): Promise<GeocodingResponse> {
  logger.debug({ query }, "Geocoding areas via SDK");
  const params: GeocodingParams = {
    ...tomtomCallParams(),
    query,
    limit: options.limit ?? 5,
    filters: { geographyTypes: AREA_GEOGRAPHY_TYPES },
  };
  const geoBias = toGeoBias(options);
  if (geoBias) params.geoBias = geoBias;
  return geocode(params);
}

/** Whether a place is a whole country. */
export const isCountry = (place: Place): boolean =>
  place.properties.geographyType?.includes("Country") ?? false;

/** The id the Geometry Data service holds this place's boundary under, if it holds one. */
export const boundaryIdOf = (place: Place): string | undefined =>
  place.properties.dataSources?.geometry?.id;

/** The boundary polygons held under these ids (see {@link boundaryIdOf}), each feature under its id. */
export async function fetchBoundaries(boundaryIds: string[]): Promise<PolygonFeatures> {
  logger.debug({ boundaries: boundaryIds.length }, "Fetching place boundaries via SDK");
  return geometryData({ ...tomtomCallParams(), geometries: boundaryIds });
}

/** The most geometries the Search API takes in one request. */
export const MAX_GEOMETRIES_PER_REQUEST = 50;

/**
 * Searches inside polygons, up to {@link MAX_GEOMETRIES_PER_REQUEST} per request,
 * so a derived dataset's hundred buffers search like one area. A place two
 * requests both find is kept once. An empty `query` searches by category.
 */
export async function searchInAreas(
  query: string,
  areas: (Polygon | MultiPolygon)[],
  options: PlacesSearchOptions = {}
): Promise<DiscoverPlacesResponse> {
  logger.debug({ areas: areas.length }, "Area search via SDK");
  const batches: (Polygon | MultiPolygon)[][] = [];
  for (let start = 0; start < areas.length; start += MAX_GEOMETRIES_PER_REQUEST) {
    batches.push(areas.slice(start, start + MAX_GEOMETRIES_PER_REQUEST));
  }
  const [first, ...rest] = await Promise.all(
    batches.map((geometries) =>
      discoverPlaces({
        ...tomtomCallParams(),
        query,
        geometries,
        limit: options.limit ?? 10,
        filters: nonEmpty(toPlaceFilters(options)),
        ...OPENING_HOURS,
        ...buildLanguageField(options),
      } satisfies GeometrySearchParams)
    )
  );
  if (!rest.length) return first;
  const features = new Map(
    [first, ...rest].flatMap(({ features }) => features).map((place) => [place.id, place])
  );
  return { ...first, features: [...features.values()] };
}

/** Searches along a route, or a line cut from one, in the order `sortBy` names. The API returns at most 20. */
export async function searchAlongRoute(
  query: string,
  route: Route | Position[],
  options: PlacesSearchOptions & Pick<MaxDetourWhere, "maxDetourTimeSeconds" | "sortBy">
): Promise<Places<AlongRoutePlaceProps, SearchSummary>> {
  logger.debug(
    { maxDetourTimeSeconds: options.maxDetourTimeSeconds },
    "Along-route search via SDK"
  );
  const params: AlongRouteSearchParams = {
    ...tomtomCallParams(),
    query,
    route,
    maxDetourTimeSeconds: options.maxDetourTimeSeconds,
    limit: options.limit ?? 10,
    filters: nonEmpty(toPlaceFilters(options)),
    ...OPENING_HOURS,
    ...buildLanguageField(options),
    sortBy: options.sortBy,
  };
  return discoverPlaces(params);
}
