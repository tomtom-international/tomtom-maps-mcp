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

import type { GeographyType, Place, PolygonFeatures, Route } from "@tomtom-org/maps-sdk/core";
import {
  type AlongRouteSearchParams,
  type AlongRouteSortBy,
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
  reverseGeocode as sdkReverseGeocode,
} from "@tomtom-org/maps-sdk/services";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { DiscoverPlacesParams } from "../../schemas/search/discoverPlacesSchema";
import type { ReverseGeocodeSearchParams } from "../../schemas/search/searchSchema";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { requireApiKey } from "../api-key";
import { toGeoBias, toGeographyTypes, toLanguage, toPOICategories } from "../shared/sdkInputs";

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
  const language = toLanguage(options.language);
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
  const apiKey = requireApiKey();

  logger.debug({ query }, "Fuzzy searching via SDK");

  const params: FuzzySearchParams = {
    apiKey,
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
  const apiKey = requireApiKey();

  logger.debug({ lng: position[0], lat: position[1] }, "Reverse geocoding via SDK");

  if (options.entityType !== undefined && options.heading !== undefined) {
    throw new IncorrectError("entityType ignores heading: give one or the other", {
      entityType: options.entityType,
      heading: options.heading,
    });
  }

  const params: ReverseGeocodingParams = {
    apiKey,
    position,
  };

  const language = toLanguage(options.language);
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
  const apiKey = requireApiKey();

  logger.debug({ filters }, "Fetching POI categories via SDK");

  const params: POICategoriesParams = { apiKey };
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
    apiKey: requireApiKey(),
    filters: inputs,
    ...buildLanguageField(options),
  });
}

/**
 * Administrative areas, for resolving a name to the area it CONTAINS. Without this filter
 * "De Jordaan, Amsterdam" geocodes to a street in it. Countries are too coarse to search in,
 * and postcode areas match unrelated codes elsewhere.
 */
const AREA_GEOGRAPHY_TYPES: GeographyType[] = [
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
    apiKey: requireApiKey(),
    query,
    limit: options.limit ?? 5,
    filters: { geographyTypes: AREA_GEOGRAPHY_TYPES },
  };
  const geoBias = toGeoBias(options);
  if (geoBias) params.geoBias = geoBias;
  return geocode(params);
}

/** The id the Geometry Data service holds this place's boundary under, if it holds one. */
export const boundaryIdOf = (place: Place): string | undefined =>
  place.properties.dataSources?.geometry?.id;

/** Whether the Geometry Data service holds a boundary for this place. */
export const hasBoundary = (place: Place): boolean => Boolean(boundaryIdOf(place));

/** The boundary polygons held under these ids (see {@link boundaryIdOf}), each feature under its id. */
export async function fetchBoundaries(boundaryIds: string[]): Promise<PolygonFeatures> {
  logger.debug({ boundaries: boundaryIds.length }, "Fetching place boundaries via SDK");
  return geometryData({ apiKey: requireApiKey(), geometries: boundaryIds });
}

/** Searches inside polygons, all of them in one request. An empty `query` searches by category. */
export async function searchInAreas(
  query: string,
  areas: (Polygon | MultiPolygon)[],
  options: PlacesSearchOptions = {}
): Promise<DiscoverPlacesResponse> {
  logger.debug({ areas: areas.length }, "Area search via SDK");
  const params: GeometrySearchParams = {
    apiKey: requireApiKey(),
    query,
    geometries: areas,
    limit: options.limit ?? 10,
    filters: nonEmpty(toPlaceFilters(options)),
    ...OPENING_HOURS,
    ...buildLanguageField(options),
  };
  return discoverPlaces(params);
}

/** Searches along a route, ranked by the detour each place costs. The API returns at most 20. */
export async function searchAlongRoute(
  query: string,
  route: Route,
  options: PlacesSearchOptions & { maxDetourTimeSeconds: number; sortBy?: AlongRouteSortBy }
): Promise<DiscoverPlacesResponse> {
  logger.debug(
    { maxDetourTimeSeconds: options.maxDetourTimeSeconds },
    "Along-route search via SDK"
  );
  const params: AlongRouteSearchParams = {
    apiKey: requireApiKey(),
    query,
    route,
    maxDetourTimeSeconds: options.maxDetourTimeSeconds,
    limit: options.limit ?? 10,
    filters: nonEmpty(toPlaceFilters(options)),
    ...OPENING_HOURS,
    ...buildLanguageField(options),
  };
  if (options.sortBy) params.sortBy = options.sortBy;
  return discoverPlaces(params);
}
