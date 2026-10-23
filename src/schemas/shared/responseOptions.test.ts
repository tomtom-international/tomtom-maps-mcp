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
  geometryResponseDetailSchema,
  omittedUnlessGeometry,
  responseDetailSchema,
  uiVisibilityParam,
} from "./responseOptions";

/**
 * Pins the description wording that tells the agent how to get coordinates:
 * response_detail "geometry" (docs/adr/0003) returns them, "full" is the raw
 * lossless response, and no tool promises a map the host may not render.
 */
describe("response_detail guidance", () => {
  const description = geometryResponseDetailSchema.description ?? "";

  it("tells the caller that compact has no geometry", () => {
    expect(description).toMatch(/'compact' \(default\)[^.]*no geometry/i);
  });

  it("tells the caller that geometry is how to obtain coordinates", () => {
    expect(description).toMatch(/'geometry'/);
    expect(description).toMatch(/GeoJSON FeatureCollection/);
    // The agent must be able to connect "I need coordinates" to this option.
    expect(description).toMatch(/'geometry'[^']*coordinates/i);
    expect(description).toMatch(/1,000 vertices/);
  });

  it("describes full as the raw, lossless response and warns about its size", () => {
    expect(description).toMatch(/'full': the raw API response, lossless/);
    expect(description).toMatch(/larger/i);
  });

  it("offers geometry only on tools that have geometry", () => {
    expect(geometryResponseDetailSchema.unwrap().unwrap().options).toEqual([
      "compact",
      "geometry",
      "full",
    ]);
    expect(responseDetailSchema.unwrap().unwrap().options).toEqual(["compact", "full"]);
    expect(responseDetailSchema.description).not.toMatch(/geometry/i);
  });
});

describe("show_ui guidance", () => {
  const description = uiVisibilityParam.show_ui.description ?? "";

  it("does not invite the model to request a widget unconditionally", () => {
    expect(description).not.toMatch(/when visualization is needed/i);
    expect(description).toMatch(/MCP Apps/);
  });

  it("states the widget is not a source of coordinates", () => {
    expect(description).toMatch(/no coordinates/i);
  });

  it("still defaults to off", () => {
    expect(uiVisibilityParam.show_ui.parse(undefined)).toBe(false);
  });
});

describe("omittedUnlessGeometry", () => {
  it("names the response_detail value that returns the geometry", () => {
    // Coordinates come from 'geometry'; 'full' is the raw response.
    expect(omittedUnlessGeometry("Route polylines")).toBe(
      "Route polylines are omitted unless response_detail is 'geometry'."
    );
    expect(omittedUnlessGeometry("The route line", "is")).toBe(
      "The route line is omitted unless response_detail is 'geometry'."
    );
  });
});
