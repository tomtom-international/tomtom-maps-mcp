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
import { uiVisibilityParam as routingUiParam } from "../routing/commonOrbis";
import { tomtomReachableRangeSchema as mapsRangeSchema } from "../routing/routingSchema";
import { tomtomReachableRangeSchema as orbisRangeSchema } from "../routing/routingOrbisSchema";
import { uiVisibilityParam as searchUiParam } from "../search/commonOrbis";
import { responseDetailSchema } from "./responseOptions";

/**
 * A customer integrating the MCP server into their own mapping product found
 * that no tool returned usable geometry, and that their agent kept asking for
 * TomTom's inline map widget instead. Both were description problems: nothing
 * told the agent that `response_detail: "full"` carries the coordinates, while
 * every tool advertised an "interactive map UI" it could not use.
 *
 * These tests pin that wording down so the guidance cannot silently regress.
 */
describe("response_detail guidance", () => {
  const description = responseDetailSchema.description ?? "";

  it("tells the caller that compact omits geometry", () => {
    expect(description).toMatch(/compact/i);
    expect(description).toMatch(/geometry|coordinates/i);
    expect(description).toMatch(/omitted/i);
  });

  it("tells the caller that full is how to obtain coordinates", () => {
    expect(description).toMatch(/'full'/);
    // The agent must be able to connect "I need coordinates" to this option.
    expect(description).toMatch(/coordinates/i);
  });

  it("warns that full is expensive, so it is not used by default", () => {
    // A long route at full detail exceeds 500KB; without this the model has no
    // reason to prefer compact.
    expect(description).toMatch(/larger|500KB/i);
  });
});

describe("show_ui guidance", () => {
  for (const [family, param] of [
    ["routing", routingUiParam],
    ["search", searchUiParam],
  ] as const) {
    const description = param.show_ui.description ?? "";

    it(`${family}: does not invite the model to request a widget unconditionally`, () => {
      expect(description).not.toMatch(/when visualization is needed/i);
      expect(description).toMatch(/MCP Apps/);
    });

    it(`${family}: states the widget is not a source of coordinates`, () => {
      expect(description).toMatch(/no coordinates/i);
    });

    it(`${family}: still defaults to off`, () => {
      expect(param.show_ui.parse(undefined)).toBe(false);
    });
  }
});

describe("tool descriptions", () => {
  // Registration files for both backends. Descriptions live inline in the
  // registerTool/registerAppTool calls, so this checks the source text.
  const TOOL_FILES = [
    "mapOrbisTools.ts",
    "mapTools.ts",
    "routingOrbisTools.ts",
    "routingTools.ts",
    "searchOrbisTools.ts",
    "searchTools.ts",
    "trafficOrbisTools.ts",
    "trafficTools.ts",
  ];

  // Phrases that promise a rendered map to hosts which may not render one, or
  // content that compact never returns (guidance is always trimmed, and the
  // Orbis backend never requests it).
  const BANNED = [
    /interactive map/i,
    /interactive traffic visualization/i,
    /rendered as .* on the map/i,
    /find and display/i,
    /turn-by-turn directions/i,
  ];

  it.each(TOOL_FILES)("%s does not promise a map or directions it cannot return", (file) => {
    const source = readFileSync(join(__dirname, "..", "..", "tools", file), "utf8");
    for (const phrase of BANNED) {
      expect(source).not.toMatch(phrase);
    }
  });
});

describe("reachable range response_detail", () => {
  for (const [backend, schema] of [
    ["tomtom-maps", mapsRangeSchema],
    ["tomtom-orbis-maps", orbisRangeSchema],
  ] as const) {
    const description = schema.response_detail.description ?? "";

    it(`${backend}: does not promise that a widget renders the polygon`, () => {
      // The TomTom Maps backend has no widget, and on Orbis it depends on the host.
      expect(description).not.toMatch(/MCP App/i);
      expect(description).toMatch(/'full'/);
    });
  }

  it("tomtom-orbis-maps: does not promise a center point that compact omits", () => {
    expect(orbisRangeSchema.response_detail.description).not.toMatch(/center/i);
  });
});
