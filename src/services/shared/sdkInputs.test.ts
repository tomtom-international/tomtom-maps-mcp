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

import { describe, expect, it } from "vitest";
import {
  toAvoidables,
  toBBox,
  toConnectorTypes,
  toDate,
  toLanguage,
  toMaxAlternatives,
  toPOICategories,
} from "./sdkInputs";
import { IncorrectError } from "../../types/types";

describe("toPOICategories", () => {
  it("keeps known category codes", () => {
    expect(toPOICategories(["RESTAURANT", "PARKING_GARAGE"])).toEqual([
      "RESTAURANT",
      "PARKING_GARAGE",
    ]);
  });

  it("returns undefined for no categories", () => {
    expect(toPOICategories(undefined)).toBeUndefined();
    expect(toPOICategories([])).toBeUndefined();
  });

  it("names only the unknown codes and points to tomtom-poi-categories", () => {
    const call = () => toPOICategories(["RESTAURANT", "NOT_A_CATEGORY", "7315"]);

    expect(call).toThrow(IncorrectError);
    expect(call).toThrow(
      "Unknown POI categories: NOT_A_CATEGORY, 7315. Use tomtom-poi-categories to find valid category codes."
    );
  });
});

describe("toAvoidables", () => {
  it("accepts a single value or a list", () => {
    expect(toAvoidables("tollRoads")).toEqual(["tollRoads"]);
    expect(toAvoidables(["ferries", "motorways"])).toEqual(["ferries", "motorways"]);
  });

  it("returns undefined for no values", () => {
    expect(toAvoidables(undefined)).toBeUndefined();
    expect(toAvoidables([])).toBeUndefined();
  });

  it("rejects unknown values and lists the valid ones", () => {
    expect(() => toAvoidables(["tollRoads", "highways"])).toThrow(
      /^Unknown avoid values: highways\. Valid values: tollRoads, motorways, ferries/
    );
  });
});

describe("toConnectorTypes", () => {
  it("keeps known connector types", () => {
    expect(toConnectorTypes(["IEC62196Type2CCS", "Chademo"])).toEqual([
      "IEC62196Type2CCS",
      "Chademo",
    ]);
  });

  it("rejects unknown connector types and lists the valid ones", () => {
    expect(() => toConnectorTypes(["CCS2"])).toThrow(
      /^Unknown connector types: CCS2\. Valid values: StandardHouseholdCountrySpecific,/
    );
  });
});

describe("toLanguage", () => {
  it("passes any language tag through, as the SDK does", () => {
    expect(toLanguage("nl-NL")).toBe("nl-NL");
    expect(toLanguage("en")).toBe("en");
    expect(toLanguage(undefined)).toBeUndefined();
  });
});

describe("toMaxAlternatives", () => {
  it("accepts whole numbers from 0 to 5", () => {
    expect(toMaxAlternatives(0)).toBe(0);
    expect(toMaxAlternatives(5)).toBe(5);
    expect(toMaxAlternatives(undefined)).toBeUndefined();
  });

  it.each([6, -1, 1.5])("rejects %s", (value) => {
    expect(() => toMaxAlternatives(value)).toThrow(
      "maxAlternatives must be a whole number from 0 to 5"
    );
  });
});

describe("toBBox", () => {
  it("returns the four numbers as a bounding box", () => {
    expect(toBBox([4.8, 52.3, 4.95, 52.45])).toEqual([4.8, 52.3, 4.95, 52.45]);
    expect(toBBox(undefined)).toBeUndefined();
  });

  it("rejects anything but four numbers", () => {
    expect(() => toBBox([4.8, 52.3, 4.95])).toThrow("A bounding box needs four numbers");
  });
});

describe("toDate", () => {
  it("parses ISO 8601 date-times", () => {
    expect(toDate("2026-10-01T08:00:00Z", "departAt").toISOString()).toBe(
      "2026-10-01T08:00:00.000Z"
    );
  });

  it("names the parameter when the value is not a date", () => {
    expect(() => toDate("tomorrow morning", "departAt")).toThrow(
      "departAt must be an ISO 8601 date-time"
    );
  });
});
