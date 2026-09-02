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
import { featuresOf, runToolQuery } from "./analyse-result";

const parse = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0].text) as Record<string, never>;

const fc = (n: number) => ({
  type: "FeatureCollection",
  features: Array.from({ length: n }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [4 + i / 100, 52] },
    properties: { power: i * 10 },
  })),
});

describe("featuresOf", () => {
  it("reads whichever envelope a tool result uses", () => {
    expect(featuresOf(fc(3))).toHaveLength(3);
    expect(featuresOf({ incidents: [1, 2] })).toHaveLength(2);
    expect(featuresOf({ type: "Feature" })).toHaveLength(1);
    expect(featuresOf(null)).toHaveLength(0);
  });
});

describe("runToolQuery", () => {
  it("computes over every feature, not the ones a response would show", async () => {
    // The point of the phase: 500 features never cross the conversation, and the
    // count is still right.
    const result = await runToolQuery("return features.length", fc(500), "Traffic");

    expect(result.isError).toBeUndefined();
    const body = parse(result as never);
    expect(body.analysis).toBe(500);
    expect(body.queriedOver).toMatchObject({ tool: "Traffic", features: 500 });
  });

  it("returns only the computed value, never the data it ran over", async () => {
    const result = await runToolQuery(
      "return features.filter((f) => f.properties.power >= 50).length",
      fc(10),
      "Place discovery"
    );

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(parse(result as never).analysis).toBe(5);
    expect(text).not.toContain("coordinates");
  });

  it("has turf in scope for spatial questions", async () => {
    const result = await runToolQuery(
      "return Math.round(turf.distance(features[0], features[9], { units: 'kilometers' }))",
      fc(10),
      "Place discovery"
    );

    expect(typeof parse(result as never).analysis).toBe("number");
  });

  it("reports code that returns nothing rather than answering with null", async () => {
    const result = await runToolQuery("features.length", fc(3), "Traffic");

    expect(result.isError).toBe(true);
    expect(parse(result as never).error).toContain("must return a value");
  });

  it("reports a runtime failure as an error, not an answer", async () => {
    const result = await runToolQuery("return nope.missing", fc(3), "Traffic");

    expect(result.isError).toBe(true);
  });
});
