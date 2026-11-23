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
 * A recorded eval run for people to review: each task's prompt, rubric, tool calls and answer,
 * with the judge's verdict. Tool inputs and outputs are kept as the judge saw them, abridged
 * the same way, so a reviewer and the judge read the same evidence.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { JudgeToolView } from "../capability/judge";
import type { OfferedTool } from "../harness/mcp-agent";

/** Where recorded runs live, one JSON file per run. */
export const RUNS_DIRECTORY = path.resolve(import.meta.dirname, "../golden/runs");

const toolCallSchema = z.object({
  name: z.string(),
  status: z.enum(["ok", "empty", "failed"]),
  abridged: z.string().nullable(),
  input: z.string(),
  output: z.string(),
}) satisfies z.ZodType<JudgeToolView>;

const transcriptSchema = z.object({
  taskId: z.string(),
  capability: z.string(),
  expected: z.enum(["pass", "blocked"]),
  /** The user's turns in order; the answer replies to the last. */
  turns: z.array(z.string()).min(1),
  rubric: z.string(),
  /** The oracle's answer on a demanding task, which the judge was also shown. */
  reference: z.string().optional(),
  answer: z.string(),
  toolCalls: z.array(toolCallSchema),
  judge: z.object({
    answered: z.boolean(),
    grounded: z.boolean(),
    acknowledgedLimit: z.boolean(),
    madeClaims: z.boolean(),
    reason: z.string(),
    judgedOnCompleteData: z.boolean(),
  }),
});

/** What the model was given before the first message, for reviewers to read. */
const contextSchema = z.object({
  system: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.unknown(),
    }) satisfies z.ZodType<OfferedTool>
  ),
  /** True when added after the run from the same code, rather than recorded by it. */
  filledInLater: z.boolean().default(false),
});

export const runSchema = z.object({
  model: z.string(),
  provider: z.string(),
  judgeModel: z.string(),
  temperature: z.number(),
  maxSteps: z.number(),
  corpus: z.string(),
  commit: z.string(),
  generatedAt: z.string(),
  /** Absent on a run saved before contexts were recorded. */
  context: contextSchema.optional(),
  transcripts: z.array(transcriptSchema),
});

/** A run as reviewers get it: the judge's verdicts left out, so they cannot steer the labels. */
export const reviewableRunSchema = runSchema.extend({
  id: z.string(),
  transcripts: z.array(transcriptSchema.omit({ judge: true })),
});

export type Transcript = z.infer<typeof transcriptSchema>;
export type ReviewableRun = z.infer<typeof reviewableRunSchema>;
export type ReviewableTranscript = ReviewableRun["transcripts"][number];
export type JudgeVerdict = Transcript["judge"];
export type RunContext = z.infer<typeof contextSchema>;
export type RecordedRun = z.infer<typeof runSchema> & { id: string };

/** The run ids in `directory`: each file's name without `.json`, newest first by name. */
export function listRuns(directory = RUNS_DIRECTORY): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort()
    .reverse();
}

/** Reads and validates one run. Throws on an unknown id or a file of the wrong shape. */
export function readRun(id: string, directory = RUNS_DIRECTORY): RecordedRun {
  if (!listRuns(directory).includes(id)) throw new Error(`No recorded run "${id}".`);
  const file = path.join(directory, `${id}.json`);
  return { id, ...runSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) };
}

/**
 * Validates and saves a run as `<date>-<time>-<model>-<corpus>.json`, and returns its path.
 * The time keeps two runs of one day apart.
 */
export function writeRun(run: Omit<RecordedRun, "id">, directory = RUNS_DIRECTORY): string {
  const stamp = run.generatedAt.slice(0, 16).replace(/[T:]/g, "-");
  const id = `${stamp}-${run.model}-${run.corpus}`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(runSchema.parse(run), null, 2)}\n`);
  return file;
}

/** Identifies an answer, so a label stays tied to the exact text it was given for. */
export const answerHash = (answer: string): string =>
  createHash("sha256").update(answer).digest("hex").slice(0, 12);
