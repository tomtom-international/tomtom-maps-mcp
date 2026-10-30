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
 * Prompts that must NOT reach a tool. Mirrors the toolkit's
 * `scenarios/guardrails.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../../src/tools/tool-registry";
import {
  assertTransportForTarget,
  expectNoneOfToolsCalled,
  getSharedSession,
  MODEL,
  MODELS,
  runAgent,
} from "../harness";

const OFF_TOPIC = [
  "What's the capital of France?",
  "Write me a haiku about the sea.",
  "Explain how a diesel engine works.",
];

describe.skipIf(!MODEL)("guardrails", { timeout: 180_000, retry: 2 }, () => {
  it.each(OFF_TOPIC)("answers %s without calling a map tool", async (prompt) => {
    assertTransportForTarget(process.env.EVAL_TRANSPORT);
    // Over the transport, the target's own tools, which another checkout names differently.
    const session = process.env.EVAL_TRANSPORT === "stdio" ? await getSharedSession() : undefined;
    const toolNames = session?.toolNames ?? TOOL_NAMES;
    for (const { id, model } of MODELS) {
      const run = await runAgent({
        model,
        mode: session ? "stdio" : "mocked",
        session,
        messages: [{ role: "user", content: prompt }],
      });
      const problem = expectNoneOfToolsCalled(run, ...toolNames);
      expect(problem, `[${id}] ${problem}`).toBeUndefined();
      // …and it must still answer, rather than going silent.
      expect(run.outcome.trim().length, `[${id}] agent said nothing`).toBeGreaterThan(0);
    }
  });
});
