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
 * The agent under test: a tool-loop agent over the MCP tool surface.
 *
 * The agent toolkit tests `createMapAgent`, which IS an agent. The MCP server is
 * not — it is a tool provider — so the eval has to supply the loop. This builds
 * one from the registry, which means the model sees exactly the descriptions,
 * schemas, and tool names a real MCP client would.
 *
 * Tools come from `TOOL_REGISTRY` in-process rather than over a stdio/HTTP
 * transport. That is deliberate:
 *   • the surface is identical (same names, descriptions, Zod schemas — the
 *     registry is what `register.ts` feeds to `registerAppTool`);
 *   • `execute` can be swapped for a canned mock, so tool-SELECTION tests never
 *     spend API quota;
 *   • no subprocess to babysit per scenario.
 * `e2e/tools.spec.ts` covers the real transport.
 */

import { generateText, type LanguageModel, type ModelMessage, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { ToolEntry, ToolResponse } from "../../src/tools/shared/tool-entry";
import { DEFAULT_TOOLS } from "../../src/tools/tool-registry";
import type { AgentUnderTestOutput, TokenUsage, ToolCall } from "../vendor/types";
import { SPECIFIC_MOCKS } from "./mocks";
import type { StdioSession } from "./stdio-session";

/** Max assistant steps per turn — enough for a categories→search→analyse chain. */
const MAX_STEPS = 8;

/**
 * System prompt for the agent under test.
 *
 * Deliberately minimal: it says how to behave, never which tool to use. Tool
 * choice must come from the registry's own descriptions, so a selection failure
 * points at a description, not at a prompt that spoon-fed the answer.
 *
 * The "never fabricate" rule is load-bearing for the capability benchmark: it is
 * what lets a fabrication count mean something. Without it, a model inventing an
 * answer could be excused as unprompted behaviour.
 */
export const EVAL_SYSTEM_PROMPT = [
  "You are a geospatial assistant with access to TomTom map tools.",
  "Act, don't narrate: when a tool can answer the question, call it rather than describing what you would do.",
  "Call the tools you need, including several in sequence when one tool's output feeds the next.",
  "Never fabricate data. If the tool results do not contain what the user asked for, say so plainly and state what is missing.",
  "If a tool result says it was truncated or capped, treat the missing rows as unknown — do not extrapolate from the rows you can see.",
].join(" ");

/**
 * How the agent's tools are wired.
 *
 * - `mocked` — in-process from the registry, canned results. Selection tests:
 *   real descriptions and schemas, zero API spend.
 * - `live`   — in-process from the registry, real handlers. Fast capability runs.
 * - `stdio`  — a real `bin/tomtom-mcp.js` subprocess driven over the MCP
 *   transport, real handlers. The faithful path; requires a `session` and a
 *   built `dist/`. See `stdio-session.ts` for what it covers that the
 *   in-process modes cannot.
 */
export type ToolMode = "mocked" | "live" | "stdio";

/**
 * One turn of the agent under test.
 *
 * `AgentUnderTestOutput` — `outcome`, `toolCalls`, `usage` — comes from the
 * toolkit's `agent-eval` core types, so a run produced here is the same shape a
 * run produced there is. `messages` is the local addition: scenarios stage prior
 * turns and need the history back.
 */
export interface AgentRun extends AgentUnderTestOutput {
  usage: TokenUsage;
  messages: ModelMessage[];
}

/**
 * MCP tool responses are `{ content: [{ type: "text", text }] }`. Parse the text
 * back to JSON when it is JSON so judges and assertions see structure rather
 * than a string blob.
 */
const unwrap = (response: ToolResponse): unknown => {
  const text = response.content.map((part) => part.text).join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Builds AI SDK tools from the registry rows.
 *
 * `mode: "mocked"` swaps each `execute` for a canned result — the model still
 * sees the real description and schema, so selection is tested faithfully while
 * nothing hits the network. `mode: "live"` runs the real handlers, which is what
 * the capability benchmark needs.
 */
export const buildTools = (mode: "mocked" | "live", calls: ToolCall[]) =>
  Object.fromEntries(
    DEFAULT_TOOLS.map((entry: ToolEntry) => [
      entry.name,
      tool({
        description: entry.description,
        inputSchema: z.object(entry.inputSchema),
        execute: async (input: unknown) => {
          const output =
            mode === "live"
              ? unwrap(await (entry.handler as (p: unknown) => Promise<ToolResponse>)(input))
              : (SPECIFIC_MOCKS[entry.name] ?? { success: true });
          calls.push({ name: entry.name, input, output });
          return output;
        },
      }),
    ])
  );

/**
 * Runs one turn of the agent under test and returns everything the assertions
 * and the judge need: the final text, every tool call with its result, the raw
 * message list, and token usage.
 */
export async function runAgent(options: {
  model: LanguageModel;
  messages: ModelMessage[];
  mode?: ToolMode;
  system?: string;
  maxSteps?: number;
  /** Required when `mode` is `"stdio"`; ignored otherwise. */
  session?: StdioSession;
}): Promise<AgentRun> {
  const { model, messages, mode = "mocked", system = EVAL_SYSTEM_PROMPT, session } = options;
  const calls: ToolCall[] = [];

  if (mode === "stdio" && !session) {
    throw new Error(
      'mode "stdio" needs a session — open one with `openStdioSession()` and pass it in.'
    );
  }
  const tools = mode === "stdio" ? session!.buildTools(calls) : buildTools(mode, calls);

  const result = await generateText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(options.maxSteps ?? MAX_STEPS),
  });

  return {
    outcome: result.text,
    toolCalls: calls,
    messages: result.response.messages as ModelMessage[],
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
}
