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

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  CalculateRouteParams,
  GeometrySearchParams,
  ReachableRangeParams,
} from "@tomtom-org/maps-sdk/services";

// The request builders are typed with the maps-sdk parameter types, so a
// misspelt or misplaced key fails `pnpm type-check`. Each @ts-expect-error line
// below is a key the SDK does not accept at that place; type-check fails if one
// of them stops being an error, e.g. after an SDK upgrade loosens a type.
describe("maps-sdk parameter types", () => {
  type Vehicle = NonNullable<ReachableRangeParams["vehicle"]>;

  it("reject vehicle keys under the wrong names", () => {
    const maxSpeed: Vehicle = {
      // @ts-expect-error the SDK key is maxSpeedKMH
      restrictions: { maxSpeedInKilometersPerHour: 30 },
    };
    const weight: Vehicle = {
      // @ts-expect-error the SDK key is weightKG
      model: { dimensions: { weightInKilograms: 3500 } },
    };
    const efficiency: Vehicle = {
      engineType: "combustion",
      model: {
        engine: {
          consumption: {
            speedsToConsumptionsLiters: [{ speedKMH: 50, consumptionUnitsPer100KM: 6.3 }],
            // @ts-expect-error the SDK key is acceleration
            efficiency: { accelerationEfficiency: 0.33 },
          },
        },
      },
    };

    expect([maxSpeed, weight, efficiency]).toHaveLength(3);
  });

  it("reject route options at the top level instead of under costModel and when", () => {
    const route: CalculateRouteParams = {
      locations: [
        [4.9, 52.37],
        [5.1, 52.09],
      ],
      // @ts-expect-error routeType belongs in costModel
      routeType: "short",
    };
    const departure: CalculateRouteParams = {
      locations: [
        [4.9, 52.37],
        [5.1, 52.09],
      ],
      // @ts-expect-error the departure time belongs in when
      departAt: "2026-10-01T08:00:00Z",
    };

    expect([route, departure]).toHaveLength(2);
  });

  it("reject a country filter on geometry search, which has none", () => {
    const params: GeometrySearchParams = {
      query: "restaurant",
      geometries: [{ type: "Circle", coordinates: [4.9, 52.37], radius: 500 }],
      // @ts-expect-error geometry search takes no country filter
      countries: ["NL"],
    };

    expect(params.geometries).toHaveLength(1);
  });
});

// A cast into an SDK parameter type switches the checks above off again.
describe("request builders", () => {
  const srcDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const builderFiles = [
    ...["routing", "search", "traffic"].flatMap((dir) =>
      readdirSync(join(srcDir, "services", dir)).map((file) => join("services", dir, file))
    ),
    ...readdirSync(join(srcDir, "handlers"))
      .filter((file) => /^(routing|search|traffic)/.test(file))
      .map((file) => join("handlers", file)),
  ].filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

  it("finds the routing, search and traffic sources", () => {
    expect(builderFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(builderFiles)("%s does not cast into SDK parameter types", (file) => {
    const source = readFileSync(join(srcDir, file), "utf8");

    expect(source).not.toMatch(/as Parameters<typeof /);
    expect(source).not.toMatch(/as unknown as /);
    expect(source).not.toMatch(
      /as (CalculateRouteParams|ReachableRangeParams|FuzzySearchParams)\b/
    );
  });
});
