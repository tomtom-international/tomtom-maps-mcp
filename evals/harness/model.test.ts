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
import { resolveJudgeModelId, resolveProvider } from "./model";

const AZURE = { AZURE_RESOURCE_NAME: "resource", AZURE_API_KEY: "key" };
const ANTHROPIC = { ANTHROPIC_API_KEY: "key" };

describe("resolveProvider", () => {
  it("takes the first provider with credentials, Azure first", () => {
    expect(resolveProvider("EVAL_PROVIDER", { ...ANTHROPIC, ...AZURE })).toBe("azure");
    expect(resolveProvider("EVAL_PROVIDER", ANTHROPIC)).toBe("anthropic");
    expect(resolveProvider("EVAL_PROVIDER", {})).toBeNull();
  });

  it("grades on the first provider with credentials, not the agent's, unless told", () => {
    const environment = { ...AZURE, ...ANTHROPIC, EVAL_PROVIDER: "anthropic" };
    expect(resolveProvider("EVAL_PROVIDER", environment)).toBe("anthropic");
    expect(resolveProvider("EVAL_JUDGE_PROVIDER", environment)).toBe("azure");
    expect(
      resolveProvider("EVAL_JUDGE_PROVIDER", { ...environment, EVAL_JUDGE_PROVIDER: "anthropic" })
    ).toBe("anthropic");
  });

  it("refuses a requested provider without credentials, or one it does not know", () => {
    expect(() =>
      resolveProvider("EVAL_PROVIDER", { ...AZURE, EVAL_PROVIDER: "anthropic" })
    ).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => resolveProvider("EVAL_PROVIDER", { EVAL_PROVIDER: "bedrock" })).toThrow(
      /not one of/
    );
  });
});

describe("resolveJudgeModelId", () => {
  it("defaults per provider, gpt-4.1 on Azure and none on OpenAI", () => {
    expect(resolveJudgeModelId("azure", {})).toBe("gpt-4.1");
    expect(resolveJudgeModelId("anthropic", {})).toBe("claude-opus-5");
    expect(resolveJudgeModelId("openai", {})).toBeNull();
    expect(resolveJudgeModelId(null, { EVAL_JUDGE_MODEL_ID: "gpt-4.1" })).toBeNull();
  });

  it("reads AZURE_JUDGE_DEPLOYMENT_ID for an Azure judge only", () => {
    const environment = { AZURE_JUDGE_DEPLOYMENT_ID: "judge-deployment" };
    expect(resolveJudgeModelId("azure", environment)).toBe("judge-deployment");
    expect(resolveJudgeModelId("anthropic", environment)).toBe("claude-opus-5");
  });

  it("takes EVAL_JUDGE_MODEL_ID over every default", () => {
    const environment = { EVAL_JUDGE_MODEL_ID: "gpt-5.1", AZURE_JUDGE_DEPLOYMENT_ID: "judge" };
    expect(resolveJudgeModelId("azure", environment)).toBe("gpt-5.1");
  });
});
