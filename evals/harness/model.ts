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

/** Providers the harness can drive. */
export type ProviderId = "azure" | "anthropic" | "openai";

/**
 * Per-provider defaults.
 *
 * `azure` mirrors the toolkit's default pair verbatim, so a dev with the
 * toolkit's `.env` gets directly comparable numbers.
 *
 * `anthropic` leads with Opus 5 alone rather than pairing it with a cheaper
 * model: adding a second model is one env var (`EVAL_MODEL_IDS`), and picking a
 * weaker default on someone's behalf to save money is their call, not ours.
 *
 * `openai` has no default on purpose — shipping a guessed id would 404 at run
 * time and read as a harness bug. It requires `EVAL_MODEL_IDS`.
 */
const DEFAULT_MODEL_IDS: Record<ProviderId, readonly string[]> = {
  azure: ["gpt-5.1", "gpt-4.1"],
  anthropic: ["claude-opus-5"],
  openai: [],
};

const env = (name: string): string | undefined => process.env[name] || undefined;

/** Which providers have usable credentials, in precedence order. */
const availableProviders = (): ProviderId[] => {
  const available: ProviderId[] = [];
  if (env("AZURE_RESOURCE_NAME") && env("AZURE_API_KEY")) available.push("azure");
  if (env("ANTHROPIC_API_KEY")) available.push("anthropic");
  if (env("OPENAI_API_KEY")) available.push("openai");
  return available;
};

/**
 * The provider in use. `EVAL_PROVIDER` forces one (and throws if its credentials
 * are missing, rather than silently running against a different provider and
 * producing numbers that don't mean what the reader thinks).
 */
export const resolveProvider = (): ProviderId | null => {
  const available = availableProviders();
  const requested = env("EVAL_PROVIDER") as ProviderId | undefined;

  if (requested) {
    if (!["azure", "anthropic", "openai"].includes(requested)) {
      throw new Error(`EVAL_PROVIDER="${requested}" is not one of: azure, anthropic, openai.`);
    }
    if (!available.includes(requested)) {
      throw new Error(
        `EVAL_PROVIDER="${requested}" but its credentials are missing. Needed: ` +
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
  const raw =
    env("EVAL_MODEL_IDS") ??
    (provider === "azure" ? (env("AZURE_MODEL_IDS") ?? env("AZURE_DEPLOYMENT_ID")) : undefined) ??
    "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
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
 * The judge model for the capability benchmark. Overridable independently
 * (`EVAL_JUDGE_MODEL_ID`) so the judge can be pinned to a strong model while the
 * agent under test varies — the same split the toolkit's `agent-eval` package
 * makes with its `AGENT_EVAL_*_DEPLOYMENT_ID`s. Defaults to the first model,
 * which is the strongest in every default list above.
 */
export const JUDGE_MODEL: LanguageModel | null = (() => {
  const provider = resolveProvider();
  if (!provider) return null;
  const id = env("EVAL_JUDGE_MODEL_ID") ?? env("AZURE_JUDGE_DEPLOYMENT_ID");
  return id ? providerFactory(provider)(id) : (MODELS[0]?.model ?? null);
})();

/** True when a live TomTom key is present, so capability tasks can hit real APIs. */
export const HAS_TOMTOM_KEY = Boolean(env("TOMTOM_API_KEY"));

/** One-line description of what the evals are running against, for reports. */
export const describeSetup = (): string =>
  PROVIDER
    ? `${PROVIDER}: ${MODELS.map((m) => m.id).join(", ")}`
    : "no model credentials configured";
