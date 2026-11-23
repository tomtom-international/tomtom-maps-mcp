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
 * A judge's verdicts on the recorded runs, judged again from their saved transcripts: repeated
 * to measure how consistent the judge is, and saved per judge and prompt version so a change can
 * be compared against an earlier one.
 *
 * Tuning a judge on the tasks it is scored on inflates its agreement, so the tasks are split
 * once: about a third to tune on, the rest held back for the final comparison. The split is a
 * hash of each task's key, so it never moves.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { JUDGED_QUESTIONS, type JudgedQuestion, type JudgedVerdict, recordOf } from "./agreement";

/** Where judgements live, one `<label>.json` each. */
export const JUDGEMENTS_DIRECTORY = path.resolve(import.meta.dirname, "../golden/judgements");

export type Split = "tuning" | "held-back";

/** The task's side of the split: one key in three is for tuning. */
export function splitOf(key: string): Split {
  return createHash("sha256").update(key).digest()[0] % 3 === 0 ? "tuning" : "held-back";
}

const verdictSchema = z.object({
  answered: z.boolean(),
  grounded: z.boolean(),
  acknowledgedLimit: z.boolean(),
  madeClaims: z.boolean(),
  reason: z.string(),
  judgeTokens: z.number(),
});

export type SavedVerdict = z.infer<typeof verdictSchema>;

const judgementsSchema = z.object({
  label: z.string(),
  judgeProvider: z.string(),
  judgeModel: z.string(),
  /** `JUDGE_PROMPT_VERSION` of the instructions the verdicts were given under. */
  promptVersion: z.string(),
  repeats: z.number(),
  generatedAt: z.string(),
  /** Every repeat's verdict, keyed by `reviewKey`. */
  verdicts: z.record(z.string(), z.array(verdictSchema)),
  /** Repeats that produced no verdict, with the error, keyed by `reviewKey`. */
  errors: z.record(z.string(), z.array(z.string())),
});

export type Judgements = z.infer<typeof judgementsSchema>;

/** Saves `judgements` as `<label>.json` and returns the path. */
export function writeJudgements(judgements: Judgements, directory = JUDGEMENTS_DIRECTORY): string {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${judgements.label}.json`);
  fs.writeFileSync(file, `${JSON.stringify(judgementsSchema.parse(judgements), null, 2)}\n`);
  return file;
}

/** Reads the judgements saved as `label`. */
export function readJudgements(label: string, directory = JUDGEMENTS_DIRECTORY): Judgements {
  const file = path.join(directory, `${label}.json`);
  if (!fs.existsSync(file)) throw new Error(`No judgements labeled "${label}" in ${directory}.`);
  return judgementsSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** The answer most repeats gave to each judged question; a tie goes to the first repeat. */
export function majorityVerdict(verdicts: readonly SavedVerdict[]): JudgedVerdict | undefined {
  if (!verdicts.length) return undefined;
  return recordOf(JUDGED_QUESTIONS, (question) => {
    const yes = verdicts.filter((verdict) => verdict[question]).length;
    return yes * 2 === verdicts.length ? verdicts[0][question] : yes * 2 > verdicts.length;
  });
}

/** Per judged question, the tasks whose repeats all gave the same answer, out of those repeated. */
export function consistency(
  verdictsByKey: Readonly<Record<string, readonly SavedVerdict[]>>
): Record<JudgedQuestion, { count: number; of: number }> {
  const repeated = Object.values(verdictsByKey).filter((verdicts) => verdicts.length > 1);
  return recordOf(JUDGED_QUESTIONS, (question) => ({
    count: repeated.filter((verdicts) =>
      verdicts.every((verdict) => verdict[question] === verdicts[0][question])
    ).length,
    of: repeated.length,
  }));
}
