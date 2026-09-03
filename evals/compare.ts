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
 * Diffs a baseline run against a current one and writes the comparison.
 *
 * Two capability reports side by side already answer the question the
 * consolidation was justified with — did the new surface answer more, for fewer
 * tokens, without fabricating — but reading them means eyeballing two JSON files
 * of thirteen objects each. This produces the table instead, per task, so a
 * regression is visible rather than merely present.
 *
 * Run it after both halves exist:
 *   pnpm evals:capability:baseline && pnpm evals:capability:current && pnpm evals:compare
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  finalAttempts,
  readScenarioLog,
  type ScenarioRecord,
  summarizeScenarios,
} from "./harness/scenario-log";

const EVALS_DIR = import.meta.dirname;

interface CapabilityReport {
  generatedAt: string;
  mode: string;
  model?: string;
  target?: { label: string; root: string; baseline: boolean };
  summary: {
    tasks: number;
    answered: number;
    grounded: number;
    fabricationRate: number;
    blockedTasks: number;
    blockedButAnswered: number;
    honestRefusals: number;
    regressions: string[];
    totalTokens: number;
    toolFriction: { tool: string; count: number }[];
  };
  results: {
    id: string;
    capability: string;
    expected: "pass" | "blocked";
    answered: boolean;
    grounded: boolean;
    toolsCalled: string[];
    tokens: number;
  }[];
}

const readReport = (path: string): CapabilityReport | undefined =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as CapabilityReport) : undefined;

/** `+3`, `-1,200`, `0` — signed so the direction is readable without the two columns. */
const delta = (before: number, after: number, digits = 0): string => {
  const diff = after - before;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  const magnitude = Math.abs(diff);
  return `${sign}${digits ? magnitude.toFixed(digits) : magnitude.toLocaleString()}`;
};

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A ✓/✗ pair plus an arrow only where the verdict actually moved. */
const verdictCell = (before: boolean, after: boolean): string => {
  const mark = (value: boolean) => (value ? "✓" : "✗");
  if (before === after) return mark(after);
  return `${mark(before)} → **${mark(after)}**`;
};

function capabilitySection(baseline: CapabilityReport, current: CapabilityReport): string[] {
  const lines: string[] = ["## Capability benchmark", ""];

  const b = baseline.summary;
  const c = current.summary;
  lines.push(
    "Same tasks, same judge, same model, two servers.",
    "",
    "| Metric | baseline | current | Δ |",
    "| --- | ---: | ---: | ---: |",
    `| answered | ${b.answered}/${b.tasks} | ${c.answered}/${c.tasks} | ${delta(b.answered, c.answered)} |`,
    `| grounded | ${b.grounded}/${b.tasks} | ${c.grounded}/${c.tasks} | ${delta(b.grounded, c.grounded)} |`,
    `| fabrication rate | ${pct(b.fabricationRate)} | ${pct(c.fabricationRate)} | ${delta(b.fabricationRate * 100, c.fabricationRate * 100, 1)}pp |`,
    `| blocked-but-answered | ${b.blockedButAnswered}/${b.blockedTasks} | ${c.blockedButAnswered}/${c.blockedTasks} | ${delta(b.blockedButAnswered, c.blockedButAnswered)} |`,
    `| honest refusals | ${b.honestRefusals}/${b.blockedTasks} | ${c.honestRefusals}/${c.blockedTasks} | ${delta(b.honestRefusals, c.honestRefusals)} |`,
    `| total tokens | ${b.totalTokens.toLocaleString()} | ${c.totalTokens.toLocaleString()} | ${delta(b.totalTokens, c.totalTokens)} |`,
    "",
    "> Honest refusals falling is not a regression on its own — a blocked task that",
    "> becomes answerable stops being refused. Read it together with the row above it:",
    "> refusals should fall by roughly what blocked-but-answered gains, and fabrication",
    "> must stay at zero either way.",
    ""
  );

  // Per task, because an aggregate that improves by three can still hide a
  // regression — and a regression is the one result this exercise must not miss.
  lines.push(
    "### Per task",
    "",
    "| Task | Capability | answered | grounded | hops | tokens |",
    "| --- | --- | :---: | :---: | ---: | ---: |"
  );

  const currentById = new Map(current.results.map((r) => [r.id, r]));
  for (const before of baseline.results) {
    const after = currentById.get(before.id);
    if (!after) {
      lines.push(`| ${before.id} | ${before.capability} | — | — | — | *absent from current run* |`);
      continue;
    }
    lines.push(
      `| ${before.id} | ${before.capability} ` +
        `| ${verdictCell(before.answered, after.answered)} ` +
        `| ${verdictCell(before.grounded, after.grounded)} ` +
        `| ${before.toolsCalled.length} → ${after.toolsCalled.length} ` +
        `| ${before.tokens.toLocaleString()} → ${after.tokens.toLocaleString()} |`
    );
  }
  lines.push("");

  const newlyAnswered = current.results.filter(
    (after) =>
      after.answered &&
      after.grounded &&
      !baseline.results.find((before) => before.id === after.id)?.answered
  );
  const lost = baseline.results.filter(
    (before) => before.answered && !currentById.get(before.id)?.answered
  );

  lines.push(
    `**Newly answerable:** ${newlyAnswered.length ? newlyAnswered.map((r) => r.id).join(", ") : "none"}`,
    "",
    `**Lost:** ${lost.length ? lost.map((r) => r.id).join(", ") : "none"}`,
    ""
  );

  if (lost.length) {
    lines.push(
      "> A task the old surface answered and the new one does not is a regression the",
      "> consolidation caused. It is not covered by the suite's own assertions unless the",
      '> task is marked `expected: "pass"`.',
      ""
    );
  }

  return lines;
}

function scenarioSection(baselineAll: ScenarioRecord[], currentAll: ScenarioRecord[]): string[] {
  const b = summarizeScenarios(baselineAll);
  const c = summarizeScenarios(currentAll);
  // Summaries dedupe internally; the tables below must too, or every retried
  // prompt appears two or three times over.
  const baseline = finalAttempts(baselineAll);
  const current = finalAttempts(currentAll);

  const lines = [
    "## Tool selection",
    "",
    "Same prompts, both surfaces. A baseline scenario passes when the agent picked any",
    "of the legacy tools that were merged into the expected one (`harness/surfaces.ts`),",
    "which is what makes the two runs comparable rather than a rename test.",
    "",
    "| Metric | baseline | current | Δ |",
    "| --- | ---: | ---: | ---: |",
    `| evaluated | ${b.evaluated} | ${c.evaluated} | ${delta(b.evaluated, c.evaluated)} |`,
    `| routed correctly | ${b.passed} | ${c.passed} | ${delta(b.passed, c.passed)} |`,
    `| accuracy | ${pct(b.accuracy)} | ${pct(c.accuracy)} | ${delta(b.accuracy * 100, c.accuracy * 100, 1)}pp |`,
    `| mean hops | ${b.meanHops.toFixed(2)} | ${c.meanHops.toFixed(2)} | ${delta(b.meanHops, c.meanHops, 2)} |`,
    `| median hops | ${b.medianHops} | ${c.medianHops} | ${delta(b.medianHops, c.medianHops)} |`,
    `| total tokens | ${b.totalTokens.toLocaleString()} | ${c.totalTokens.toLocaleString()} | ${delta(b.totalTokens, c.totalTokens)} |`,
    `| not expressible on this surface | ${b.skippedUnrepresentable} | ${c.skippedUnrepresentable} | — |`,
    `| retried attempts (excluded) | ${b.attempts - b.scenarios} | ${c.attempts - c.scenarios} | — |`,
    `| of which failed then passed | ${b.retriedToPass} | ${c.retriedToPass} | ${delta(b.retriedToPass, c.retriedToPass)} |`,
    "",
    "> Scenario `describe`s set `retry: 2`, so a flaky prompt is attempted up to three",
    "> times. Only the final attempt of each prompt/model pair is counted — otherwise the",
    "> surface that fails more earns a bigger denominator, which is the thing being",
    "> measured. The retry rows are the flakiness signal, not part of the accuracy.",
    "",
  ];

  // Hops per prompt is the claim the commit message makes in so many words
  // ("category search 3->1"). This is where it is either true or it isn't.
  // Pair on prompt AND model: the same prompt against two models is two
  // observations, and averaging them into one row would hide a divergence
  // between them — which is exactly what running two models is for.
  const key = (r: ScenarioRecord) => `${r.expectedTool}\u0000${r.prompt}\u0000${r.modelId}`;
  const currentByKey = new Map(current.filter((r) => r.modelId).map((r) => [key(r), r]));
  const movedHops = baseline
    .filter((r) => r.modelId && currentByKey.has(key(r)))
    .map((before) => ({ before, after: currentByKey.get(key(before))! }))
    .filter(({ before, after }) => before.hops !== after.hops)
    .sort((x, y) => y.before.hops - y.after.hops - (x.before.hops - x.after.hops));

  if (movedHops.length) {
    lines.push(
      "### Prompts whose hop count moved",
      "",
      "| Prompt | Model | baseline | current |",
      "| --- | --- | ---: | ---: |"
    );
    for (const { before, after } of movedHops) {
      lines.push(
        `| ${before.prompt.replace(/\|/g, "\\|")} | ${before.modelId} ` +
          `| ${before.hops} (${before.toolsCalled.join(" → ") || "none"}) ` +
          `| ${after.hops} (${after.toolsCalled.join(" → ") || "none"}) |`
      );
    }
    lines.push("");
  }

  const misroutes = current.filter((r) => r.modelId && !r.passed && !r.unrepresentable?.length);
  if (misroutes.length) {
    lines.push("### Current-surface misroutes", "");
    for (const r of misroutes) {
      lines.push(`- **${r.prompt}** _(${r.modelId})_ — ${r.problem}`);
    }
    lines.push("");
  }

  return lines;
}

/**
 * Everything that has to have been HELD CONSTANT for the two runs to be a
 * comparison rather than two unrelated experiments.
 *
 * The suites hold the corpus and the judge constant for free — they are the same
 * files. What nothing enforces is that both halves were driven by the same model
 * through the same wiring, because those come from the environment and the
 * environment can change between two commands typed minutes apart. A gpt-4.1
 * baseline against a gpt-5.1 current produces a table that looks exactly like a
 * successful refactor, so this is checked loudly rather than trusted.
 */
export const conditionMismatches = (
  baseline: CapabilityReport,
  current: CapabilityReport
): string[] => {
  const problems: string[] = [];

  // A report written before the model was recorded cannot be verified either
  // way. Say that, rather than passing it off as a match.
  if (!baseline.model || !current.model) {
    problems.push(
      "one report does not name the model it used, so the two cannot be shown to " +
        "have run against the same one — re-record both halves"
    );
  } else if (baseline.model !== current.model) {
    problems.push(
      `different models: baseline ran \`${baseline.model}\`, current ran \`${current.model}\``
    );
  }

  // `live` is in-process, `stdio` is over the wire. The suites' own docs say the
  // scores SHOULD match between them — but "should" is the hypothesis, not a
  // licence to mix them inside one comparison.
  if (baseline.mode !== current.mode) {
    problems.push(
      `different tool wiring: baseline ran \`${baseline.mode}\`, current ran \`${current.mode}\``
    );
  }

  return problems;
};

/** The same question for the scenario logs, which carry a model id per record. */
export const scenarioModelMismatch = (
  baseline: readonly ScenarioRecord[],
  current: readonly ScenarioRecord[]
): string | undefined => {
  // Empty ids are the `unrepresentable` rows, which never ran a model.
  const modelsIn = (records: readonly ScenarioRecord[]) =>
    [...new Set(records.map((r) => r.modelId).filter(Boolean))].sort();

  const before = modelsIn(baseline);
  const after = modelsIn(current);
  if (before.join(",") === after.join(",")) return undefined;

  return (
    `different models: baseline ran [${before.join(", ") || "none"}], ` +
    `current ran [${after.join(", ") || "none"}]`
  );
};

/**
 * Renders the mismatch banner, or nothing when the halves are comparable.
 *
 * It goes at the TOP of the document on purpose. A caveat under the tables is a
 * caveat nobody reads once they have seen the numbers.
 */
const mismatchBanner = (problems: readonly string[]): string[] =>
  problems.length
    ? [
        "> [!WARNING]",
        "> **These two runs are not comparable.** The numbers below are still printed,",
        "> because seeing them is how you work out what to re-run — but do not quote them:",
        ...problems.map((problem) => `> - ${problem}`),
        ">",
        "> Re-record both halves with the same `EVAL_MODEL_IDS` and the same",
        "> `EVAL_TRANSPORT`, or set `EVAL_ALLOW_MISMATCH=1` if you genuinely mean to",
        "> compare across models and will say so wherever you quote this.",
        "",
      ]
    : [];

function main(): void {
  const baselineLabel = process.env.EVAL_BASELINE_LABEL?.trim() || "baseline";
  const currentLabel = process.env.EVAL_CURRENT_LABEL?.trim() || "current";

  const capabilityBaseline = readReport(
    join(EVALS_DIR, "capability", `report.${baselineLabel}.json`)
  );
  const capabilityCurrent =
    readReport(join(EVALS_DIR, "capability", `report.${currentLabel}.json`)) ??
    readReport(join(EVALS_DIR, "capability", "report.json"));

  const scenarioBaseline = readScenarioLog(
    join(EVALS_DIR, "scenarios", `runs.${baselineLabel}.jsonl`)
  );
  const scenarioCurrent = (() => {
    const labelled = readScenarioLog(join(EVALS_DIR, "scenarios", `runs.${currentLabel}.jsonl`));
    return labelled.length ? labelled : readScenarioLog(join(EVALS_DIR, "scenarios", "runs.jsonl"));
  })();

  const problems =
    capabilityBaseline && capabilityCurrent
      ? conditionMismatches(capabilityBaseline, capabilityCurrent)
      : [];

  // The scenario logs carry their own model ids, which is the only evidence
  // available when the capability halves were not recorded. Skipped once the
  // reports have already said the models differ — saying it twice in different
  // punctuation reads as two faults rather than one.
  if (!problems.some((problem) => problem.startsWith("different models"))) {
    const scenarioProblem =
      scenarioBaseline.length && scenarioCurrent.length
        ? scenarioModelMismatch(scenarioBaseline, scenarioCurrent)
        : undefined;
    if (scenarioProblem) problems.push(scenarioProblem);
  }

  const sections: string[] = [
    "# Tool surface comparison",
    "",
    ...mismatchBanner(problems),
    `Baseline: \`${baselineLabel}\`${capabilityBaseline?.target ? ` (${capabilityBaseline.target.root})` : ""}  `,
    `Current: \`${currentLabel}\`  `,
    `Model: ${capabilityCurrent?.model || "unrecorded"}  `,
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  if (capabilityBaseline && capabilityCurrent) {
    sections.push(...capabilitySection(capabilityBaseline, capabilityCurrent));
  } else {
    sections.push(
      "## Capability benchmark",
      "",
      `_Not compared — missing ${!capabilityBaseline ? `\`capability/report.${baselineLabel}.json\`` : ""}` +
        `${!capabilityBaseline && !capabilityCurrent ? " and " : ""}` +
        `${!capabilityCurrent ? "the current report" : ""}. Run both halves first._`,
      ""
    );
  }

  if (scenarioBaseline.length && scenarioCurrent.length) {
    sections.push(...scenarioSection(scenarioBaseline, scenarioCurrent));
  } else {
    sections.push(
      "## Tool selection",
      "",
      "_Not compared — one or both scenario logs are missing. Both halves must be run with_",
      "_`EVAL_TRANSPORT=stdio`, since a baseline has no in-process tool source._",
      ""
    );
  }

  const output = `${sections.join("\n")}\n`;
  const path = join(EVALS_DIR, "comparison.md");
  writeFileSync(path, output);
  console.log(output);
  console.log(`written → ${path}`);

  if (!problems.length) return;

  // Written first, THEN failed: the file is what tells you which half to
  // re-record, so it has to exist. The non-zero exit is what stops a mismatched
  // comparison sliding through `evals:ab` or CI unnoticed.
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  if (process.env.EVAL_ALLOW_MISMATCH === "1") {
    console.error("\n  EVAL_ALLOW_MISMATCH=1 — continuing anyway.\n");
    return;
  }
  console.error(
    "\n  Refusing to report this as a comparison. Re-record both halves with the same\n" +
      "  EVAL_MODEL_IDS and EVAL_TRANSPORT, or set EVAL_ALLOW_MISMATCH=1 to override.\n"
  );
  process.exitCode = 1;
}

// Only when run as a script: the predicates above are imported by
// `harness/comparison.test.ts`, and an import must not write comparison.md.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
