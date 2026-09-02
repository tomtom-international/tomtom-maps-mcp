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
 * Unit tests for the scenario assertions. No model, no credentials — the
 * assertions are pure functions over an `AgentRun`, so a hand-built run exercises
 * them completely. Worth having: these are what decide whether a phase-4 eval
 * passes, and an assertion that silently always passes is worse than no assertion.
 */

import { describe, expect, it } from "vitest";
import type { ToolCall } from "../vendor/types";
import type { AgentRun } from "./mcp-agent";
import {
  expectAnyToolCalled,
  expectEveryToolCallWith,
  expectNoneOfToolsCalled,
  expectToolCallCount,
  expectToolCalledInOrder,
  expectToolCalledWith,
} from "./scenario";

const run = (...calls: ToolCall[]): AgentRun => ({
  outcome: "done",
  toolCalls: calls,
  messages: [],
  usage: { inputTokens: 0, outputTokens: 0 },
});

const call = (name: string, input: unknown = {}): ToolCall => ({
  name,
  input,
  output: {},
});

describe("expectToolCalledWith", () => {
  it("passes when the arguments match", () => {
    const r = run(call("tomtom-discover-places", { query: "pizza", limit: 10 }));
    expect(
      expectToolCalledWith(r, "tomtom-discover-places", (i: { limit: number }) => i.limit === 10)
    ).toBeUndefined();
  });

  it("fails when the tool was never called", () => {
    const problem = expectToolCalledWith(
      run(call("tomtom-locate-place")),
      "tomtom-get-traffic",
      () => true
    );
    expect(problem).toContain("never called");
  });

  it("passes when ANY call matches, not only the first", () => {
    // An agent may search several times; one correct call is correct routing.
    const r = run(
      call("tomtom-discover-places", { query: "restaurants" }),
      call("tomtom-discover-places", { poiCategories: ["ITALIAN_RESTAURANT"] })
    );
    expect(
      expectToolCalledWith(
        r,
        "tomtom-discover-places",
        (i: { poiCategories?: string[] }) => !!i.poiCategories?.length
      )
    ).toBeUndefined();
  });

  it("reports the actual arguments of every non-matching call", () => {
    const r = run(
      call("tomtom-discover-places", { query: "restaurants" }),
      call("tomtom-discover-places", { query: "cafes" })
    );
    const problem = expectToolCalledWith(
      r,
      "tomtom-discover-places",
      (i: { poiCategories?: string[] }) => !!i.poiCategories?.length
    );
    expect(problem).toContain("called 2 time(s)");
    // Without the real arguments in the message, a failure is undebuggable.
    expect(problem).toContain('"restaurants"');
    expect(problem).toContain('"cafes"');
  });

  it("surfaces a string verdict as the stated reason", () => {
    const problem = expectToolCalledWith(
      run(call("tomtom-discover-places", { query: "Amsterdam" })),
      "tomtom-discover-places",
      () => "region was passed as the search subject"
    );
    expect(problem).toContain("region was passed as the search subject");
  });

  it("falls back to a generic reason for a bare false", () => {
    const problem = expectToolCalledWith(
      run(call("tomtom-locate-place", { query: "x" })),
      "tomtom-locate-place",
      () => false
    );
    expect(problem).toContain("arguments did not match");
  });

  it("truncates a huge argument instead of burying the diagnostic", () => {
    const fat = { geojson: "x".repeat(5000) };
    const problem = expectToolCalledWith(
      run(call("tomtom-data-viz", fat)),
      "tomtom-data-viz",
      () => false
    );
    expect(problem).toContain("…");
    expect(problem!.length).toBeLessThan(600);
  });

  // The phase-4 failure mode this assertion exists for: the right tool, called
  // with the search SUBJECT in the region slot.
  it("distinguishes subject-in-where from region-in-where", () => {
    const isWellFormed = (i: {
      poiCategories?: string[];
      where?: { queries?: { query: string }[] };
    }) => {
      if (!i.poiCategories?.length) return "search subject missing from poiCategories";
      if (i.where?.queries?.[0]?.query !== "Amsterdam") return "region missing from where.queries";
      return true;
    };

    const wrong = run(
      call("tomtom-discover-places", { where: { queries: [{ query: "restaurants" }] } })
    );
    const right = run(
      call("tomtom-discover-places", {
        poiCategories: ["ITALIAN_RESTAURANT"],
        where: { queries: [{ query: "Amsterdam" }] },
      })
    );

    expect(expectToolCalledWith(wrong, "tomtom-discover-places", isWellFormed)).toContain(
      "search subject missing"
    );
    expect(expectToolCalledWith(right, "tomtom-discover-places", isWellFormed)).toBeUndefined();
  });
});

describe("expectEveryToolCallWith", () => {
  it("passes only when every call matches", () => {
    const ok = run(
      call("tomtom-discover-places", { limit: 10 }),
      call("tomtom-discover-places", { limit: 20 })
    );
    const bad = run(
      call("tomtom-discover-places", { limit: 10 }),
      call("tomtom-discover-places", { limit: 500 })
    );
    const capped = (i: { limit: number }) => i.limit <= 100;

    expect(expectEveryToolCallWith(ok, "tomtom-discover-places", capped)).toBeUndefined();
    expect(expectEveryToolCallWith(bad, "tomtom-discover-places", capped)).toContain("call [1]");
  });

  it("fails when the tool was never called", () => {
    expect(expectEveryToolCallWith(run(), "tomtom-discover-places", () => true)).toContain(
      "never called"
    );
  });
});

// Guards for the pre-existing assertions — they had no unit tests, and
// `expectToolCalledInOrder` in particular has index arithmetic worth pinning.
describe("existing assertions", () => {
  const r = run(call("a"), call("b"), call("a"));

  it("expectAnyToolCalled is an OR", () => {
    expect(expectAnyToolCalled(r, "z", "b")).toBeUndefined();
    expect(expectAnyToolCalled(r, "z")).toContain("Expected one of");
  });

  it("expectNoneOfToolsCalled names the offender", () => {
    expect(expectNoneOfToolsCalled(r, "z")).toBeUndefined();
    expect(expectNoneOfToolsCalled(r, "z", "b")).toContain("Tool b was called");
  });

  it("expectToolCalledInOrder requires strictly increasing positions", () => {
    expect(expectToolCalledInOrder(r, "a", "b")).toBeUndefined();
    expect(expectToolCalledInOrder(r, "a", "b", "a")).toBeUndefined();
    expect(expectToolCalledInOrder(r, "b", "b")).toContain("not called after position");
  });

  it("expectToolCallCount is exact", () => {
    expect(expectToolCallCount(r, "a", 2)).toBeUndefined();
    expect(expectToolCallCount(r, "a", 1)).toContain("called 2");
  });
});
