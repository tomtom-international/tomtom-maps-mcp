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
  toDepartAt,
  toGeoBias,
  toGeocodingIndexTypes,
  toLanguage,
  toMapcodes,
  toMaxAlternatives,
  toOpeningHours,
  toPOICategories,
  toReachableRangeAvoidables,
  toRelatedPois,
  toSearchIndexTypes,
  toTimeZone,
  toWhen,
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
      expect.objectContaining({
        message: "Unknown POI categories. Use tomtom-poi-categories to find valid category codes.",
        data: { unknown_categories: ["NOT_A_CATEGORY", "7315"] },
      })
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
      expect.objectContaining({
        message: "Unknown avoid values",
        data: {
          unknown_avoid: ["highways"],
          valid_values: expect.arrayContaining(["tollRoads", "motorways", "ferries"]),
        },
      })
    );
  });
});

describe("toReachableRangeAvoidables", () => {
  it("accepts the avoid values reachable range supports", () => {
    expect(toReachableRangeAvoidables(["tollRoads", "ferries"])).toEqual(["tollRoads", "ferries"]);
    expect(toReachableRangeAvoidables(undefined)).toBeUndefined();
  });

  it("rejects alreadyUsedRoads, which has no route to refer to", () => {
    expect(() => toReachableRangeAvoidables(["tollRoads", "alreadyUsedRoads"])).toThrow(
      "Reachable range cannot avoid alreadyUsedRoads"
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
      expect.objectContaining({
        message: "Unknown connector types",
        data: {
          unknown_connectors: ["CCS2"],
          valid_values: expect.arrayContaining(["StandardHouseholdCountrySpecific"]),
        },
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

describe("extra result fields", () => {
  it("accepts the values the SDK types allow", () => {
    expect(toMapcodes(["Local", "Alternative"])).toEqual(["Local", "Alternative"]);
    expect(toOpeningHours("nextSevenDays")).toBe("nextSevenDays");
    expect(toTimeZone("iana")).toBe("iana");
    expect(toRelatedPois("child")).toBe("child");
  });

  it("splits the comma-separated index types", () => {
    expect(toSearchIndexTypes("PAD, Addr")).toEqual(["PAD", "Addr"]);
    expect(toSearchIndexTypes(undefined)).toBeUndefined();
  });

  it("rejects the POI index for geocoding, which has none", () => {
    expect(toGeocodingIndexTypes("PAD,Addr")).toEqual(["PAD", "Addr"]);
    expect(() => toGeocodingIndexTypes("PAD,POI")).toThrow(
      expect.objectContaining({
        message: "Unknown option values",
        data: {
          field: "extendedPostalCodesFor",
          unknown_values: ["POI"],
          valid_values: ["Geo", "PAD", "Addr", "Str", "XStr"],
        },
      })
    );
  });

  it("rejects unknown values and lists the valid ones", () => {
    expect(() => toMapcodes(["Global"])).toThrow(
      expect.objectContaining({
        data: {
          field: "mapcodes",
          unknown_values: ["Global"],
          valid_values: ["Local", "International", "Alternative"],
        },
      })
    );
    expect(() => toOpeningHours("today")).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ unknown_values: ["today"] }) })
    );
  });
});

describe("toGeoBias", () => {
  it("biases by a point, with or without a radius", () => {
    expect(toGeoBias([4.9, 52.37], undefined, undefined)).toEqual({ position: [4.9, 52.37] });
    expect(toGeoBias([4.9, 52.37], 2000, undefined)).toEqual({
      position: [4.9, 52.37],
      radiusMeters: 2000,
    });
  });

  it("biases by a bounding box", () => {
    expect(toGeoBias(undefined, undefined, [4.8, 52.3, 4.95, 52.45])).toEqual({
      boundingBox: [4.8, 52.3, 4.95, 52.45],
    });
  });

  it("returns undefined without a position or bounding box", () => {
    expect(toGeoBias(undefined, 2000, undefined)).toBeUndefined();
  });

  it("rejects a position together with a bounding box", () => {
    expect(() => toGeoBias([4.9, 52.37], undefined, [4.8, 52.3, 4.95, 52.45])).toThrow(
      "Use either position (with an optional radius) or boundingBox, not both"
    );
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

describe("toWhen and toDepartAt", () => {
  it("prefers the departure time and maps an arrival time to arriveBy", () => {
    expect(toWhen({ departAt: "2026-10-01T08:00:00Z", arriveAt: "2026-10-01T10:00:00Z" })).toEqual({
      option: "departAt",
      date: new Date("2026-10-01T08:00:00Z"),
    });
    expect(toWhen({ arriveAt: "2026-10-01T10:00:00Z" })).toEqual({
      option: "arriveBy",
      date: new Date("2026-10-01T10:00:00Z"),
    });
    expect(toWhen({})).toBeUndefined();
  });

  it("returns no departure time when none is given", () => {
    expect(toDepartAt(undefined)).toBeUndefined();
  });
});
