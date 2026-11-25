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
 * The scenario suite's artefact.
 *
 * The capability suite already writes a report; the selection suite only ever
 * asserted, which is enough to gate CI and useless for a comparison — "12 tests
 * passed" says nothing about whether the old surface needed three hops where the
 * new one needs one. This records the same facts the assertions consumed, so the
 * two surfaces can be diffed on selection accuracy AND on hop count.
 *
 * JSON Lines, appended: vitest runs test files in separate workers, and an
 * append-only file is the only shared sink that needs no coordination. Each line
 * is one scenario against one model.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { median } from "./reports";
import { artefactPath, type EvalSurface, REPO_ROOT, TARGET } from "./target";

const SCENARIO_LOG_DIR = join(REPO_ROOT, "evals", "scenarios");

/** `runs.jsonl`, or `runs.<label>.jsonl` when a label names the run. */
export const SCENARIO_LOG_PATH = artefactPath(SCENARIO_LOG_DIR, "runs", "jsonl");

/** One scenario, run against one model. */
export interface ScenarioRecord {
  /** Which run produced it — empty label means this working tree. */
  label: string;
  serverRoot: string;
  /**
   * The vitest test's full name, unique where prompts are not: several tests send the same
   * prompt with different checks. Absent on logs written before it was recorded.
   */
  testName?: string;
  /** `legacy` scores with the order and argument checks off; absent on older logs. */
  surface?: EvalSurface;
  prompt: string;
  /** The expectation as WRITTEN, on the current tool surface. */
  expectedTool: string;
  /** The expectation as EVALUATED — translated for a baseline, identical otherwise. */
  accepted: string[];
  forbidden: string[];
  /**
   * Set when the expectation names a tool the target surface never had. The
   * scenario did not run; excluded from accuracy on both sides so the
   * comparison stays like-for-like.
   */
  unrepresentable?: string[];
  /** Prohibitions dropped because the near-miss they policed does not exist here. */
  droppedForbidden?: string[];
  modelId: string;
  /** Every tool the agent called, in order. Its length is the hop count. */
  toolsCalled: string[];
  hops: number;
  /** Calls the server answered with `isError`, counted in `hops` too. */
  failedCalls?: number;
  passed: boolean;
  problem?: string;
  tokens: number;
}

/** Appends one record. Fire-and-forget: a logging failure must not fail a run. */
export const recordScenario = (record: ScenarioRecord): void => {
  try {
    appendFileSync(SCENARIO_LOG_PATH, `${JSON.stringify(record)}\n`);
  } catch {
    // A missing artefact is a worse outcome than a lost line, but neither is
    // worth failing a paid model run over.
  }
};

/** Reads a scenario log back. Missing file → no records, which the caller reports. */
export const readScenarioLog = (path: string): ScenarioRecord[] => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ScenarioRecord);
};

/** Identifies one scenario against one model, across its retried attempts. */
export const scenarioKey = (record: ScenarioRecord): string =>
  `${record.testName ?? record.expectedTool}\u0000${record.prompt}\u0000${record.modelId}`;

/** One record per scenario and model: the first or the last attempt, by append order. */
const attemptsBy = (
  records: readonly ScenarioRecord[],
  which: "first" | "final"
): ScenarioRecord[] => {
  const byKey = new Map<string, ScenarioRecord>();
  for (const record of records) {
    const key = scenarioKey(record);
    if (which === "final" || !byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
};

/**
 * The FIRST attempt of each scenario, per model: what accuracy is scored on.
 *
 * Every scenario `describe` sets `retry: 2`, so a later attempt exists only where an
 * earlier one failed. Scoring the last would report "passed within three tries" and
 * hide a prompt the model gets wrong some of the time; scoring every attempt would
 * hand the surface that fails more a bigger denominator.
 */
export const firstAttempts = (records: readonly ScenarioRecord[]): ScenarioRecord[] =>
  attemptsBy(records, "first");

/** The FINAL attempt of each scenario, per model: the outcome vitest reports. */
const finalAttempts = (records: readonly ScenarioRecord[]): ScenarioRecord[] =>
  attemptsBy(records, "final");

/**
 * What a run's accuracy measures: `legacy` runs without the order and argument checks, so
 * its number says only that the agent reached a tool of the right family.
 */
const accuracyMetric = (records: readonly ScenarioRecord[]) =>
  records.some((record) => record.surface === "legacy") ? "tool family match" : "accuracy";

/** Rolls a log into the numbers worth comparing between surfaces, over first attempts. */
export const summarizeScenarios = (allRecords: readonly ScenarioRecord[]) => {
  const records = firstAttempts(allRecords);
  const ran = records.filter((record) => !record.unrepresentable?.length);
  const passed = ran.filter((record) => record.passed);
  const hops = ran.map((record) => record.hops);

  // Failed first, passed on a retry. High counts mean the prompt is borderline for
  // the model, not that the tool surface is wrong.
  const passedFinally = new Set(
    finalAttempts(allRecords)
      .filter((record) => record.passed)
      .map(scenarioKey)
  );
  const flaky = ran.filter(
    (record) => !record.passed && passedFinally.has(scenarioKey(record))
  ).length;

  return {
    label: records[0]?.label ?? TARGET.label,
    metric: accuracyMetric(records),
    scenarios: records.length,
    /** Total recorded attempts, including retries. `scenarios` counts first attempts. */
    attempts: allRecords.length,
    /** Scenarios that failed their first attempt and passed a retry. */
    flaky,
    /** Scenarios the target surface could express — the accuracy denominator. */
    evaluated: ran.length,
    skippedUnrepresentable: records.length - ran.length,
    passed: passed.length,
    accuracy: ran.length ? passed.length / ran.length : 0,
    /** Hop count is the consolidation's headline claim: fewer calls per answer. */
    totalHops: hops.reduce((sum, n) => sum + n, 0),
    meanHops: hops.length ? hops.reduce((sum, n) => sum + n, 0) / hops.length : 0,
    medianHops: hops.length ? median(hops) : 0,
    failedCalls: ran.reduce((sum, record) => sum + (record.failedCalls ?? 0), 0),
    totalTokens: ran.reduce((sum, record) => sum + record.tokens, 0),
    failures: ran
      .filter((record) => !record.passed)
      .map(({ prompt, problem }) => ({ prompt, problem })),
  };
};
