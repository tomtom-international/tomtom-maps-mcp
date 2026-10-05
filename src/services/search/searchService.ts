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
 * Search SDK Service
 * Uses TomTom Maps SDK search(), geocode(), and reverseGeocode() directly
 * instead of raw REST API calls.
 */

import {
  search,
  geocode,
  reverseGeocode as sdkReverseGeocode,
  getPOICategories,
  getPlacesWithEVAvailability,
  type SearchResponse,
  type FuzzySearchParams,
  type GeometrySearchParams,
  type GeocodingParams,
  type GeocodingResponse,
  type ReverseGeocodingParams,
  type ReverseGeocodingResponse,
  type POICategoriesParams,
  type POICategoriesResponse,
  type Circle,
  type SearchGeometryInput,
} from "@tomtom-org/maps-sdk/services";
import { requireApiKey } from "../base/tomtomClient";
import { getRoute } from "../routing/routingService";
import { logger } from "../../utils/logger";
import buffer from "@turf/buffer";
import type { Polygon, Position } from "geojson";
import { polygonFromBBox, type Places, type Routes } from "@tomtom-org/maps-sdk/core";
import type * as SearchSchema from "../../schemas/search/searchSchema";
import {
  toBBox,
  toBrands,
  toConnectorTypes,
  toFuelTypes,
  toGeographyTypes,
  toGeocodingIndexTypes,
  toLanguage,
  toMapcodes,
  toOpeningHours,
  toPOICategories,
  toRelatedPois,
  toSearchIndexTypes,
  toTimeZone,
  toView,
} from "../shared/sdkInputs";

// The tool inputs each search function maps to SDK parameters
export type FuzzySearchOptions = Pick<
  SearchSchema.FuzzySearchParams,
  | "limit"
  | "language"
  | "countries"
  | "position"
  | "radius"
  | "boundingBox"
  | "typeahead"
  | "minFuzzyLevel"
  | "maxFuzzyLevel"
  | "poiCategories"
  | "view"
  | "ofs"
  | "entityTypeSet"
  | "idxSet"
  | SearchExtraFieldKey
  | PoiFilterKey
>;
export type PoiSearchOptions = Pick<
  SearchSchema.PoiSearchParams,
  | "limit"
  | "language"
  | "countries"
  | "position"
  | "radius"
  | "boundingBox"
  | "typeahead"
  | "poiCategories"
  | "view"
  | "ofs"
  | "chargingAvailability"
  | SearchExtraFieldKey
  | PoiFilterKey
>;
export type GeocodeOptions = Pick<
  SearchSchema.GeocodeSearchParams,
  | "limit"
  | "language"
  | "countries"
  | "position"
  | "boundingBox"
  | "radius"
  | "mapcodes"
  | "extendedPostalCodesFor"
  | "view"
  | "ofs"
  | "entityTypeSet"
>;
export type ReverseGeocodeOptions = Pick<
  SearchSchema.ReverseGeocodeSearchParams,
  | "language"
  | "radius"
  | "mapcodes"
  | "returnSpeedLimit"
  | "allowFreeformNewLine"
  | "heading"
  | "entityType"
>;
export type NearbySearchOptions = Pick<
  SearchSchema.NearbySearchParams,
  | "radius"
  | "limit"
  | "language"
  | "countries"
  | "poiCategories"
  | "view"
  | "ofs"
  | SearchExtraFieldKey
  | PoiFilterKey
>;

/** Optional result fields fuzzy, POI and nearby search can add (tool parameters of the same name). */
type SearchExtraFieldKey =
  | "mapcodes"
  | "extendedPostalCodesFor"
  | "openingHours"
  | "timeZone"
  | "relatedPois";

function buildSearchExtraFields(
  options: Partial<Pick<SearchSchema.FuzzySearchParams, SearchExtraFieldKey>> | undefined
): Pick<FuzzySearchParams, SearchExtraFieldKey> {
  const fields: Pick<FuzzySearchParams, SearchExtraFieldKey> = {};
  const mapcodes = toMapcodes(options?.mapcodes);
  if (mapcodes) fields.mapcodes = mapcodes;
  const extendedPostalCodesFor = toSearchIndexTypes(options?.extendedPostalCodesFor);
  if (extendedPostalCodesFor) fields.extendedPostalCodesFor = extendedPostalCodesFor;
  const openingHours = toOpeningHours(options?.openingHours);
  if (openingHours) fields.openingHours = openingHours;
  const timeZone = toTimeZone(options?.timeZone);
  if (timeZone) fields.timeZone = timeZone;
  const relatedPois = toRelatedPois(options?.relatedPois);
  if (relatedPois) fields.relatedPois = relatedPois;
  return fields;
}

/** POI filters fuzzy, POI and nearby search share; the API applies them to the whole result set. */
type PoiFilterKey = "brandSet" | "connectorSet" | "fuelSet" | "minPowerKW" | "maxPowerKW";
type PoiFilterParams = Pick<
  FuzzySearchParams,
  "poiBrands" | "connectors" | "fuelTypes" | "minPowerKW" | "maxPowerKW"
>;

function buildPoiFilters(
  options: Partial<Pick<SearchSchema.FuzzySearchParams, PoiFilterKey>> | undefined
): PoiFilterParams {
  const filters: PoiFilterParams = {};
  const brands = toBrands(options?.brandSet);
  if (brands) filters.poiBrands = brands;
  const connectors = toConnectorTypes(options?.connectorSet);
  if (connectors) filters.connectors = connectors;
  const fuelTypes = toFuelTypes(options?.fuelSet);
  if (fuelTypes) filters.fuelTypes = fuelTypes;
  if (options?.minPowerKW !== undefined) filters.minPowerKW = options.minPowerKW;
  if (options?.maxPowerKW !== undefined) filters.maxPowerKW = options.maxPowerKW;
  return filters;
}

/** Fields every places search takes: the geopolitical view and the result offset. */
function buildPlacesFields(
  options: { view?: string; ofs?: number } | undefined
): Pick<FuzzySearchParams, "view" | "offset"> {
  const fields: Pick<FuzzySearchParams, "view" | "offset"> = {};
  const view = toView(options?.view);
  if (view) fields.view = view;
  if (options?.ofs !== undefined) fields.offset = options.ofs;
  return fields;
}

/**
 * Searches for places based on a free-text query
 */
export async function searchPlaces(query: string): Promise<SearchResponse> {
  const apiKey = requireApiKey();

  logger.debug({ query }, "Searching for places via SDK");
  return search({ apiKey, query, limit: 10 });
}

/**
 * Performs a fuzzy search for places, addresses, and POIs with advanced options
 */
export async function fuzzySearch(
  query: string,
  options?: FuzzySearchOptions
): Promise<SearchResponse> {
  const apiKey = requireApiKey();

  logger.debug({ query }, "Fuzzy searching via SDK");

  const params: FuzzySearchParams = {
    apiKey,
    query,
    limit: options?.limit ?? 10,
  };

  if (options?.position) params.position = options.position;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.typeahead !== undefined) params.typeahead = options.typeahead;
  if (options?.minFuzzyLevel !== undefined) params.minFuzzyLevel = options.minFuzzyLevel;
  if (options?.maxFuzzyLevel !== undefined) params.maxFuzzyLevel = options.maxFuzzyLevel;
  if (options?.countries?.length) params.countries = options.countries;
  const poiCategories = toPOICategories(options?.poiCategories);
  if (poiCategories) params.poiCategories = poiCategories;
  const boundingBox = toBBox(options?.boundingBox);
  if (boundingBox) params.boundingBox = boundingBox;
  const geographyTypes = toGeographyTypes(options?.entityTypeSet, "entityTypeSet");
  if (geographyTypes) params.geographyTypes = geographyTypes;
  const indexes = toSearchIndexTypes(options?.idxSet, "idxSet");
  if (indexes) params.indexes = indexes;
  Object.assign(
    params,
    buildSearchExtraFields(options),
    buildPoiFilters(options),
    buildPlacesFields(options)
  );

  return search(params);
}

/**
 * Search specifically for Points of Interest (POIs)
 */
export async function poiSearch(query: string, options?: PoiSearchOptions): Promise<Places> {
  const apiKey = requireApiKey();

  logger.debug({ query }, "POI searching via SDK");

  const params: FuzzySearchParams = {
    apiKey,
    query,
    indexes: ["POI"],
    limit: options?.limit ?? 10,
  };

  if (options?.position) params.position = options.position;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  const boundingBox = toBBox(options?.boundingBox);
  if (boundingBox) params.boundingBox = boundingBox;
  if (options?.typeahead !== undefined) params.typeahead = options.typeahead;
  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.countries?.length) params.countries = options.countries;
  const poiCategories = toPOICategories(options?.poiCategories);
  if (poiCategories) params.poiCategories = poiCategories;
  Object.assign(
    params,
    buildSearchExtraFields(options),
    buildPoiFilters(options),
    buildPlacesFields(options)
  );

  const result = await search(params);
  return options?.chargingAvailability ? withEVAvailability(result, apiKey) : result;
}

/**
 * Geocodes an address to coordinates
 */
export async function geocodeAddress(
  query: string,
  options?: GeocodeOptions
): Promise<GeocodingResponse> {
  const apiKey = requireApiKey();

  logger.debug({ query }, "Geocoding via SDK");

  const params: GeocodingParams = {
    apiKey,
    query,
    limit: options?.limit ?? 10,
  };

  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.countries?.length) params.countries = options.countries;
  if (options?.position) params.position = options.position;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  const boundingBox = toBBox(options?.boundingBox);
  if (boundingBox) params.boundingBox = boundingBox;
  const geographyTypes = toGeographyTypes(options?.entityTypeSet, "entityTypeSet");
  if (geographyTypes) params.geographyTypes = geographyTypes;
  Object.assign(params, buildPlacesFields(options));
  // Geocoding has no openingHours, timeZone or POI index
  const mapcodes = toMapcodes(options?.mapcodes);
  if (mapcodes) params.mapcodes = mapcodes;
  const extendedPostalCodesFor = toGeocodingIndexTypes(options?.extendedPostalCodesFor);
  if (extendedPostalCodesFor) params.extendedPostalCodesFor = extendedPostalCodesFor;

  return geocode(params);
}

/**
 * Reverse geocodes coordinates to an address.
 * @param position [longitude, latitude] (GeoJSON convention)
 */
export async function reverseGeocode(
  position: Position,
  options?: ReverseGeocodeOptions
): Promise<ReverseGeocodingResponse> {
  const apiKey = requireApiKey();

  logger.debug({ lng: position[0], lat: position[1] }, "Reverse geocoding via SDK");

  const params: ReverseGeocodingParams = {
    apiKey,
    position,
  };

  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  // Reverse geocoding takes mapcodes only
  const mapcodes = toMapcodes(options?.mapcodes);
  if (mapcodes) params.mapcodes = mapcodes;
  if (options?.returnSpeedLimit !== undefined) params.returnSpeedLimit = options.returnSpeedLimit;
  if (options?.allowFreeformNewLine !== undefined) {
    params.allowFreeformNewline = options.allowFreeformNewLine;
  }
  if (options?.heading !== undefined) params.heading = options.heading;
  const geographyType = toGeographyTypes(options?.entityType, "entityType");
  if (geographyType) params.geographyType = geographyType;

  return sdkReverseGeocode(params);
}

/**
 * Searches for points of interest (POIs) near a location.
 * @param position [longitude, latitude] (GeoJSON convention)
 */
export async function searchNearby(
  position: Position,
  options?: NearbySearchOptions
): Promise<SearchResponse> {
  const apiKey = requireApiKey();

  logger.debug(
    { lng: position[0], lat: position[1], radius: options?.radius ?? 1000 },
    "Nearby search via SDK"
  );

  const params: FuzzySearchParams = {
    apiKey,
    query: "*",
    position,
    radiusMeters: options?.radius ?? 1000,
    limit: options?.limit ?? 20,
  };

  const language = toLanguage(options?.language);
  if (language) params.language = language;
  if (options?.countries?.length) params.countries = options.countries;
  const poiCategories = toPOICategories(options?.poiCategories);
  if (poiCategories) params.poiCategories = poiCategories;
  Object.assign(
    params,
    buildSearchExtraFields(options),
    buildPoiFilters(options),
    buildPlacesFields(options)
  );

  return search(params);
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
 * Picks the search area from the tool inputs, in this order: center and radius,
 * polygon, bounding box. The handler draws the same area on the map.
 */
export function toSearchArea(
  params: Pick<AreaSearchOptions, "center" | "radius" | "polygon" | "boundingBox">
): SearchArea | undefined {
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
 * polygon, or a bounding box. Uses SDK's search() with that geometry.
 */
export async function searchInArea(params: AreaSearchOptions): Promise<SearchResponse> {
  const apiKey = requireApiKey();

  const area = toSearchArea(params);
  if (!area) {
    throw new Error(
      "At least one geometry must be provided: center+radius (circle), polygon, or boundingBox"
    );
  }
  const geometry: SearchGeometryInput = area.kind === "circle" ? area.circle : area.polygon;
  logger.debug({ geometryType: area.kind }, "Area search via SDK");

  const searchParams: GeometrySearchParams = {
    apiKey,
    query: params.query,
    geometries: [geometry],
    limit: params.limit || 10,
  };

  const language = toLanguage(params.language);
  if (language) searchParams.language = language;
  const poiCategories = toPOICategories(params.poiCategories);
  if (poiCategories) searchParams.poiCategories = poiCategories;

  const result = await search(searchParams);

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
>;

/**
 * Search for EV charging stations using TomTom Maps SDK.
 *
 * Uses SDK's search() with poiCategories filter for EV stations,
 * then enriches results with real-time availability via getPlacesWithEVAvailability().
 */
export async function searchEVStations(params: EVSearchOptions): Promise<Places> {
  const apiKey = requireApiKey();

  logger.debug(
    { lng: params.position[0], lat: params.position[1], radius: params.radius },
    "Searching EV charging stations via SDK"
  );

  const searchParams: FuzzySearchParams = {
    apiKey,
    query: params.query || "EV charging station",
    poiCategories: ["ELECTRIC_VEHICLE_STATION"],
    position: params.position,
    limit: params.limit || 10,
  };

  if (params.radius !== undefined) searchParams.radiusMeters = params.radius;
  if (params.minPowerKW !== undefined) searchParams.minPowerKW = params.minPowerKW;
  const connectors = toConnectorTypes(params.connectorTypes);
  if (connectors) searchParams.connectors = connectors;
  const language = toLanguage(params.language);
  if (language) searchParams.language = language;
  if (params.countries && params.countries.length > 0) {
    searchParams.countries = params.countries;
  }

  const searchResult = await search(searchParams);

  return params.includeAvailability === false
    ? searchResult
    : withEVAvailability(searchResult, apiKey);
}

/** Adds real-time availability to the EV charging stations among the places. */
async function withEVAvailability(places: Places, apiKey: string): Promise<Places> {
  if (!places.features?.length) return places;
  try {
    // Forward the API key to the per-station availability requests. Since SDK
    // 0.49.0 (maps-sdk-js#1888) this helper accepts common service params;
    // otherwise it reads the key from global config, which we never set.
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
  pois: SearchResponse;
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
 * 2. search() with the route geometry as a search corridor
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
    limit: params.limit || 10,
  };

  const language = toLanguage(params.language);
  if (language) searchParams.language = language;
  const poiCategories = toPOICategories(params.poiCategories);
  if (poiCategories) searchParams.poiCategories = poiCategories;

  const searchResult = await search(searchParams);

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
