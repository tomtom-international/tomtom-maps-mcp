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
 * Which checkout's MCP server is under test.
 *
 * The suites normally evaluate THIS working tree. `EVAL_SERVER_ROOT` points them
 * at another checkout instead — a git worktree parked on a pre-refactor commit —
 * so the same tasks, the same judge and the same model can score the OLD tool
 * surface and produce a comparable report. That is the whole mechanism behind
 * the before/after: nothing about the corpus changes, only which server answers.
 *
 * It works because a baseline run goes over the real MCP transport. The
 * in-process modes import `src/tools/tool-registry.ts` from this tree, which the
 * old tree does not have; the wire, by contrast, is surface-agnostic — a tool
 * list, a JSON Schema each, and a text envelope back. So `EVAL_SERVER_ROOT`
 * implies `EVAL_TRANSPORT=stdio`, and the suites refuse rather than silently
 * scoring this tree's tools while the report claims otherwise.
 */

import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

/** This checkout. `harness/` → `evals/` → repo root. */
export const REPO_ROOT = resolve(join(import.meta.dirname, "..", ".."));

/**
 * Which tool vocabulary the target advertises.
 *
 * `legacy` is the pre-consolidation surface (15 tools: `tomtom-geocode`,
 * `tomtom-fuzzy-search`, …). `consolidated` is every surface from the tool
 * collapse onwards, whose names the scenarios are written against.
 *
 * This used to be inferred from `isBaseline` — "not this working tree" — which
 * held only while there were exactly two surfaces. Comparing a PHASE SERIES
 * breaks that inference: phases 1, 2 and 3 all live in their own worktrees and
 * all speak the consolidated vocabulary, so inferring `legacy` from "somewhere
 * else" would translate their expectations onto tool names they never advertise
 * and score them zero.
 */
export type EvalSurface = "legacy" | "consolidated";

export interface EvalTarget {
  /** Checkout whose `bin/tomtom-mcp.js` is spawned. */
  root: string;
  /** Names this run's artefacts: `report.json` when empty, else `report.<label>.json`. */
  label: string;
  /** True when the server under test is NOT this working tree. */
  isBaseline: boolean;
  /** The tool vocabulary this target speaks. */
  surface: EvalSurface;
}

/**
 * Resolves the target's surface.
 *
 * `EVAL_SURFACE` is explicit and always wins. Without it the old inference is
 * kept exactly — a baseline is `legacy`, this tree is `consolidated` — so an
 * existing two-way A/B needs no edits.
 */
const resolveSurface = (env: NodeJS.ProcessEnv, isBaseline: boolean): EvalSurface => {
  const requested = env.EVAL_SURFACE?.trim();
  if (!requested) return isBaseline ? "legacy" : "consolidated";
  if (requested !== "legacy" && requested !== "consolidated") {
    throw new Error(`EVAL_SURFACE="${requested}" is not one of: legacy, consolidated.`);
  }
  return requested;
};

/**
 * Resolves the target from the environment.
 *
 * `EVAL_SERVER_ROOT` is taken relative to the repo root when relative, so
 * `../tomtom-mcp-baseline` means what it looks like from the repo you ran the
 * command in. A missing checkout throws here rather than at spawn time, where
 * the failure reads as an MCP handshake error.
 *
 * `EVAL_LABEL` overrides the artefact suffix. It defaults to the checkout's
 * directory name for a baseline and to nothing for this tree — which keeps the
 * default report at the stable `report.json` the phase-to-phase `git diff`
 * relies on.
 */
export const resolveTarget = (env: NodeJS.ProcessEnv = process.env): EvalTarget => {
  const requested = env.EVAL_SERVER_ROOT?.trim();
  if (!requested) {
    return {
      root: REPO_ROOT,
      label: env.EVAL_LABEL?.trim() ?? "",
      isBaseline: false,
      surface: resolveSurface(env, false),
    };
  }

  const root = isAbsolute(requested) ? resolve(requested) : resolve(REPO_ROOT, requested);
  if (!existsSync(join(root, "bin", "tomtom-mcp.js"))) {
    throw new Error(
      `EVAL_SERVER_ROOT="${requested}" resolved to ${root}, which has no bin/tomtom-mcp.js. ` +
        "Point it at a full checkout of this repo — see `pnpm evals:baseline:setup`."
    );
  }

  const isBaseline = root !== REPO_ROOT;
  return {
    root,
    label: env.EVAL_LABEL?.trim() || (isBaseline ? basename(root) : ""),
    isBaseline,
    surface: resolveSurface(env, isBaseline),
  };
};

export const TARGET = resolveTarget();

/**
 * Artefact path for this run: `<dir>/<stem>.json` unaltered for the default
 * target, `<dir>/<stem>.<label>.json` otherwise. Two runs therefore never
 * overwrite each other, which is the minimum requirement for diffing them.
 */
export const artefactPath = (
  dir: string,
  stem: string,
  extension = "json",
  target: EvalTarget = TARGET
): string =>
  join(dir, target.label ? `${stem}.${target.label}.${extension}` : `${stem}.${extension}`);

/**
 * Guard for suites that cannot run in-process against another checkout.
 *
 * Returning the mode rather than a boolean keeps the decision in one place: a
 * baseline is always `stdio`, and asking for a baseline without the transport is
 * a mistake worth naming rather than quietly correcting.
 */
export const assertTransportForTarget = (
  transport: string | undefined,
  target: EvalTarget = TARGET
): void => {
  if (target.isBaseline && transport !== "stdio") {
    throw new Error(
      `EVAL_SERVER_ROOT=${target.root} needs EVAL_TRANSPORT=stdio — the in-process tool ` +
        "modes read this checkout's tool-registry.ts, so they would score THIS tree's tools " +
        "while the report claimed to describe the baseline. Use `pnpm evals:capability:baseline`."
    );
  }
};
