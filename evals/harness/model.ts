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
 * Model resolution for the eval suites.
 *
 * The agent toolkit's `testing/agent-tool-calling/src/model.ts` is Azure-only,
 * because it lives in the same monorepo as Azure-backed demo apps. This repo has
 * no such convention, so the harness is provider-agnostic: it picks whichever
 * provider has credentials, and keeps Azure available so scenario numbers stay
 * comparable to the toolkit's.
 *
 * Contract preserved from the toolkit: an EMPTY model list when no credentials
 * are present, so suites `describe.skipIf(!MODEL)` rather than fail. The evals
 * are a no-op for contributors without keys, and for CI without secrets.
 *
 * Every scenario runs against EVERY configured model, so a prompt that passes on
 * one model can't silently regress on another.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { splitList } from "./reports";

/** Providers the harness can drive, in the precedence order of {@link resolveProvider}. */
const PROVIDER_IDS = ["azure", "anthropic", "openai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

const isProviderId = (value: string): value is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(value);

/**
 * Per-provider defaults: one model each, since every scenario runs once per model and a
 * second is one env var (`EVAL_MODEL_IDS`) away.
 *
 * `azure` is gpt-5.1: fewer tokens per task than gpt-4.1, and not the judge's model. The
 * toolkit's suite runs gpt-5.1 and gpt-4.1; `AZURE_MODEL_IDS=gpt-5.1,gpt-4.1` reproduces it.
 *
 * `openai` has no default on purpose — shipping a guessed id would 404 at run
 * time and read as a harness bug. It requires `EVAL_MODEL_IDS`.
 */
const DEFAULT_MODEL_IDS: Record<ProviderId, readonly string[]> = {
  azure: ["gpt-5.1"],
  anthropic: ["claude-opus-5"],
  openai: [],
};

const env = (name: string, environment: NodeJS.ProcessEnv = process.env): string | undefined =>
  environment[name] || undefined;

/** Which providers have usable credentials, in precedence order. */
const availableProviders = (environment: NodeJS.ProcessEnv): ProviderId[] => {
  const available: ProviderId[] = [];
  if (env("AZURE_RESOURCE_NAME", environment) && env("AZURE_API_KEY", environment)) {
    available.push("azure");
  }
  if (env("ANTHROPIC_API_KEY", environment)) available.push("anthropic");
  if (env("OPENAI_API_KEY", environment)) available.push("openai");
  return available;
};

/**
 * The provider in use. `EVAL_PROVIDER` forces one (and throws if its credentials
 * are missing, rather than silently running against a different provider and
 * producing numbers that don't mean what the reader thinks).
 */
export const resolveProvider = (
  variable = "EVAL_PROVIDER",
  environment: NodeJS.ProcessEnv = process.env
): ProviderId | null => {
  const available = availableProviders(environment);
  const requested = env(variable, environment);

  if (requested) {
    if (!isProviderId(requested)) {
      throw new Error(`${variable}="${requested}" is not one of: ${PROVIDER_IDS.join(", ")}.`);
    }
    if (!available.includes(requested)) {
      throw new Error(
        `${variable}="${requested}" but its credentials are missing. Needed: ` +
          `${requested === "azure" ? "AZURE_RESOURCE_NAME + AZURE_API_KEY" : requested === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}.`
      );
    }
    return requested;
  }

  return available[0] ?? null;
};

/**
 * Model ids to test against. `EVAL_MODEL_IDS` (comma-separated) wins for every
 * provider; `AZURE_MODEL_IDS` / `AZURE_DEPLOYMENT_ID` remain honoured on Azure so
 * a toolkit `.env` needs no edits.
 */
const resolveModelIds = (provider: ProviderId): string[] => {
  const ids = splitList(
    env("EVAL_MODEL_IDS") ??
      (provider === "azure" ? (env("AZURE_MODEL_IDS") ?? env("AZURE_DEPLOYMENT_ID")) : undefined) ??
      ""
  );
  if (ids.length) return ids;

  const defaults = DEFAULT_MODEL_IDS[provider];
  if (!defaults.length) {
    throw new Error(
      `No model ids for provider "${provider}". Set EVAL_MODEL_IDS to a comma-separated list.`
    );
  }
  return [...defaults];
};

/** Builds a `(modelId) => LanguageModel` factory for the resolved provider. */
const providerFactory = (provider: ProviderId): ((id: string) => LanguageModel) => {
  switch (provider) {
    case "azure": {
      const azure = createAzure({
        resourceName: env("AZURE_RESOURCE_NAME") as string,
        apiKey: env("AZURE_API_KEY") as string,
        apiVersion: env("AZURE_API_VERSION"),
      });
      // Azure addresses DEPLOYMENTS, not model names — `chat` is the deployment path.
      return (id) => azure.chat(id);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: env("ANTHROPIC_API_KEY") as string });
      return (id) => anthropic(id);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: env("OPENAI_API_KEY") as string });
      return (id) => openai(id);
    }
  }
};

/** A model under test, paired with its id for readable per-model reporting. */
export type ScenarioModel = { id: string; model: LanguageModel };

/** Builds one model per configured id, or an empty list without credentials. */
export const resolveModels = (): ScenarioModel[] => {
  const provider = resolveProvider();
  if (!provider) return [];
  const build = providerFactory(provider);
  return resolveModelIds(provider).map((id) => ({ id, model: build(id) }));
};

/** The provider actually in use (null without credentials). */
export const PROVIDER: ProviderId | null = resolveProvider();

/** Every model the evals run against, evaluated once at import. */
export const MODELS: ScenarioModel[] = resolveModels();

/** Truthy when at least one model is configured — used by `describe.skipIf(!MODEL)`. */
export const MODEL: LanguageModel | null = MODELS[0]?.model ?? null;

/**
 * Sampling temperature for the agent and the judge alike. The AI SDK drops it, with a
 * warning, for reasoning models (gpt-5.x, o-series), which sample at their own setting.
 */
export const EVAL_TEMPERATURE = 0;

/**
 * The judge's default per provider, used when `EVAL_JUDGE_MODEL_ID` is unset. `azure`'s is
 * the judge the published tables were graded by.
 */
const DEFAULT_JUDGE_MODEL_IDS: Record<ProviderId, string | undefined> = {
  azure: "gpt-4.1",
  anthropic: "claude-opus-5",
  openai: undefined,
};

/**
 * The judge's provider: `EVAL_JUDGE_PROVIDER`, else the first provider with credentials, Azure
 * first. That need not be the agent's: with Azure and Anthropic keys, `EVAL_PROVIDER=anthropic`
 * is still graded on Azure.
 */
export const JUDGE_PROVIDER: ProviderId | null = resolveProvider("EVAL_JUDGE_PROVIDER");

/**
 * The judge's model id for the capability benchmark, set apart from the models under test
 * (`EVAL_JUDGE_MODEL_ID`), the same split the toolkit's `agent-eval` package makes with its
 * `AGENT_EVAL_*_DEPLOYMENT_ID`s. `AZURE_JUDGE_DEPLOYMENT_ID` names a deployment, so only an
 * Azure judge reads it.
 */
export const resolveJudgeModelId = (
  provider: ProviderId | null,
  environment: NodeJS.ProcessEnv = process.env
): string | null => {
  if (!provider) return null;
  return (
    env("EVAL_JUDGE_MODEL_ID", environment) ??
    (provider === "azure" ? env("AZURE_JUDGE_DEPLOYMENT_ID", environment) : undefined) ??
    DEFAULT_JUDGE_MODEL_IDS[provider] ??
    null
  );
};

export const JUDGE_MODEL_ID: string | null = resolveJudgeModelId(JUDGE_PROVIDER);

/** The model behind {@link JUDGE_MODEL_ID}, or null without credentials. */
export const JUDGE_MODEL: LanguageModel | null =
  JUDGE_PROVIDER && JUDGE_MODEL_ID ? providerFactory(JUDGE_PROVIDER)(JUDGE_MODEL_ID) : null;

/** True when a live TomTom key is present, so capability tasks can hit real APIs. */
export const HAS_TOMTOM_KEY = Boolean(env("TOMTOM_API_KEY"));

/**
 * `EVAL_REQUIRE_MODEL=1`, set by the sweep scripts: a missing key fails the run instead of
 * skipping the suites, which would otherwise print green.
 */
export const REQUIRE_MODEL = env("EVAL_REQUIRE_MODEL") === "1";

if (REQUIRE_MODEL && !MODEL) {
  throw new Error(
    "EVAL_REQUIRE_MODEL=1 but no model is configured. Set AZURE_RESOURCE_NAME and " +
      "AZURE_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY."
  );
}
