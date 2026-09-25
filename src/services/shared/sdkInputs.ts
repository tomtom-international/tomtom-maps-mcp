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
  avoidableTypes,
  connectorTypes,
  poiCategoriesToIDs,
  type Avoidable,
  type BBox,
  type ConnectorType,
  type Language,
  type POICategory,
} from "@tomtom-org/maps-sdk/core";
import type { MaxNumberOfAlternatives } from "@tomtom-org/maps-sdk/services";
import { IncorrectError } from "../../types/types";

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

function isPOICategory(value: string): value is POICategory {
  return Object.hasOwn(poiCategoriesToIDs, value);
}

function isAvoidable(value: string): value is Avoidable {
  return isOneOf(avoidableTypes, value);
}

function isConnectorType(value: string): value is ConnectorType {
  return isOneOf(connectorTypes, value);
}

export function toPOICategories(values: string[] | undefined): POICategory[] | undefined {
  if (!values?.length) return undefined;
  const categories = values.filter(isPOICategory);
  if (categories.length !== values.length) {
    const unknown = values.filter((value) => !isPOICategory(value));
    throw new IncorrectError(
      `Unknown POI categories: ${unknown.join(", ")}. Use tomtom-poi-categories to find valid category codes.`,
      { unknown_categories: unknown }
    );
  }
  return categories;
}

export function toAvoidables(values: string | string[] | undefined): Avoidable[] | undefined {
  if (values === undefined) return undefined;
  const list = Array.isArray(values) ? values : [values];
  if (list.length === 0) return undefined;
  const avoidables = list.filter(isAvoidable);
  if (avoidables.length !== list.length) {
    const unknown = list.filter((value) => !isAvoidable(value));
    throw new IncorrectError(
      `Unknown avoid values: ${unknown.join(", ")}. Valid values: ${avoidableTypes.join(", ")}.`,
      { unknown_avoid: unknown }
    );
  }
  return avoidables;
}

export function toConnectorTypes(values: string[] | undefined): ConnectorType[] | undefined {
  if (!values?.length) return undefined;
  const connectors = values.filter(isConnectorType);
  if (connectors.length !== values.length) {
    const unknown = values.filter((value) => !isConnectorType(value));
    throw new IncorrectError(
      `Unknown connector types: ${unknown.join(", ")}. Valid values: ${connectorTypes.join(", ")}.`,
      { unknown_connectors: unknown }
    );
  }
  return connectors;
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
    throw new IncorrectError(`${field} must be an ISO 8601 date-time, e.g. 2026-10-01T08:00:00Z`, {
      [field]: value,
    });
  }
  return date;
}
