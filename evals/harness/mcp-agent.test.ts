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

import { MockLanguageModelV2 } from "ai/test";
import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "../../src/createServer";
import { EVAL_SYSTEM_PROMPT, runAgent } from "./mcp-agent";

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
});

/** A model that calls one tool, then answers: two steps, each with its own usage. */
const twoStepModel = () => {
  const steps = [
    {
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-1",
          toolName: "tomtom-locate-place",
          input: JSON.stringify({ query: "Dam Square", queryAs: "place" }),
        },
      ],
      finishReason: "tool-calls" as const,
      usage: usage(100, 10),
      warnings: [],
    },
    {
      content: [{ type: "text" as const, text: "Dam Square is in Amsterdam." }],
      finishReason: "stop" as const,
      usage: usage(250, 20),
      warnings: [],
    },
  ];
  let step = 0;
  return new MockLanguageModelV2({ doGenerate: async () => steps[step++] });
};

describe("runAgent", () => {
  it("counts the tokens of every step of the tool loop, not only the last", async () => {
    const run = await runAgent({
      model: twoStepModel(),
      messages: [{ role: "user", content: "Where is Dam Square?" }],
    });

    expect(run.toolCalls.map((call) => call.name)).toEqual(["tomtom-locate-place"]);
    expect(run.usage).toEqual({ inputTokens: 350, outputTokens: 30 });
  });

  it("pins the temperature and passes the server's instructions after the system prompt", async () => {
    const model = twoStepModel();
    await runAgent({ model, messages: [{ role: "user", content: "Where is Dam Square?" }] });

    const [firstCall] = model.doGenerateCalls;
    expect(firstCall.temperature).toBe(0);
    expect(firstCall.prompt[0]).toEqual({
      role: "system",
      content: `${EVAL_SYSTEM_PROMPT}\n\n${SERVER_INSTRUCTIONS}`,
    });
  });
});
