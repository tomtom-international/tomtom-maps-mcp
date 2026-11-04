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
 * MCP-specific scenario plumbing. The generic pieces (model resolution, the
 * runner, assertions, seed staging) live in `../harness`; this file owns only the
 * registry corpus and the rows a suite is written as — mirroring how the toolkit's
 * `scenarios/helpers.ts` splits from `@testing/agent-tool-calling`.
 */

import { describe, expect, it } from "vitest";
import { getDefaultToolPrompts, type ToolName } from "../../src/tools/tool-registry";
import { MODEL } from "../harness/model";
import {
  createToolScenarioRunner,
  FULL_SCENARIOS,
  type ToolInputPredicate,
  type ToolInputsPredicate,
  type ToolScenarioOptions,
} from "../harness/scenario";

export const runToolScenario = createToolScenarioRunner();

// Materialize the registry's prompts once at import. `getDefaultToolPrompts()` is
// the same accessor the registry tests use, so a registry edit propagates to the
// scenarios on the next run — the prompt corpus has exactly one home.
const ALL_REGISTRY_PROMPTS = getDefaultToolPrompts();

/** The `examplePrompts` for one tool, straight from its registry row. */
export const getExamplePrompts = (toolName: ToolName): readonly string[] =>
  ALL_REGISTRY_PROMPTS[toolName] ?? [];

/**
 * A tool's canonical prompt (its FIRST registry prompt, always on) and the rest, which fan
 * out behind `SCENARIOS_FULL=1`, making the registry the source of what the smoke set covers.
 */
export const canonicalAndRest = (toolName: ToolName): { canonical: string; rest: string[] } => {
  const [canonical, ...rest] = getExamplePrompts(toolName);
  if (!canonical) {
    throw new Error(
      `${toolName} has no examplePrompts — add at least one to its tool-registry row.`
    );
  }
  return { canonical, rest };
};

/**
 * One tool-selection question: a prompt, the tool it should reach and what that tool's
 * arguments must hold. Adding a question to a suite is adding a row.
 */
export type ScenarioRow = Omit<ToolScenarioOptions, "expectedArgs" | "expectedArgsTogether"> & {
  /** The test's name, the prompt when absent; the scenario log keys on it with the prompt. */
  name?: string;
  /** Checks the expected tool's arguments: passes when any call to it matches. */
  expectedArgs?: ToolInputPredicate;
  /** Checks all the expected tool's calls together, for what one call or several may cover. */
  expectedArgsTogether?: ToolInputsPredicate;
};

const SUITE_OPTIONS = { timeout: 180_000, retry: 2 };

async function expectRow({ expectedArgs, expectedArgsTogether, ...options }: ScenarioRow) {
  const outcome = await runToolScenario({
    ...options,
    ...(expectedArgs && { expectedArgs: { [options.expectedTool]: expectedArgs } }),
    ...(expectedArgsTogether && {
      expectedArgsTogether: { [options.expectedTool]: expectedArgsTogether },
    }),
  });
  expect(outcome.success, outcome.failureReason).toBe(true);
}

/** A suite with one test per row, run against every configured model. */
export function describeScenarios(title: string, rows: readonly ScenarioRow[]): void {
  const names = rows.map(({ name, prompt }) => name ?? prompt);
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  if (repeated.length) {
    throw new Error(
      `"${title}" names two tests alike, which its scenario log would merge: ${repeated.join(", ")}`
    );
  }
  describe.skipIf(!MODEL)(title, SUITE_OPTIONS, () => {
    for (const row of rows) {
      // `$prompt` is vitest's quoted, shortened name, the key earlier scenario logs carry.
      if (row.name) it(row.name, () => expectRow(row));
      else it.each([row])("$prompt", expectRow);
    }
  });
}

/** A tool whose registry prompts are its questions, with what every one of them shares. */
export type RegistryRow = Pick<
  ToolScenarioOptions,
  "acceptedAlternatives" | "forbiddenTools" | "priorTurns"
> & { tool: ToolName };

/** A suite with each tool's canonical prompt, and its other registry prompts under `SCENARIOS_FULL=1`. */
export function describeRegistryScenarios(title: string, rows: readonly RegistryRow[]): void {
  describe.skipIf(!MODEL)(title, SUITE_OPTIONS, () => {
    for (const { tool, ...shared } of rows) {
      describe(tool, () => {
        const { canonical, rest } = canonicalAndRest(tool);
        it(`classifies the canonical prompt: ${canonical}`, () =>
          expectRow({ expectedTool: tool, prompt: canonical, ...shared }));
        it.skipIf(!FULL_SCENARIOS).each(rest)("handles registry prompt: %s", (prompt) =>
          expectRow({ expectedTool: tool, prompt, ...shared })
        );
      });
    }
  });
}
