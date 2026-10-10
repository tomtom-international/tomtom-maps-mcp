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
 * registry corpus — mirroring how the toolkit's `scenarios/helpers.ts` splits
 * from `@testing/agent-tool-calling`.
 */

import { getDefaultToolPrompts, type ToolName } from "../../src/tools/tool-registry";
import { createToolScenarioRunner } from "../harness";

export const runToolScenario = createToolScenarioRunner();

// Materialize the registry's prompts once at import. `getDefaultToolPrompts()` is
// the same accessor the registry tests use, so a registry edit propagates to the
// scenarios on the next run — the prompt corpus has exactly one home.
const ALL_REGISTRY_PROMPTS = getDefaultToolPrompts();

/** The `examplePrompts` for one tool, straight from its registry row. */
export const getExamplePrompts = (toolName: ToolName): readonly string[] =>
  ALL_REGISTRY_PROMPTS[toolName] ?? [];

/**
 * Builds the standard pair of tests for a tool: one canonical prompt (always on)
 * plus the rest fanned out behind `SCENARIOS_FULL=1`.
 *
 * Every per-tool suite in the toolkit repeats this shape by hand; there are 15
 * tools here, so it is worth a helper. The canonical prompt is the FIRST
 * registry prompt, making the registry the single source of truth for what the
 * smoke test covers.
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
