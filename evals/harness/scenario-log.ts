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
import { artefactPath, REPO_ROOT, TARGET } from "./target";

export const SCENARIO_LOG_DIR = join(REPO_ROOT, "evals", "scenarios");

/** `runs.jsonl`, or `runs.<label>.jsonl` when a label names the run. */
export const SCENARIO_LOG_PATH = artefactPath(SCENARIO_LOG_DIR, "runs", "jsonl");

/** One scenario, run against one model. */
export interface ScenarioRecord {
  /** Which run produced it — empty label means this working tree. */
  label: string;
  serverRoot: string;
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

/**
 * The FINAL attempt of each scenario, per model.
 *
 * Every scenario `describe` sets `retry: 2`, because a model-in-the-loop test is
 * genuinely non-deterministic. The log records each attempt — useful, since a
 * scenario that needed two goes is a flakiness signal worth keeping — but the
 * outcome vitest reports is the LAST one, and so is the outcome that should be
 * counted.
 *
 * Counting attempts instead would make the denominator depend on how often a
 * surface failed, which is the very thing being measured: the worse surface
 * retries more, gains records, and its accuracy is then computed over a larger
 * denominator than the better one. The first run of this comparison scored the
 * baseline over 58 attempts and the current over 50 for the same 14 prompts.
 *
 * Append order is chronological, so the last record for a key wins.
 */
export const finalAttempts = (records: readonly ScenarioRecord[]): ScenarioRecord[] => {
  const byKey = new Map<string, ScenarioRecord>();
  for (const record of records) {
    byKey.set(`${record.expectedTool}\u0000${record.prompt}\u0000${record.modelId}`, record);
  }
  return [...byKey.values()];
};

/** Rolls a log into the numbers worth comparing between surfaces. */
export const summarizeScenarios = (allRecords: readonly ScenarioRecord[]) => {
  const records = finalAttempts(allRecords);
  const ran = records.filter((r) => !r.unrepresentable?.length);
  const passed = ran.filter((r) => r.passed);
  const hops = ran.map((r) => r.hops).sort((a, b) => a - b);

  // A scenario that failed and then passed on retry. High counts mean the
  // prompt is borderline for the model, not that the tool surface is wrong.
  const flaky = new Set(
    ran.filter((r) => r.passed).map((r) => `${r.expectedTool}\u0000${r.prompt}\u0000${r.modelId}`)
  );
  const retriedToPass = allRecords.filter(
    (r) => !r.passed && flaky.has(`${r.expectedTool}\u0000${r.prompt}\u0000${r.modelId}`)
  ).length;

  return {
    label: records[0]?.label ?? TARGET.label,
    scenarios: records.length,
    /** Total recorded attempts, including retries. `scenarios` counts finals. */
    attempts: allRecords.length,
    /** Failed attempts on scenarios that ultimately passed. */
    retriedToPass,
    /** Scenarios the target surface could express — the accuracy denominator. */
    evaluated: ran.length,
    skippedUnrepresentable: records.length - ran.length,
    passed: passed.length,
    accuracy: ran.length ? passed.length / ran.length : 0,
    /** Hop count is the consolidation's headline claim: fewer calls per answer. */
    totalHops: hops.reduce((sum, n) => sum + n, 0),
    meanHops: hops.length ? hops.reduce((sum, n) => sum + n, 0) / hops.length : 0,
    medianHops: hops.length ? hops[Math.floor(hops.length / 2)] : 0,
    totalTokens: ran.reduce((sum, r) => sum + r.tokens, 0),
    failures: ran.filter((r) => !r.passed).map((r) => ({ prompt: r.prompt, problem: r.problem })),
  };
};
