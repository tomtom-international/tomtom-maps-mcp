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
 * `pnpm evals:review`: a local page for labelling recorded runs. Serves the runs in
 * `evals/golden/runs/`, or with `pnpm evals:review <file>` only one reviewer's share from
 * `pnpm evals:review:split`, and saves labels to `evals/golden/reviews/<reviewer>.json`. Listens
 * on 127.0.0.1 only; `EVAL_REVIEW_PORT` overrides the port.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ZodError } from "zod";
import { readAssignment } from "./assignments";
import {
  matchingReview,
  parseReviewer,
  REVIEW_FORM,
  ReviewError,
  readReviews,
  saveReview,
} from "./reviews";
import {
  type JudgeVerdict,
  listRuns,
  type ReviewableRun,
  type ReviewableTranscript,
  readRun,
} from "./runs";
import { SERVER_LIMITS } from "./server-limits";

const PORT = Number(process.env.EVAL_REVIEW_PORT ?? 4317);
const PAGE = path.resolve(import.meta.dirname, "index.html");
const MAX_BODY_BYTES = 64 * 1024;
/** The run id that stands for every recorded run at once. */
const ALL_RUNS = "all";

/** One reviewer's share of the runs, when the page serves only that. */
const SHARE = process.argv[2];
const ASSIGNED: readonly ReviewableRun[] | undefined = SHARE
  ? readAssignment(path.resolve(SHARE)).runs
  : undefined;

/** The ids of the runs the page serves, newest first. */
const runIds = (): string[] => ASSIGNED?.map((recorded) => recorded.id) ?? listRuns();

const loadRun = (id: string): ReviewableRun =>
  ASSIGNED?.find((recorded) => recorded.id === id) ?? readRun(id);

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** A transcript without the judge's verdict, which reviewers never see. */
const withoutVerdict = ({
  judge: _,
  ...transcript
}: ReviewableTranscript & { judge?: JudgeVerdict }): ReviewableTranscript => transcript;

function reviewer(url: URL): string {
  try {
    return parseReviewer(url.searchParams.get("reviewer") ?? "");
  } catch (error) {
    throw new RequestError(400, error instanceof Error ? error.message : String(error));
  }
}

function run(id: string) {
  if (!runIds().includes(id)) throw new RequestError(404, `No recorded run "${id}".`);
  return loadRun(id);
}

async function readBody(request: http.IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) throw new RequestError(413, "Review too large.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new RequestError(400, "The body is not JSON.");
  }
}

/** The runs listed for the dropdown, without their transcripts or contexts. */
function runList() {
  return runIds().map((id) => {
    const { transcripts, context, ...details } = loadRun(id);
    return { ...details, tasks: transcripts.length, hasContext: Boolean(context) };
  });
}

/**
 * A run's tasks without verdicts, with this reviewer's review of each answer; `all` is every
 * run's tasks in one list, oldest run first. Each run's tools and instructions come once.
 */
function runView(id: string, handle: string) {
  const runs =
    id === ALL_RUNS
      ? runIds()
          .reverse()
          .map((runId) => loadRun(runId))
      : [run(id)];
  const reviews = readReviews(handle);
  return {
    id,
    contexts: Object.fromEntries(runs.map((recorded) => [recorded.id, recorded.context ?? null])),
    transcripts: runs.flatMap((recorded) =>
      recorded.transcripts.map((transcript) => ({
        ...withoutVerdict(transcript),
        runId: recorded.id,
        model: recorded.model,
        review: matchingReview(reviews, recorded.id, transcript),
      }))
    ),
  };
}

/** Saves a review of one task. */
function saveFor(runId: string, taskId: string, handle: string, body: unknown) {
  const recorded = run(runId);
  const transcript = recorded.transcripts.find((candidate) => candidate.taskId === taskId);
  if (!transcript) throw new RequestError(404, `Run "${recorded.id}" has no task "${taskId}".`);
  return { review: saveReview(handle, recorded, taskId, body) };
}

/** The GET routes with a fixed path. */
const PAGES: Record<string, () => unknown> = {
  "/": () => fs.readFileSync(PAGE, "utf8"),
  "/favicon.ico": () => null,
  "/api/form": () => REVIEW_FORM,
  "/api/limits": () => SERVER_LIMITS,
  "/api/runs": runList,
};

/** Every route; returns the JSON to send, a string of HTML, or null for an empty response. */
async function route(request: http.IncomingMessage, url: URL): Promise<unknown> {
  const fixed = request.method === "GET" ? PAGES[url.pathname] : undefined;
  if (fixed) return fixed();

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [api, runs, runId, tasks, taskId] = parts;
  const isRun = api === "api" && runs === "runs";
  // GET /api/runs/:run?reviewer=
  if (request.method === "GET" && isRun && parts.length === 3) {
    return runView(runId, reviewer(url));
  }
  // PUT /api/runs/:run/tasks/:task?reviewer=
  if (request.method === "PUT" && isRun && tasks === "tasks" && parts.length === 5) {
    return saveFor(runId, taskId, reviewer(url), await readBody(request));
  }
  throw new RequestError(404, `No route for ${request.method} ${url.pathname}.`);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  try {
    const result = await route(request, url);
    if (result === null) {
      response.writeHead(204).end();
      return;
    }
    const isPage = typeof result === "string";
    response.writeHead(200, {
      "content-type": isPage ? "text/html; charset=utf-8" : "application/json",
      // Labels and the page change while reviewing; a cached copy would show stale ones.
      "cache-control": "no-store",
    });
    response.end(isPage ? result : JSON.stringify(result));
  } catch (error) {
    const { status, message } = failure(error);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  }
});

/** The status and message a thrown error is answered with: 400 for a bad review, 500 for a bug. */
function failure(error: unknown): { status: number; message: string } {
  if (error instanceof RequestError) return { status: error.status, message: error.message };
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return { status: 400, message: issues.join("; ") };
  }
  if (error instanceof ReviewError) return { status: 400, message: error.message };
  return { status: 500, message: error instanceof Error ? error.message : String(error) };
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Review page: http://127.0.0.1:${PORT}/${SHARE ? ` (only ${SHARE})` : ""}`);
});
