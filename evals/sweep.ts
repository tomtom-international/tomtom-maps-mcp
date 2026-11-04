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
 * What `pnpm evals:run` runs: the checkouts to compare, the corpus, the repeats, the
 * models and the judge, read from its arguments and checked before anything is spent.
 * `scripts/run-evals.ts` runs the plan; `compare.ts` reports the sweep it leaves.
 */

import path from "node:path";
import { parseArgs } from "node:util";
import {
  availableProviders,
  resolveJudgeModelId,
  resolveModelIds,
  resolveProvider,
} from "./harness/model";
import { reportFiles, SWEEPS_DIR, splitList } from "./harness/reports";
import { type EvalSurface, REPO_ROOT, relativeRoot, resolveTarget } from "./harness/target";
import { PHASES } from "./phases";

export const SUITES = ["capability", "scenarios"] as const;
export type Suite = (typeof SUITES)[number];

/** One checkout under test: a column of the report. */
export interface SweepTarget {
  label: string;
  /** Absolute; the manifest stores it relative to this checkout. */
  root: string;
  surface: EvalSurface;
  /** An earlier sweep whose runs of this target are reused rather than run again. */
  reusedFrom?: string;
}

export interface SweepPlan {
  targets: SweepTarget[];
  repeats: number;
  corpus: "standard" | "demanding";
  suites: Suite[];
  /** Set on every run, over the caller's environment. */
  env: Record<string, string>;
  /** Said before the first run: a model that would judge itself. */
  warnings: string[];
}

/** `sweep.json`, beside a sweep's reports: what the report reads its columns from. */
export interface SweepManifest {
  startedAt: string;
  corpus: SweepPlan["corpus"];
  repeats: number;
  suites: Suite[];
  /** Each `root` and `reusedFrom` relative to this checkout. */
  targets: SweepTarget[];
  taskFilter?: string[];
  maxTokens?: number;
}

const USAGE = `pnpm evals:run [options]

  --target <label>=<root>[:legacy|consolidated]   a checkout to compare, repeatable;
                                                  default baseline=../tomtom-mcp-baseline, current=.
  --phases <ids|all>                              the targets of evals/phases.ts instead
  --corpus standard|demanding                     default standard
  --repeats <n>                                   capability runs per target, default 3
  --models <id,...>                               EVAL_MODEL_IDS for every run
  --judge <provider>[/<model>]                    a judge other than the default
  --suites capability,scenarios                   default both; scenarios run once per target
  --reuse <label>=<sweep>                         take that target's runs from an earlier sweep`;

const DEFAULT_TARGETS = ["baseline=../tomtom-mcp-baseline", "current=."];

const LABEL = /^[A-Za-z0-9][\w.-]*$/;

/** `label=root`, with an optional `:legacy` or `:consolidated` naming its vocabulary. */
function parseTarget(spec: string): Omit<SweepTarget, "reusedFrom"> {
  const separator = spec.indexOf("=");
  const label = spec.slice(0, separator);
  if (separator < 1 || !LABEL.test(label)) {
    throw new Error(
      `--target "${spec}" is not <label>=<root>, with a label of letters, digits, . - _.`
    );
  }
  const location = spec.slice(separator + 1);
  const suffix = location.match(/:(legacy|consolidated)$/);
  const root = suffix ? location.slice(0, -suffix[0].length) : location;
  const target = resolveTarget({
    EVAL_SERVER_ROOT: root,
    EVAL_LABEL: label,
    ...(suffix && { EVAL_SURFACE: suffix[1] }),
  });
  return { label, root: target.root, surface: target.surface };
}

function targetsOf(specs: readonly string[] | undefined, phases: string | undefined) {
  if (specs?.length && phases) throw new Error("Pass --target or --phases, not both.");
  if (!phases) return (specs?.length ? specs : DEFAULT_TARGETS).map(parseTarget);
  const wanted = phases === "all" ? PHASES.map(({ id }) => id) : splitList(phases);
  const unknown = wanted.filter((id) => !PHASES.some((phase) => phase.id === id));
  if (unknown.length) {
    throw new Error(`--phases names no phase in evals/phases.ts: ${unknown.join(", ")}`);
  }
  return PHASES.filter(({ id }) => wanted.includes(id)).map(({ id, root, surface }) =>
    parseTarget(`${id}=${root}:${surface}`)
  );
}

/** Resolves `--reuse label=sweep` against the targets, insisting the sweep holds their runs. */
function reusing(specs: readonly string[] | undefined, labels: readonly string[]) {
  const reused = new Map<string, string>();
  for (const spec of specs ?? []) {
    const [label, sweep] = spec.split("=");
    if (!label || !sweep || !labels.includes(label)) {
      throw new Error(`--reuse "${spec}" is not <label>=<sweep> for a label among the targets.`);
    }
    const dir = path.isAbsolute(sweep) ? sweep : path.resolve(SWEEPS_DIR, sweep);
    if (!reportFiles(dir, label).length) {
      throw new Error(`--reuse: ${dir} holds no report.${label}.<run>.json.`);
    }
    reused.set(label, dir);
  }
  return reused;
}

/** The judge as `--judge` names it, set as the variables `model.ts` reads. */
function judgeEnv(judge: string | undefined): Record<string, string> {
  if (!judge) return {};
  const [provider, ...model] = judge.split("/");
  return {
    EVAL_JUDGE_PROVIDER: provider,
    ...(model.length && { EVAL_JUDGE_MODEL_ID: model.join("/") }),
  };
}

/** Warns when the model under test is also the judge, naming the providers that could judge. */
function selfJudgingWarnings(environment: NodeJS.ProcessEnv): string[] {
  const provider = resolveProvider("EVAL_PROVIDER", environment);
  const judgeProvider = resolveProvider("EVAL_JUDGE_PROVIDER", environment);
  if (!provider || !judgeProvider) return [];
  const [model] = resolveModelIds(provider, environment);
  if (model !== resolveJudgeModelId(judgeProvider, environment)) return [];
  const others = availableProviders(environment).filter((other) => other !== judgeProvider);
  return [
    `${model} would judge its own capability runs` +
      (others.length
        ? `; --judge ${others[0]} grades them on another provider.`
        : "; no other provider has credentials to judge it."),
  ];
}

/** Reads the command's arguments into a plan, or throws on one it cannot run. */
export function planSweep(args: readonly string[], environment = process.env): SweepPlan {
  const { values } = parseArgs({
    args: [...args],
    options: {
      target: { type: "string", multiple: true },
      phases: { type: "string" },
      corpus: { type: "string", default: "standard" },
      repeats: { type: "string", default: environment.EVAL_REPEAT ?? "3" },
      models: { type: "string" },
      judge: { type: "string" },
      suites: { type: "string", default: SUITES.join(",") },
      reuse: { type: "string", multiple: true },
      help: { type: "boolean" },
    },
  });
  if (values.help) throw new Error(USAGE);

  const targets = targetsOf(values.target, values.phases);
  const labels = targets.map(({ label }) => label);
  const repeatedLabel = labels.find((label, index) => labels.indexOf(label) !== index);
  if (repeatedLabel) throw new Error(`Two targets are labelled "${repeatedLabel}".`);

  const { corpus } = values;
  if (corpus !== "standard" && corpus !== "demanding") {
    throw new Error(`--corpus "${corpus}" is not standard or demanding.`);
  }
  const repeats = Number(values.repeats);
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error(`--repeats "${values.repeats}" is not a whole number of runs.`);
  }
  const suites = splitList(values.suites);
  const unknownSuite = suites.find((suite) => !SUITES.some((known) => known === suite));
  if (unknownSuite || !suites.length) {
    throw new Error(`--suites "${values.suites}" is not a list of ${SUITES.join(", ")}.`);
  }

  const reused = reusing(values.reuse, labels);
  const env = {
    EVAL_REQUIRE_MODEL: "1",
    EVAL_TRANSPORT: "stdio",
    EVAL_CORPUS: corpus,
    ...(values.models && { EVAL_MODEL_IDS: values.models }),
    ...judgeEnv(values.judge),
  };
  // Throws on a requested judge provider without credentials, before any run.
  resolveProvider("EVAL_JUDGE_PROVIDER", { ...environment, ...env });

  return {
    targets: targets.map((target) => ({
      ...target,
      ...(reused.has(target.label) && { reusedFrom: reused.get(target.label) }),
    })),
    repeats,
    corpus,
    suites: SUITES.filter((suite) => suites.includes(suite)),
    env,
    warnings: selfJudgingWarnings({ ...environment, ...env }),
  };
}

/** The manifest a plan leaves beside its reports. */
export function manifestOf(
  plan: SweepPlan,
  startedAt: Date,
  environment = process.env
): SweepManifest {
  const taskFilter = splitList(environment.EVAL_TASK_IDS ?? "");
  return {
    startedAt: startedAt.toISOString(),
    corpus: plan.corpus,
    repeats: plan.repeats,
    suites: plan.suites,
    targets: plan.targets.map(({ reusedFrom, ...target }) => ({
      ...target,
      root: relativeRoot({ ...target, isBaseline: true }),
      ...(reusedFrom && { reusedFrom: path.relative(REPO_ROOT, reusedFrom) }),
    })),
    ...(taskFilter.length && { taskFilter }),
    ...(environment.EVAL_MAX_TOKENS && { maxTokens: Number(environment.EVAL_MAX_TOKENS) }),
  };
}
