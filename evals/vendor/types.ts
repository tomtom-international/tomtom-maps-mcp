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
 * PORTED from the maps-sdk-js agent-eval framework:
 *   agent-eval/src/core/types.ts
 *
 * The subset this repo uses, with the original names and shapes. Sharing the
 * vocabulary is most of what "aligned" means in practice: a `ToolCall` here has
 * to be a `ToolCall` there, or every future extraction becomes a translation.
 *
 * Notably `ToolCall.name` — this repo called it `toolName`, which is a gratuitous
 * difference that would have to be unpicked later.
 *
 * Omitted, because nothing here uses them yet: Persona, Task, UserAgentOutput,
 * the multi-turn Transcript/Turn stream and the Criterion/Judgment pair. They
 * belong to the toolkit's simulated-user runner; the MCP evals drive single
 * turns. Add them here when a suite needs them, keeping the original shape.
 */

import { z } from "zod";

export const toolCallSchema = z.object({
  name: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const tokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const totalTokens = (usage: TokenUsage): number => usage.inputTokens + usage.outputTokens;

export const agentUnderTestOutputSchema = z.object({
  outcome: z.string(),
  toolCalls: z.array(toolCallSchema),
  usage: tokenUsageSchema.optional(),
});
export type AgentUnderTestOutput = z.infer<typeof agentUnderTestOutputSchema>;
