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

import { describe, it, expect } from "vitest";
import { getServerInstructions } from "./instructions";

describe("getServerInstructions", () => {
  const standard = getServerInstructions(false);
  const orbis = getServerInstructions(true);

  it("should return non-empty strings for both backends", () => {
    expect(standard.length).toBeGreaterThan(0);
    expect(orbis.length).toBeGreaterThan(0);
  });

  it("should return different content for standard vs Orbis", () => {
    expect(standard).not.toBe(orbis);
  });

  it("standard instructions should reference standard-only tools", () => {
    expect(standard).toContain("tomtom-static-map");
    expect(standard).toContain("tomtom-waypoint-routing");
  });

  it("standard instructions should NOT reference Orbis-exclusive tools", () => {
    expect(standard).not.toContain("tomtom-ev-routing");
    expect(standard).not.toContain("tomtom-data-viz");
    expect(standard).not.toContain("tomtom-area-search");
    expect(standard).not.toContain("tomtom-ev-search");
    expect(standard).not.toContain("tomtom-search-along-route");
    expect(standard).not.toContain("tomtom-poi-categories");
  });

  it("Orbis instructions should reference Orbis-exclusive tools", () => {
    expect(orbis).toContain("tomtom-ev-routing");
    expect(orbis).toContain("tomtom-data-viz");
    expect(orbis).toContain("tomtom-area-search");
    expect(orbis).toContain("tomtom-ev-search");
    expect(orbis).toContain("tomtom-search-along-route");
    expect(orbis).toContain("tomtom-poi-categories");
  });

  it("Orbis instructions should NOT reference standard-only tools", () => {
    expect(orbis).not.toContain("tomtom-static-map");
    expect(orbis).not.toContain("tomtom-waypoint-routing");
  });

  it("both instructions should reference shared tools", () => {
    for (const instructions of [standard, orbis]) {
      expect(instructions).toContain("tomtom-routing");
      expect(instructions).toContain("tomtom-traffic");
      expect(instructions).toContain("tomtom-dynamic-map");
      expect(instructions).toContain("tomtom-geocode");
      expect(instructions).toContain("tomtom-fuzzy-search");
    }
  });
});

describe("tool-instruction coherence", () => {
  const standard = getServerInstructions(false);
  const orbis = getServerInstructions(true);

  const STANDARD_TOOLS = [
    "tomtom-geocode",
    "tomtom-reverse-geocode",
    "tomtom-fuzzy-search",
    "tomtom-poi-search",
    "tomtom-nearby",
    "tomtom-routing",
    "tomtom-waypoint-routing",
    "tomtom-reachable-range",
    "tomtom-traffic",
    "tomtom-static-map",
    "tomtom-dynamic-map",
  ];

  const ORBIS_TOOLS = [
    "tomtom-geocode",
    "tomtom-reverse-geocode",
    "tomtom-fuzzy-search",
    "tomtom-poi-search",
    "tomtom-nearby",
    "tomtom-poi-categories",
    "tomtom-area-search",
    "tomtom-ev-search",
    "tomtom-search-along-route",
    "tomtom-routing",
    "tomtom-reachable-range",
    "tomtom-ev-routing",
    "tomtom-traffic",
    "tomtom-dynamic-map",
    "tomtom-data-viz",
  ];

  it("standard instructions should reference every standard tool", () => {
    for (const tool of STANDARD_TOOLS) {
      expect(standard, `missing tool: ${tool}`).toContain(tool);
    }
  });

  it("Orbis instructions should reference every Orbis tool", () => {
    for (const tool of ORBIS_TOOLS) {
      expect(orbis, `missing tool: ${tool}`).toContain(tool);
    }
  });
});

describe("LLM interpretation quality — keyword coverage", () => {
  const standard = getServerInstructions(false);
  const orbis = getServerInstructions(true);

  const KEYWORD_CHECKS: Array<{
    tool: string;
    keywords: string[];
    backends: ("standard" | "orbis")[];
  }> = [
    { tool: "tomtom-geocode", keywords: ["address", "coordinates"], backends: ["standard", "orbis"] },
    { tool: "tomtom-reverse-geocode", keywords: ["coordinates", "address"], backends: ["standard", "orbis"] },
    { tool: "tomtom-routing", keywords: ["route", "directions"], backends: ["standard", "orbis"] },
    { tool: "tomtom-traffic", keywords: ["traffic", "incidents"], backends: ["standard", "orbis"] },
    { tool: "tomtom-dynamic-map", keywords: ["markers", "polygons"], backends: ["standard", "orbis"] },
    { tool: "tomtom-static-map", keywords: ["map"], backends: ["standard"] },
    { tool: "tomtom-poi-search", keywords: ["POI", "business"], backends: ["standard", "orbis"] },
    { tool: "tomtom-nearby", keywords: ["nearby", "near"], backends: ["standard", "orbis"] },
    { tool: "tomtom-fuzzy-search", keywords: ["search", "typo"], backends: ["standard", "orbis"] },
    { tool: "tomtom-reachable-range", keywords: ["reachable", "range"], backends: ["standard", "orbis"] },
    { tool: "tomtom-waypoint-routing", keywords: ["waypoint", "multi-stop", "3+"], backends: ["standard"] },
    { tool: "tomtom-poi-categories", keywords: ["category", "UPPER_SNAKE_CASE"], backends: ["orbis"] },
    { tool: "tomtom-area-search", keywords: ["boundary", "polygon"], backends: ["orbis"] },
    { tool: "tomtom-ev-search", keywords: ["EV", "charging"], backends: ["orbis"] },
    { tool: "tomtom-ev-routing", keywords: ["EV", "charging"], backends: ["orbis"] },
    { tool: "tomtom-search-along-route", keywords: ["along", "route"], backends: ["orbis"] },
    { tool: "tomtom-data-viz", keywords: ["heatmap", "GeoJSON", "choropleth"], backends: ["orbis"] },
  ];

  for (const { tool, keywords, backends } of KEYWORD_CHECKS) {
    for (const backend of backends) {
      it(`${tool} (${backend}) — instructions contain at least one keyword: [${keywords.join(", ")}]`, () => {
        const instructions = backend === "standard" ? standard : orbis;
        const found = keywords.some((kw) => instructions.toLowerCase().includes(kw.toLowerCase()));
        expect(found, `${tool}: none of [${keywords.join(", ")}] found in ${backend} instructions`).toBe(
          true
        );
      });
    }
  }
});
