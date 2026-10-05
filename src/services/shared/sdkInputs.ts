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
 * Narrow tool inputs to the maps-sdk parameter types.
 *
 * Tool schemas accept plain strings and numbers so they stay small in
 * tools/list; the SDK types are unions of literals. These helpers check values
 * against the SDK's own runtime lists, so a bad value fails with a clear
 * message here instead of being cast through.
 */

import {
  connectorTypes,
  geographyTypes,
  poiCategoriesToIDs,
  type BBox,
  type ConnectorType,
  type Fuel,
  type GeographyType,
  type Language,
  type MapcodeType,
  type OpeningHoursMode,
  type POICategory,
} from "@tomtom-org/maps-sdk/core";
import type {
  DepartArriveParams,
  GeocodingParams,
  MaxNumberOfAlternatives,
  RelatedPoisRequest,
  SearchIndexType,
  TimeZoneRequest,
} from "@tomtom-org/maps-sdk/services";
import { FUEL_TYPES } from "../../schemas/search/common";
import { IncorrectError } from "../../types/types";

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

function isPOICategory(value: string): value is POICategory {
  return Object.hasOwn(poiCategoriesToIDs, value);
}

function isConnectorType(value: string): value is ConnectorType {
  return isOneOf(connectorTypes, value);
}

/** Returns the values when the guard accepts them all; otherwise throws the error built from the rest. */
function narrowAll<T extends string>(
  values: string[],
  guard: (value: string) => value is T,
  toError: (unknown: string[]) => IncorrectError
): T[] {
  const unknown = values.filter((value) => !guard(value));
  if (unknown.length > 0) throw toError(unknown);
  return values.filter(guard);
}

export function toPOICategories(values: string[] | undefined): POICategory[] | undefined {
  if (!values?.length) return undefined;
  return narrowAll(
    values,
    isPOICategory,
    (unknown) =>
      new IncorrectError(
        "Unknown POI categories. Use tomtom-poi-categories to find valid category codes.",
        { unknown_categories: unknown }
      )
  );
}

// The SDK exports these value types but no runtime lists. Keyed records, so a
// value the SDK adds or drops fails to compile here.
const MAPCODE_TYPES: Record<MapcodeType, true> = {
  Local: true,
  International: true,
  Alternative: true,
};
const SEARCH_INDEX_TYPES: Record<SearchIndexType, true> = {
  Geo: true,
  PAD: true,
  Addr: true,
  Str: true,
  XStr: true,
  POI: true,
};
type GeocodingIndexType = NonNullable<GeocodingParams["extendedPostalCodesFor"]>[number];
const GEOCODING_INDEX_TYPES: Record<GeocodingIndexType, true> = {
  Geo: true,
  PAD: true,
  Addr: true,
  Str: true,
  XStr: true,
};
const OPENING_HOURS_MODES: Record<OpeningHoursMode, true> = { nextSevenDays: true };
const TIME_ZONE_MODES: Record<TimeZoneRequest, true> = { iana: true };
const RELATED_POIS_MODES: Record<RelatedPoisRequest, true> = {
  off: true,
  child: true,
  parent: true,
  all: true,
};

function toValues<T extends string>(
  allowed: Record<T, true>,
  values: string[] | undefined,
  field: string
): T[] | undefined {
  if (!values?.length) return undefined;
  const isAllowed = (value: string): value is T => Object.hasOwn(allowed, value);
  return narrowAll(
    values,
    isAllowed,
    (unknown) =>
      new IncorrectError("Unknown option values", {
        field,
        unknown_values: unknown,
        valid_values: Object.keys(allowed),
      })
  );
}

function toValue<T extends string>(
  allowed: Record<T, true>,
  value: string | undefined,
  field: string
): T | undefined {
  return toValues(allowed, value === undefined ? undefined : [value], field)?.[0];
}

/** The SDK's runtime list as a keyed record, for toValues. */
function keyed<T extends string>(values: readonly T[]): Record<T, true> {
  return Object.fromEntries(values.map((value) => [value, true])) as Record<T, true>;
}

/** Several tools take lists as a comma-separated string, e.g. extendedPostalCodesFor "PAD,Addr". */
function splitList(value: string | undefined): string[] | undefined {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toMapcodes(values: string[] | undefined): MapcodeType[] | undefined {
  return toValues(MAPCODE_TYPES, values, "mapcodes");
}

export function toSearchIndexTypes(
  value: string | undefined,
  field = "extendedPostalCodesFor"
): SearchIndexType[] | undefined {
  return toValues(SEARCH_INDEX_TYPES, splitList(value), field);
}

/** Geocoding has no POI index. */
export function toGeocodingIndexTypes(value: string | undefined): GeocodingIndexType[] | undefined {
  return toValues(GEOCODING_INDEX_TYPES, splitList(value), "extendedPostalCodesFor");
}

export function toGeographyTypes(
  value: string | undefined,
  field: string
): GeographyType[] | undefined {
  return toValues(keyed(geographyTypes), splitList(value), field);
}

export function toFuelTypes(value: string | undefined): Fuel[] | undefined {
  return toValues(FUEL_TYPES, splitList(value), "fuelSet");
}

/** Brand names are free text: split the comma-separated list, check nothing. */
export function toBrands(value: string | undefined): string[] | undefined {
  const brands = splitList(value);
  return brands?.length ? brands : undefined;
}

export function toOpeningHours(value: string | undefined): OpeningHoursMode | undefined {
  return toValue(OPENING_HOURS_MODES, value, "openingHours");
}

export function toTimeZone(value: string | undefined): TimeZoneRequest | undefined {
  return toValue(TIME_ZONE_MODES, value, "timeZone");
}

export function toRelatedPois(value: string | undefined): RelatedPoisRequest | undefined {
  return toValue(RELATED_POIS_MODES, value, "relatedPois");
}

/** The search tools' comma-separated connectorSet. */
export function toConnectorTypes(value: string | undefined): ConnectorType[] | undefined {
  const list = splitList(value);
  if (!list?.length) return undefined;
  return narrowAll(
    list,
    isConnectorType,
    (unknown) =>
      new IncorrectError("Unknown connector types", {
        unknown_connectors: unknown,
        valid_values: connectorTypes,
      })
  );
}

/**
 * The SDK sends the language tag as given and does not check it; its Language
 * type lists only the tags it documents. Pass the caller's tag through rather
 * than reject tags such as "en" that the type does not list.
 */
export function toLanguage(value: string | undefined): Language | undefined {
  return value as Language | undefined;
}

export function toMaxAlternatives(value: number | undefined): MaxNumberOfAlternatives | undefined {
  if (value === undefined) return undefined;
  switch (value) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return value;
    default:
      throw new IncorrectError("maxAlternatives must be a whole number from 0 to 5", {
        maxAlternatives: value,
      });
  }
}

/** [minLon, minLat, maxLon, maxLat]; the schemas already require four numbers. */
export function toBBox(values: number[] | undefined): BBox | undefined {
  if (!values) return undefined;
  if (values.length !== 4) {
    throw new IncorrectError(
      "A bounding box needs four numbers: [minLon, minLat, maxLon, maxLat]",
      {
        length: values.length,
      }
    );
  }
  const [minLon, minLat, maxLon, maxLat] = values;
  return [minLon, minLat, maxLon, maxLat];
}

export function toDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new IncorrectError("Dates must be ISO 8601 date-times, e.g. 2026-10-01T08:00:00Z", {
      [field]: value,
    });
  }
  return date;
}

/** A departure time, for the services that take no arrival time. */
export function toDepartAt(
  departAt: string | undefined
): DepartArriveParams<"departAt"> | undefined {
  return departAt ? { option: "departAt", date: toDate(departAt, "departAt") } : undefined;
}

/** The departure or arrival time; departAt wins when both are given. */
export function toWhen({
  departAt,
  arriveAt,
}: {
  departAt?: string;
  arriveAt?: string;
}): DepartArriveParams | undefined {
  if (departAt) return toDepartAt(departAt);
  if (arriveAt) return { option: "arriveBy", date: toDate(arriveAt, "arriveAt") };
  return undefined;
}
