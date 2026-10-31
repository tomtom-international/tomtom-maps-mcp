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
import { IncorrectError } from "../../types/types";
import {
  toBBox,
  toDate,
  toGeographyTypes,
  toLanguage,
  toMaxAlternatives,
  toPOICategories,
  toWhen,
} from "./sdkInputs";

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
      expect.objectContaining({
        message: "Unknown POI categories. Use tomtom-poi-categories to find valid category codes.",
        data: { unknown_categories: ["NOT_A_CATEGORY", "7315"] },
      })
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
      expect.objectContaining({ data: { departAt: "tomorrow morning" } })
    );
  });
});

describe("toWhen", () => {
  it("rejects a departure and an arrival time together", () => {
    expect(() =>
      toWhen({ departAt: "2026-10-01T08:00:00Z", arriveAt: "2026-10-01T10:00:00Z" })
    ).toThrow("departAt and arriveAt cannot be combined");
  });

  it("maps a departure time to departAt and an arrival time to arriveBy", () => {
    expect(toWhen({ departAt: "2026-10-01T08:00:00Z" })).toEqual({
      option: "departAt",
      date: new Date("2026-10-01T08:00:00Z"),
    });
    expect(toWhen({ arriveAt: "2026-10-01T10:00:00Z" })).toEqual({
      option: "arriveBy",
      date: new Date("2026-10-01T10:00:00Z"),
    });
    expect(toWhen({})).toBeUndefined();
  });

  it("sends a time without an offset as local wall-clock time, seconds added", () => {
    expect(toWhen({ departAt: "2026-10-01T08:15" })).toEqual({
      option: "departAt",
      localDateTime: "2026-10-01T08:15:00",
    });
    expect(toWhen({ arriveAt: "2026-10-01T17:00:00" })).toEqual({
      option: "arriveBy",
      localDateTime: "2026-10-01T17:00:00",
    });
  });

  it("sends a time with fractional seconds and no offset as local time, not this server's", () => {
    expect(toWhen({ departAt: "2026-06-01T08:00:00.000" })).toEqual({
      option: "departAt",
      localDateTime: "2026-06-01T08:00:00",
    });
  });

  it("reads a time written with a space instead of T as local time too", () => {
    expect(toWhen({ departAt: "2026-10-01 08:15" })).toEqual({
      option: "departAt",
      localDateTime: "2026-10-01T08:15:00",
    });
  });

  it("rejects a date with no time rather than reading it as midnight UTC", () => {
    expect(() => toWhen({ departAt: "2026-06-01" })).toThrow("Give a time as well as the date");
  });
});

describe("toGeographyTypes", () => {
  it("splits the comma-separated geography types", () => {
    expect(toGeographyTypes("Municipality,Country", "entityType")).toEqual([
      "Municipality",
      "Country",
    ]);
  });

  it("rejects an unknown value with the valid ones", () => {
    expect(() => toGeographyTypes("Town", "entityType")).toThrow(
      expect.objectContaining({
        data: expect.objectContaining({ field: "entityType", valid_values: expect.any(Array) }),
      })
    );
  });
});
