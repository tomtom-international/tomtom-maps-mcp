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
  type BBox,
  type GeographyType,
  geographyTypes,
  type Language,
  type POICategory,
  poiCategories,
} from "@tomtom-org/maps-sdk/core";
import type {
  DepartArriveParams,
  GeoBias,
  LocalDateTime,
  MaxNumberOfAlternatives,
} from "@tomtom-org/maps-sdk/services";
import { IncorrectError } from "../../types/types";

/** Narrows a string to one of a closed list of values. */
export function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

function isPOICategory(value: string): value is POICategory {
  return isOneOf(poiCategories, value);
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

/** The SDK's runtime list as a keyed record, for toValues. */
function keyed<T extends string>(values: readonly T[]): Record<T, true> {
  return Object.fromEntries(values.map((value) => [value, true])) as Record<T, true>;
}

/** The geography filters take a comma-separated string, e.g. entityType "Municipality,Neighbourhood". */
function splitList(value: string | undefined): string[] | undefined {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toGeographyTypes(
  value: string | undefined,
  field: string
): GeographyType[] | undefined {
  return toValues(keyed(geographyTypes), splitList(value), field);
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

/**
 * Where a search looks: around a position, within its radius when one is given, or
 * inside a bounding box. The Search API ignores a radius without a position, and the
 * SDK takes a position or a bounding box, not both.
 */
export function toGeoBias({
  position,
  radius,
  boundingBox,
}: {
  position?: number[];
  radius?: number;
  boundingBox?: number[];
}): GeoBias | undefined {
  if (radius !== undefined && !position) {
    throw new IncorrectError("radius needs position", { radius });
  }
  if (position && boundingBox) {
    throw new IncorrectError("Give position or boundingBox, not both", { position, boundingBox });
  }
  const bbox = toBBox(boundingBox);
  if (bbox) return { boundingBox: bbox };
  if (!position) return undefined;
  return radius === undefined ? { position } : { position, radiusMeters: radius };
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

/** A date-time with no offset or `Z`, to the minute, second or fraction of one. */
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(\.\d+)?$/;

/**
 * The time to depart or arrive. A time with no offset is wall-clock time, which the
 * API reads at the origin, or at the destination for an arrival; the SDK validates it.
 * Anything else with no offset would be read in this server's time zone.
 */
function toDepartArrive<Option extends DepartArriveParams["option"]>(
  option: Option,
  value: string,
  field: string
): DepartArriveParams<Option> {
  const local = LOCAL_DATE_TIME.exec(value);
  if (local) {
    const [, toTheMinute, seconds = ":00"] = local;
    return { option, localDateTime: `${toTheMinute}${seconds}` as LocalDateTime };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new IncorrectError(
      "Give a time as well as the date, e.g. 2026-10-01T08:00 for 08:00 where the trip starts",
      { [field]: value }
    );
  }
  return { option, date: toDate(value, field) };
}

/** The departure or arrival time; the API takes only one. */
export function toWhen({
  departAt,
  arriveAt,
}: {
  departAt?: string;
  arriveAt?: string;
}): DepartArriveParams | undefined {
  if (departAt && arriveAt) {
    throw new IncorrectError("departAt and arriveAt cannot be combined", { departAt, arriveAt });
  }
  if (departAt) return toDepartArrive("departAt", departAt, "departAt");
  if (arriveAt) return toDepartArrive("arriveBy", arriveAt, "arriveAt");
  return undefined;
}
