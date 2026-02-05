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
 */

/**
 * Type definitions for TomTom Search API
 */

/**
 * Location search result interface
 */
export interface SearchResult {
  summary?: {
    query: string;
    queryType: string;
    queryTime: number;
    numResults: number;
    offset: number;
    totalResults: number;
    fuzzyLevel: number;
    geoBias?: {
      lat?: number;
      lon?: number;
    };
  };
  results?: Array<POIResult>;
}

/**
 * Individual POI result interface
 */
export interface POIResult {
  type: string;
  id: string;
  score: number;
  dist?: number;
  info?: string;
  entityType?: string;
  matchConfidence?: {
    score: number;
  };
  address: {
    freeformAddress?: string;
    streetNumber?: string;
    streetName?: string;
    municipalitySubdivision?: string;
    municipality?: string;
    countrySecondarySubdivision?: string;
    countrySubdivision?: string;
    postalCode?: string;
    countryCode?: string;
    country?: string;
    countryTertiarySubdivision?: string;
    localName?: string;
    extendedPostalCode?: string;
    countryCodeISO3?: string;
    countrySubdivisionName?: string;
  };
  position: {
    lat: number;
    lon: number;
  };
  poi?: {
    name: string;
    phone?: string;
    url?: string;
    categorySet: Array<{
      id: number;
    }>;
    categories?: string[];
    classifications?: Array<{
      code: string;
      names: Array<{
        nameLocale: string;
        name: string;
      }>;
    }>;
    openingHours?: {
      mode: string;
      timeRanges: Array<{
        startTime: {
          date: string;
          hour: number;
          minute: number;
        };
        endTime: {
          date: string;
          hour: number;
          minute: number;
        };
      }>;
    };
    brands?: Array<{
      name: string;
    }>;
    timeZone?: {
      ianaId: string;
    };
  };
  dataSources?: {
    geometry?: {
      id: string;
    };
    chargingAvailability?: {
      id: string;
    };
  };
}

/**
 * Reverse Geocoding response interface
 */
export interface ReverseGeocodingResult {
  summary: {
    queryTime: number;
    numResults: number;
  };
  addresses: Array<{
    address: {
      buildingNumber?: string;
      streetNumber?: string;
      routeNumbers?: string[];
      street?: string;
      streetName?: string;
      streetNameAndNumber?: string;
      countryCode: string;
      countrySubdivision: string;
      countrySecondarySubdivision?: string;
      countryTertiarySubdivision?: string;
      municipality: string;
      postalCode: string;
      municipalitySubdivision?: string;
      neighbourhood?: string;
      country: string;
      countryCodeISO3: string;
      freeformAddress: string;
      boundingBox?: {
        northEast: string;
        southWest: string;
        entity: string;
      };
      extendedPostalCode?: string;
      countrySubdivisionName?: string;
      countrySubdivisionCode?: string;
      localName?: string;
    };
    position: string;
    matchType?: string;
    mapcodes?: Array<{
      type: string;
      fullMapcode: string;
      territory?: string;
      code?: string;
    }>;
    id?: string;
  }>;
}

/**
 * Base interface for common search options
 */
export interface BaseSearchOptions {
  limit?: number;
  typeahead?: boolean;
  lat?: number;
  lon?: number;
  radius?: number;
  countrySet?: string;
  topLeft?: string;
  btmRight?: string;
  language?: string;
  categorySet?: string;
  brandSet?: string;
  ofs?: number;
  mapcodes?: Array<string>; // Array of mapcode types
  timeZone?: string;
  view?: string;
  relatedPois?: string;
  geometries?: boolean;
  sort?: string;
  extendedPostalCodesFor?: string;
  entityTypeSet?: string;
  addressRanges?: boolean;
  minFuzzyLevel?: number;
  maxFuzzyLevel?: number;
  ext?: string;
}

/**
 * Handler parameter types for search operations
 */
export interface GeocodeParams extends Partial<BaseSearchOptions> {
  query: string;
}

export interface ReverseGeocodeParams extends Partial<ReverseGeocodeOptions> {
  lat: number;
  lon: number;
}

export interface FuzzySearchParams extends Partial<ExtendedSearchOptions> {
  query: string;
}

export interface PoiSearchParams extends Partial<ExtendedSearchOptions> {
  query: string;
}

export interface NearbySearchParams extends Partial<ExtendedSearchOptions> {
  lat: number;
  lon: number;
}

/**
 * EV and fuel specific options
 */
export interface EVFuelOptions {
  connectorSet?: string;
  fuelSet?: string;
  minPowerKW?: number;
  maxPowerKW?: number;
  openingHours?: string;
  chargingAvailability?: boolean;
  parkingAvailability?: boolean;
  fuelAvailability?: boolean;
}

/**
 * Extended search options combining base and specialized options
 */
export interface ExtendedSearchOptions extends BaseSearchOptions, EVFuelOptions {
  roadUse?: boolean;
}

/**
 * Reverse geocoding specific options
 */
export interface ReverseGeocodeOptions extends Omit<BaseSearchOptions, "roadUse">, EVFuelOptions {
  returnSpeedLimit?: boolean;
  returnRoadUse?: boolean;
  roadUse?: string[];
  allowFreeformNewLine?: boolean;
  returnMatchType?: boolean;
  heading?: number;
  maxResults?: number;
  returnRoadAccessibility?: boolean;
  returnCommune?: boolean;
  returnAddressNames?: boolean;
  addressRanges?: boolean;
}
