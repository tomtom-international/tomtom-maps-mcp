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
 *
 * Characterisation tests for the ported compaction.
 *
 * They pin the behaviour this repo depends on, so that swapping the port for the
 * real `agent-eval` import later is a change these tests either accept or
 * object to — rather than a silent shift in what the judge sees.
 */

import { describe, expect, it } from "vitest";
import { classifyToolCall, convertToEvidence, convertToJsonString } from "./tool-evidence";

const incidents = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `inc-${index}`,
    properties: { roadNumbers: [`A${index}`], delay: index * 7 },
  }));

describe("convertToEvidence", () => {
  it("emits valid JSON however large the input", () => {
    // The failure this port replaces sliced the serialised text at 6,000
    // characters, handing the judge a fragment ending mid-token.
    const { text } = convertToEvidence({ features: incidents(4000) });
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("collapses a bulk array to its count and a sample", () => {
    // `count` is the whole point: it keeps "203 incidents" checkable without
    // showing 203 rows, which a length-based cut cannot do.
    const { text, stats } = convertToEvidence({ features: incidents(203) });
    const features = JSON.parse(text).features as { count: number; sample: unknown[] };

    expect(features.count).toBe(203);
    expect(features.sample).toHaveLength(2);
    expect(stats.collapsedArrays).toBe(1);
  });

  it("keeps every key rather than dropping fields", () => {
    const { text } = convertToEvidence({ a: 1, b: { c: 2 }, features: incidents(50) });
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed).sort()).toEqual(["a", "b", "features"]);
  });

  it("shows a short object array whole", () => {
    const { text, stats } = convertToEvidence({ features: incidents(8) });
    expect((JSON.parse(text).features as unknown[]).length).toBe(8);
    expect(stats.collapsedArrays).toBe(0);
  });

  it("keeps scalar arrays longer, since they are evidence for numeric claims", () => {
    // A timeseries collapsed to two points makes every claim about it
    // ungroundable — the original's stated reason for the higher cap.
    const series = Array.from({ length: 60 }, (_, i) => i);
    const { text } = convertToEvidence({ hourly: series });
    expect(JSON.parse(text).hourly).toHaveLength(60);
  });

  it("caps a long string with a visible remainder", () => {
    const { text, stats } = convertToEvidence({ note: "x".repeat(900) });
    expect(JSON.parse(text).note).toMatch(/\[\+400 chars\]$/);
    expect(stats.truncatedStrings).toBe(1);
  });

  it("reports nothing collapsed for a small result", () => {
    const { stats } = convertToEvidence({ features: incidents(3) });
    expect(stats.collapsedArrays).toBe(0);
    expect(stats.truncatedStrings).toBe(0);
  });

  it("survives the shapes a tool result can take", () => {
    for (const value of [null, "text", 42, [], {}, { a: [null, [1, 2]] }]) {
      expect(() => JSON.parse(convertToJsonString(value))).not.toThrow();
    }
    expect(convertToJsonString(undefined)).toBe("none");
  });
});

describe("classifyToolCall", () => {
  it("separates a failure from an empty result from data", () => {
    // A judge must never treat "the tool broke" as evidence of absence.
    expect(classifyToolCall({ name: "t", output: { error: "boom" } })).toBe("failed");
    expect(classifyToolCall({ name: "t", output: { features: [] } })).toBe("empty");
    expect(classifyToolCall({ name: "t", output: { count: 0 } })).toBe("empty");
    expect(classifyToolCall({ name: "t", output: { features: [{}] } })).toBe("ok");
  });
});
