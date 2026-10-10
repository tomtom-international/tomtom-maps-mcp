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
 * One MCP subprocess per test file, shared by everything in it.
 *
 * Both suites need a transport session once `EVAL_TRANSPORT=stdio` is on, and
 * the scenario runner cannot open one itself — it is called from inside `it()`,
 * where there is nowhere to hang a teardown. So the session is a per-file
 * singleton opened on first use and closed by `harness/setup.ts`, which vitest
 * loads for every eval file and which therefore does have hooks.
 *
 * Per FILE, not per run: vitest gives each file its own worker, so module state
 * does not cross files. That is fine — a server spawn is ~1s against model calls
 * measured in tens of seconds.
 */

import { openStdioSession, type StdioSession } from "./stdio-session";
import { TARGET } from "./target";

let pending: Promise<StdioSession> | undefined;

/**
 * The session for the target under test, opened on first call.
 *
 * Callers share one subprocess, so the tool surface every suite in a file sees
 * is provably the same one — which matters when the point of the run is to
 * attribute results to a surface.
 */
export const getSharedSession = (): Promise<StdioSession> => {
  pending ??= openStdioSession(TARGET);
  return pending;
};

/** Closes the session if one was opened. Safe to call when none was. */
export const closeSharedSession = async (): Promise<void> => {
  const session = pending;
  pending = undefined;
  if (!session) return;
  await (await session).close();
};
