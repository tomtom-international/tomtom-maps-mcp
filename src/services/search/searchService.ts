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
 * Search service: maps the search tool inputs to maps-sdk discoverPlaces(), geocode()
 * and reverseGeocode() parameters.
 */

import type {
  GeographyType,
  Place,
  Places,
  PolygonFeatures,
  Route,
} from "@tomtom-org/maps-sdk/core";
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
  type SearchFilters,
  reverseGeocode as sdkReverseGeocode,
} from "@tomtom-org/maps-sdk/services";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type * as SearchSchema from "../../schemas/search/searchSchema";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { requireApiKey } from "../api-key";
import {
  toBrands,
  toConnectorTypes,
  toFuelTypes,
  toGeoBias,
  toGeocodingIndexTypes,
  toGeographyTypes,
  toLanguage,
  toMapcodes,
  toOpeningHours,
  toPOICategories,
  toRelatedPois,
  toSearchIndexTypes,
  toTimeZone,
} from "../shared/sdkInputs";

// The tool inputs each search function maps to SDK parameters
export type FuzzySearchOptions = Pick<
  SearchSchema.FuzzySearchParams,
  | "limit"
  | "countries"
  | "position"
  | "radius"
  | "boundingBox"
  | "typeahead"
  | "minFuzzyLevel"
  | "maxFuzzyLevel"
  | "entityTypeSet"
  | "idxSet"
  | PlacesFieldKey
  | SearchExtraFieldKey
  | PoiFilterKey
>;
export type PoiSearchOptions = Pick<
  SearchSchema.PoiSearchParams,
  | "limit"
  | "countries"
  | "position"
  | "radius"
  | "boundingBox"
  | "typeahead"
  | PlacesFieldKey
  | SearchExtraFieldKey
  | PoiFilterKey
>;
export type GeocodeOptions = Pick<
  SearchSchema.GeocodeSearchParams,
  | "limit"
  | "countries"
  | "position"
  | "boundingBox"
  | "radius"
  | "mapcodes"
  | "extendedPostalCodesFor"
  | "entityTypeSet"
  | PlacesFieldKey
>;
export type ReverseGeocodeOptions = Pick<
  SearchSchema.ReverseGeocodeSearchParams,
  "language" | "view" | "radius" | "heading" | "entityType"
>;

function nonEmpty<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

/** The paged searches' fields: language, geopolitical view and the page to continue. */
type PlacesFieldKey = "language" | "view" | "cursor";
type PlacesFields = Pick<FuzzySearchParams, "language" | "geopoliticalView" | "cursor">;

function buildPlacesFields(
  options: Partial<Pick<SearchSchema.FuzzySearchParams, PlacesFieldKey>>
): PlacesFields {
  const fields: PlacesFields = {};
  const language = toLanguage(options.language);
  if (language) fields.language = language;
  if (options.view) fields.geopoliticalView = options.view;
  if (options.cursor) fields.cursor = options.cursor;
  return fields;
}

/** The geometry searches' language, the one places field their tools take. */
function buildLanguageField(options: { language?: string }): Pick<FuzzySearchParams, "language"> {
  const language = toLanguage(options.language);
  return language ? { language } : {};
}

/** Optional result fields fuzzy and POI search can add (tool parameters of the same name). */
type SearchExtraFieldKey =
  | "mapcodes"
  | "extendedPostalCodesFor"
  | "openingHours"
  | "timeZone"
  | "relatedPois";

function buildSearchExtraFields(
  options: Partial<Pick<SearchSchema.FuzzySearchParams, SearchExtraFieldKey>>
): Pick<FuzzySearchParams, SearchExtraFieldKey> {
  const fields: Pick<FuzzySearchParams, SearchExtraFieldKey> = {};
  const mapcodes = toMapcodes(options.mapcodes);
  if (mapcodes) fields.mapcodes = mapcodes;
  const extendedPostalCodesFor = toSearchIndexTypes(options.extendedPostalCodesFor);
  if (extendedPostalCodesFor) fields.extendedPostalCodesFor = extendedPostalCodesFor;
  const openingHours = toOpeningHours(options.openingHours);
  if (openingHours) fields.openingHours = openingHours;
  const timeZone = toTimeZone(options.timeZone);
  if (timeZone) fields.timeZone = timeZone;
  const relatedPois = toRelatedPois(options.relatedPois);
  if (relatedPois) fields.relatedPois = relatedPois;
  return fields;
}

/** POI filters every places search but geocoding takes; the API applies them to the whole result set. */
const POI_FILTER_KEYS = [
  "poiCategories",
  "brandSet",
  "connectorSet",
  "fuelSet",
  "minPowerKW",
  "maxPowerKW",
] as const;
type PoiFilterKey = (typeof POI_FILTER_KEYS)[number];

function toPlaceFilters(
  options: Partial<Pick<SearchSchema.FuzzySearchParams, PoiFilterKey>>
): PlaceFilters {
  const filters: PlaceFilters = {};
  const poiCategories = toPOICategories(options.poiCategories);
  if (poiCategories) filters.poiCategories = poiCategories;
  const brands = toBrands(options.brandSet);
  if (brands) filters.poiBrands = brands;
  const connectors = toConnectorTypes(options.connectorSet);
  if (connectors) filters.connectors = connectors;
  const fuelTypes = toFuelTypes(options.fuelSet);
  if (fuelTypes) filters.fuelTypes = fuelTypes;
  if (options.minPowerKW !== undefined) filters.minPowerKW = options.minPowerKW;
  if (options.maxPowerKW !== undefined) filters.maxPowerKW = options.maxPowerKW;
  return filters;
}

/** Place filters plus countries, which only the searches without a geometry take. */
function withCountries(filters: PlaceFilters, countries?: string[]): SearchFilters | undefined {
  return nonEmpty(countries?.length ? { ...filters, countries } : filters);
}

/**
 * Performs a fuzzy search for places, addresses, and POIs with advanced options
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
    ...buildPlacesFields(options),
    ...buildSearchExtraFields(options),
  };
  const filters: SearchFilters = toPlaceFilters(options);
  const geographyTypes = toGeographyTypes(options.entityTypeSet, "entityTypeSet");
  if (geographyTypes) filters.geographyTypes = geographyTypes;
  const indexes = toSearchIndexTypes(options.idxSet, "idxSet");
  if (indexes) filters.indexes = indexes;
  params.filters = withCountries(filters, options.countries);
  const geoBias = toGeoBias(options);
  if (geoBias) params.geoBias = geoBias;
  if (options.typeahead !== undefined) params.typeahead = options.typeahead;
  if (options.minFuzzyLevel !== undefined) params.minFuzzyLevel = options.minFuzzyLevel;
  if (options.maxFuzzyLevel !== undefined) params.maxFuzzyLevel = options.maxFuzzyLevel;

  return discoverPlaces(params);
}

/**
 * Search specifically for Points of Interest (POIs)
 */
export async function poiSearch(query: string, options: PoiSearchOptions = {}): Promise<Places> {
  const apiKey = requireApiKey();

  logger.debug({ query }, "POI searching via SDK");

  const params: FuzzySearchParams = {
    apiKey,
    query,
    limit: options.limit ?? 10,
    filters: withCountries({ ...toPlaceFilters(options), indexes: ["POI"] }, options.countries),
    ...buildPlacesFields(options),
    ...buildSearchExtraFields(options),
  };
  const geoBias = toGeoBias(options);
  if (geoBias) params.geoBias = geoBias;
  if (options.typeahead !== undefined) params.typeahead = options.typeahead;

  return discoverPlaces(params);
}

/**
 * Geocodes an address to coordinates
 */
export async function geocodeAddress(
  query: string,
  options: GeocodeOptions = {}
): Promise<GeocodingResponse> {
  const apiKey = requireApiKey();

  logger.debug({ query }, "Geocoding via SDK");

  const params: GeocodingParams = {
    apiKey,
    query,
    limit: options.limit ?? 10,
    ...buildPlacesFields(options),
  };
  const filters: NonNullable<GeocodingParams["filters"]> = {};
  if (options.countries?.length) filters.countries = options.countries;
  const geographyTypes = toGeographyTypes(options.entityTypeSet, "entityTypeSet");
  if (geographyTypes) filters.geographyTypes = geographyTypes;
  if (nonEmpty(filters)) params.filters = filters;
  const geoBias = toGeoBias(options);
  if (geoBias) params.geoBias = geoBias;
  // Geocoding has no openingHours, timeZone or POI index
  const mapcodes = toMapcodes(options.mapcodes);
  if (mapcodes) params.mapcodes = mapcodes;
  const extendedPostalCodesFor = toGeocodingIndexTypes(options.extendedPostalCodesFor);
  if (extendedPostalCodesFor) params.extendedPostalCodesFor = extendedPostalCodesFor;

  return geocode(params);
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
  options: Pick<SearchSchema.FuzzySearchParams, "language"> = {}
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
  options: Pick<GeocodeOptions, "limit" | "boundingBox" | "language"> = {}
): Promise<GeocodingResponse> {
  logger.debug({ query }, "Geocoding areas via SDK");
  const params: GeocodingParams = {
    apiKey: requireApiKey(),
    query,
    limit: options.limit ?? 5,
    filters: { geographyTypes: AREA_GEOGRAPHY_TYPES },
    ...buildLanguageField(options),
  };
  const geoBias = toGeoBias(options);
  if (geoBias) params.geoBias = geoBias;
  return geocode(params);
}

/** Whether the Geometry Data service holds a boundary for this place. */
export const hasBoundary = (place: Place): boolean =>
  Boolean(place.properties.dataSources?.geometry?.id);

/** The boundary polygons of places that have one (see {@link hasBoundary}), in their order. */
export async function fetchBoundaries(places: Place[]): Promise<PolygonFeatures> {
  logger.debug({ places: places.length }, "Fetching place boundaries via SDK");
  return geometryData({ apiKey: requireApiKey(), geometries: places });
}

/** The tool inputs every places search takes, whatever its scope. */
export type PlacesSearchOptions = Pick<
  SearchSchema.FuzzySearchParams,
  "limit" | "language" | "poiCategories"
>;

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
    ...buildLanguageField(options),
  };
  if (options.sortBy) params.sortBy = options.sortBy;
  return discoverPlaces(params);
}
