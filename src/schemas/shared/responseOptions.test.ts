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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tomtomReachableRangeSchema } from "../routing/routingSchema";
import {
  geometryResponseDetailSchema,
  omittedUnlessGeometry,
  responseDetailSchema,
  uiVisibilityParam,
} from "./responseOptions";

/**
 * A customer integrating the MCP server into their own mapping product found
 * that no tool returned usable geometry, and that their agent kept asking for
 * TomTom's inline map widget instead. Both were description problems: nothing
 * told the agent how to get the coordinates, while every tool advertised an
 * "interactive map UI" it could not use.
 *
 * Coordinates now come from response_detail "geometry" (docs/adr/0003); "full"
 * is the raw, lossless API response. These tests pin that wording down so the
 * guidance cannot silently regress.
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
    expect(omittedUnlessGeometry("The boundary polygon", "is")).toBe(
      "The boundary polygon is omitted unless response_detail is 'geometry'."
    );
  });
});

describe("tool descriptions", () => {
  // Descriptions live inline in the registerTool/registerAppTool calls, so
  // this checks the source text.
  const DATA_TOOL_FILES = ["routingTools.ts", "searchTools.ts", "trafficTools.ts"];
  const TOOL_FILES = [...DATA_TOOL_FILES, "mapTools.ts"];

  // Phrases that promise a rendered map to hosts which may not render one, or
  // content that compact never returns (routing never requests guidance).
  const BANNED = [
    /interactive map/i,
    /interactive traffic visualization/i,
    /rendered as .* on the map/i,
    /find and display/i,
    /turn-by-turn directions/i,
  ];

  const readTool = (file: string) =>
    readFileSync(join(__dirname, "..", "..", "tools", file), "utf8");

  it.each(DATA_TOOL_FILES)("%s does not promise a map or directions it cannot return", (file) => {
    const source = readTool(file);
    for (const phrase of BANNED) {
      expect(source).not.toMatch(phrase);
    }
  });

  it("mapTools.ts ties the dynamic map's visual to MCP Apps support", () => {
    // The dynamic map exists to draw a map, so it may say so, provided it
    // names the client support that drawing needs.
    expect(readTool("mapTools.ts")).toMatch(/requires a client that supports MCP apps/i);
  });

  it.each(TOOL_FILES)("%s states omitted geometry through omittedUnlessGeometry", (file) => {
    expect(readTool(file)).not.toMatch(/omitted unless/i);
  });
});

describe("reachable range response_detail", () => {
  const description = tomtomReachableRangeSchema.response_detail.description ?? "";

  it("does not promise that a widget renders the polygon", () => {
    // Whether the widget renders depends on the host.
    expect(description).not.toMatch(/MCP App/i);
    expect(description).toMatch(/'geometry'[^']*Polygon/);
    expect(description).toMatch(/'full'/);
  });

  it("does not promise a center point that compact omits", () => {
    expect(description).not.toMatch(/center/i);
  });
});
