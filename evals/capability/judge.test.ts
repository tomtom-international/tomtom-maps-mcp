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
import { summarize, type TaskResult } from "./judge";

const result = (overrides: Partial<TaskResult> = {}): TaskResult => ({
  id: "task",
  capability: "lookup",
  expected: "pass",
  answered: true,
  grounded: true,
  acknowledgedLimit: false,
  madeClaims: true,
  reason: "",
  judgedOnCompleteData: true,
  toolsCalled: ["tomtom-locate-place"],
  tokens: 100,
  toolFriction: [],
  ...overrides,
});

const refusal = (id: string): TaskResult =>
  result({ id, answered: false, madeClaims: false, acknowledgedLimit: true });

describe("summarize", () => {
  it("scores an all-refusal run as claiming nothing and fabricating nothing", () => {
    const summary = summarize([refusal("a"), refusal("b")]);
    expect(summary).toMatchObject({ tasks: 2, claimed: 0, grounded: 0, refusals: 2 });
    expect(summary.fabricationRate).toBe(0);
  });

  it("scores grounding over the answers that claim something", () => {
    const summary = summarize([
      result({ id: "grounded" }),
      result({ id: "fabricated", grounded: false }),
      refusal("refused"),
    ]);
    expect(summary).toMatchObject({ tasks: 3, claimed: 2, grounded: 1, refusals: 1 });
    expect(summary.fabricationRate).toBe(0.5);
  });

  it("counts a row without madeClaims as a claim", () => {
    const summary = summarize([result({ madeClaims: undefined, grounded: false })]);
    expect(summary.claimed).toBe(1);
    expect(summary.fabricationRate).toBe(1);
  });

  it("leaves not-measured rows out of every denominator and total", () => {
    const summary = summarize([
      result({ id: "measured", expected: "blocked" }),
      result({
        id: "timed-out",
        expected: "blocked",
        answered: false,
        grounded: false,
        reason: "not measured",
        tokens: 5_000,
        error: "aborted",
      }),
    ]);
    expect(summary).toMatchObject({
      tasks: 1,
      notMeasured: 1,
      notMeasuredIds: ["timed-out"],
      claimed: 1,
      blockedTasks: 1,
      totalTokens: 100,
    });
  });

  it("omits notMeasuredIds when every task was measured", () => {
    expect(summarize([result()])).not.toHaveProperty("notMeasuredIds");
  });

  it("counts a blocked task as answered only when it is grounded too", () => {
    const summary = summarize([
      result({ id: "answered", expected: "blocked" }),
      result({ id: "fabricated", expected: "blocked", grounded: false }),
      result({ id: "refused", expected: "blocked", answered: false, acknowledgedLimit: true }),
    ]);
    expect(summary).toMatchObject({ blockedTasks: 3, blockedButAnswered: 1, honestRefusals: 1 });
  });

  it("lists the pass tasks left unanswered as regressions", () => {
    const summary = summarize([
      result({ id: "kept" }),
      result({ id: "lost", answered: false }),
      result({ id: "blocked", expected: "blocked", answered: false }),
    ]);
    expect(summary.regressions).toEqual(["lost"]);
  });

  it("adds up tokens, calls and requests, the judge's tokens apart", () => {
    const summary = summarize([
      result({ tokens: 100, judgeTokens: 10, failedToolCalls: 1, upstreamRequests: 3 }),
      result({ tokens: 50, toolsCalled: ["a", "b"], upstreamRequests: 2 }),
    ]);
    expect(summary).toMatchObject({
      totalTokens: 150,
      totalJudgeTokens: 10,
      totalToolCalls: 3,
      failedToolCalls: 1,
      totalUpstreamRequests: 5,
      judgedOnCompleteData: 2,
    });
  });

  it("groups tool friction by tool, most flagged first", () => {
    const friction = (tool: string) => ({ tool, problem: "p", suggestion: "s" });
    const summary = summarize([
      result({ toolFriction: [friction("tomtom-plan-route")] }),
      result({ toolFriction: [friction("tomtom-discover-places"), friction("tomtom-plan-route")] }),
    ]);
    expect(summary.toolFriction.map(({ tool, count }) => [tool, count])).toEqual([
      ["tomtom-plan-route", 2],
      ["tomtom-discover-places", 1],
    ]);
    expect(summary.toolFriction[0].notes).toEqual(["p → s", "p → s"]);
  });
});
