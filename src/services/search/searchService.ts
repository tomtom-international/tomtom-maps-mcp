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

import {
  discoverPlaces,
  geocode,
  reverseGeocode as sdkReverseGeocode,
  getPOICategories,
  getPlacesWithEVAvailability,
  type DiscoverPlacesResponse,
  type FuzzySearchParams,
  type GeometrySearchParams,
  type GeocodingParams,
  type GeocodingResponse,
  type ReverseGeocodingParams,
  type ReverseGeocodingResponse,
  type POICategoriesParams,
  type POICategoriesResponse,
  type Circle,
  type PlaceFilters,
  type SearchFilters,
  type SearchGeometryInput,
} from "@tomtom-org/maps-sdk/services";
import { requireApiKey } from "../base/tomtomClient";
import { getRoute } from "../routing/routingService";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import buffer from "@turf/buffer";
import type { Polygon, Position } from "geojson";
import { polygonFromBBox, type Places, type Routes } from "@tomtom-org/maps-sdk/core";
import type * as SearchSchema from "../../schemas/search/searchSchema";
import {
  toBrands,
  toConnectorTypes,
  toFuelTypes,
  toGeoBias,
  toGeographyTypes,
  toGeocodingIndexTypes,
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
  | "chargingAvailability"
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
export type NearbySearchOptions = Pick<
  SearchSchema.NearbySearchParams,
  "radius" | "limit" | "countries" | PlacesFieldKey | SearchExtraFieldKey | PoiFilterKey
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

/** Optional result fields fuzzy, POI and nearby search can add (tool parameters of the same name). */
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

  const result = await discoverPlaces(params);
  return options.chargingAvailability ? withEVAvailability(result, apiKey) : result;
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
 * Searches for points of interest (POIs) near a location.
 * @param position [longitude, latitude] (GeoJSON convention)
 */
export async function searchNearby(
  position: Position,
  options: NearbySearchOptions = {}
): Promise<DiscoverPlacesResponse> {
  const apiKey = requireApiKey();
  const radiusMeters = options.radius ?? 1000;

  logger.debug(
    { lng: position[0], lat: position[1], radius: radiusMeters },
    "Nearby search via SDK"
  );

  const placeFilters = toPlaceFilters(options);
  if (!nonEmpty(placeFilters)) {
    throw new IncorrectError(
      "Nearby search needs poiCategories or a POI filter: without one the Search API returns no results",
      { filters: POI_FILTER_KEYS }
    );
  }

  return discoverPlaces({
    apiKey,
    query: "*",
    geoBias: { position, radiusMeters },
    limit: options.limit ?? 20,
    filters: withCountries(placeFilters, options.countries),
    ...buildPlacesFields(options),
    ...buildSearchExtraFields(options),
  });
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

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

export type AreaSearchOptions = Pick<
  SearchSchema.AreaSearchParams,
  "query" | "center" | "radius" | "polygon" | "boundingBox" | "limit" | "poiCategories" | "language"
>;

/** The area to search: a circle, or a polygon drawn from the polygon or bounding box inputs. */
export type SearchArea =
  | { kind: "circle"; circle: Circle }
  | { kind: "polygon" | "boundingBox"; polygon: Polygon };

/**
 * The search area from the tool inputs: center and radius, a polygon or a bounding
 * box. Throws when more than one is given. The handler draws the same area on the map.
 */
export function toSearchArea(
  params: Pick<AreaSearchOptions, "center" | "radius" | "polygon" | "boundingBox">
): SearchArea | undefined {
  if (Boolean(params.center) !== Boolean(params.radius)) {
    throw new IncorrectError("center and radius go together", {
      center: params.center,
      radius: params.radius,
    });
  }
  const given = (["center", "polygon", "boundingBox"] as const).filter((key) => params[key]);
  if (given.length > 1) {
    throw new IncorrectError("Give one search area: center with radius, polygon or boundingBox", {
      given,
    });
  }
  if (params.center && params.radius) {
    return {
      kind: "circle",
      circle: { type: "Circle", coordinates: params.center, radius: params.radius },
    };
  }
  if (params.polygon && params.polygon.length >= 3) {
    const ring = params.polygon.map((p) => [p[0], p[1]]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    return { kind: "polygon", polygon: { type: "Polygon", coordinates: [ring] } };
  }
  if (params.boundingBox) {
    // [[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]]
    const [[tlLon, tlLat], [brLon, brLat]] = params.boundingBox;
    return { kind: "boundingBox", polygon: polygonFromBBox([tlLon, brLat, brLon, tlLat]).geometry };
  }
  return undefined;
}

/**
 * Search for POIs within a geometric area: a circle (center + radius), a
 * polygon, or a bounding box. Uses SDK's discoverPlaces() with that geometry.
 */
export async function searchInArea(params: AreaSearchOptions): Promise<DiscoverPlacesResponse> {
  const apiKey = requireApiKey();

  const area = toSearchArea(params);
  if (!area) {
    throw new IncorrectError("Give a search area: center with radius, polygon or boundingBox", {});
  }
  const geometry: SearchGeometryInput = area.kind === "circle" ? area.circle : area.polygon;
  logger.debug({ geometryType: area.kind }, "Area search via SDK");

  const searchParams: GeometrySearchParams = {
    apiKey,
    query: params.query,
    geometries: [geometry],
    limit: params.limit ?? 10,
    filters: nonEmpty(toPlaceFilters(params)),
    ...buildLanguageField(params),
  };

  const result = await discoverPlaces(searchParams);

  logger.debug({ resultCount: result.features?.length }, "Area search completed");

  return result;
}

// ---------------------------------------------------------------------------
// EV Charging Station Search
// ---------------------------------------------------------------------------

export type EVSearchOptions = Pick<
  SearchSchema.EvSearchParams,
  | "query"
  | "position"
  | "radius"
  | "connectorTypes"
  | "minPowerKW"
  | "limit"
  | "includeAvailability"
  | "language"
  | "countries"
  | "cursor"
>;

/**
 * Search for EV charging stations using TomTom Maps SDK.
 *
 * Uses SDK's discoverPlaces() filtered to charging locations,
 * then enriches results with real-time availability via getPlacesWithEVAvailability().
 */
export async function searchEVStations(params: EVSearchOptions): Promise<Places> {
  const apiKey = requireApiKey();

  logger.debug(
    { lng: params.position[0], lat: params.position[1], radius: params.radius },
    "Searching EV charging stations via SDK"
  );

  const filters: SearchFilters = { poiCategories: ["CHARGING_LOCATION"] };
  if (params.connectorTypes?.length) filters.connectors = params.connectorTypes;
  if (params.minPowerKW !== undefined) filters.minPowerKW = params.minPowerKW;
  if (params.countries?.length) filters.countries = params.countries;

  const searchResult = await discoverPlaces({
    apiKey,
    query: params.query || "EV charging station",
    geoBias: toGeoBias(params),
    limit: params.limit ?? 10,
    filters,
    ...buildPlacesFields(params),
  });

  return params.includeAvailability === false
    ? searchResult
    : withEVAvailability(searchResult, apiKey);
}

/** Adds real-time availability to the EV charging stations among the places. */
async function withEVAvailability(places: Places, apiKey: string): Promise<Places> {
  if (!places.features?.length) return places;
  try {
    // Without the key the helper reads the SDK's global config, which the server never sets.
    const enriched = await getPlacesWithEVAvailability(places, { apiKey });
    logger.debug(
      { stationCount: enriched.features?.length },
      "EV availability enrichment successful"
    );
    return enriched;
  } catch (e: unknown) {
    logger.warn(
      { error: e instanceof Error ? e.message : String(e) },
      "EV availability enrichment failed, returning basic search results"
    );
    return places;
  }
}

// ---------------------------------------------------------------------------
// Search Along Route
// ---------------------------------------------------------------------------

export interface SearchAlongRouteResult {
  route: Routes;
  pois: DiscoverPlacesResponse;
  summary: {
    routeLengthMeters: number | undefined;
    routeTravelTimeSeconds: number | undefined;
    poiCount: number;
    corridorWidthMeters: number;
  };
}

export type SearchAlongRouteOptions = Pick<
  SearchSchema.SearchAlongRouteParams,
  | "origin"
  | "destination"
  | "query"
  | "corridorWidth"
  | "limit"
  | "poiCategories"
  | "language"
  | "routeType"
>;

/**
 * Search for POIs along a route corridor.
 *
 * Two-step process using SDK:
 * 1. calculateRoute() to get the route LineString geometry
 * 2. discoverPlaces() with the route geometry as a search corridor
 */
export async function searchAlongRoute(
  params: SearchAlongRouteOptions
): Promise<SearchAlongRouteResult> {
  const apiKey = requireApiKey();

  logger.debug(
    {
      origin: { lng: params.origin[0], lat: params.origin[1] },
      destination: { lng: params.destination[0], lat: params.destination[1] },
      query: params.query,
    },
    "Searching along route via SDK"
  );

  // Step 1: Calculate route to get geometry
  const routeResult = await getRoute([params.origin, params.destination], {
    routeType: params.routeType,
  });

  if (!routeResult.features?.length) {
    throw new Error("Could not calculate route between origin and destination");
  }

  // Extract route feature
  const routeFeature = routeResult.features[0];

  // Step 2: Buffer the route LineString into a Polygon corridor
  // SDK geometries only support Polygon/Circle, not LineString.
  // Use @turf/buffer to create a polygon corridor around the route.
  const corridorWidth = params.corridorWidth || 5000; // 5km default
  const corridorKm = corridorWidth / 1000;
  const buffered = buffer(routeFeature, corridorKm, { units: "kilometers" });
  if (!buffered) {
    throw new Error("Could not create search corridor from route geometry");
  }

  const searchParams: GeometrySearchParams = {
    apiKey,
    query: params.query,
    geometries: [buffered.geometry],
    limit: params.limit ?? 10,
    filters: nonEmpty(toPlaceFilters(params)),
    ...buildLanguageField(params),
  };

  const searchResult = await discoverPlaces(searchParams);

  logger.debug({ poiCount: searchResult.features?.length }, "Search along route completed");

  // Return combined result with route and POIs
  return {
    route: routeResult,
    pois: searchResult,
    summary: {
      routeLengthMeters: routeFeature.properties?.summary?.lengthInMeters,
      routeTravelTimeSeconds: routeFeature.properties?.summary?.travelTimeInSeconds,
      poiCount: searchResult.features?.length || 0,
      corridorWidthMeters: corridorWidth,
    },
  };
}
