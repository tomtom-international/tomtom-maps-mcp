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
 * `ProcessSandboxExecutor` — runs LLM-authored code in a jailed child process.
 *
 * ## Why a process and not a worker thread
 *
 * This started as a `worker_threads` executor, which is the obvious choice: it is
 * faster to start and data crosses by structured clone. It was replaced after
 * measuring what its isolation actually bought, and the measurement is worth
 * recording because the failure was silent.
 *
 * Node's permission model (`--permission`) can be passed per-thread via
 * `execArgv`, and it looks like it works: `process.permission` is present and
 * reading `/etc/hosts` fails with `ERR_ACCESS_DENIED`. But a worker cannot have
 * its own working directory, and worker-level `--permission` leaves the cwd
 * readable. In this repo that meant a sandboxed body could read
 * `<repo>/.env` — the server's own TomTom API key — while `/etc/hosts` was
 * correctly denied. A boundary that blocks the harmless path and allows the
 * credential is worse than no boundary, because it reads as safe.
 *
 * A child process has its own `cwd`. Pointed at an empty temp directory with
 * `--permission` and a read grant covering only `node_modules`, the same probes
 * come back denied — including `.env`. That is the whole reason for the extra
 * ~50ms of process startup.
 *
 * ## What is enforced, measured rather than assumed
 *
 * | Capability | Status |
 * | --- | --- |
 * | Read the server's `.env` / any repo file | **denied** (`ERR_ACCESS_DENIED`) |
 * | Read anything outside `node_modules` | **denied** |
 * | Read env vars / credentials | **denied** — `env: {}` |
 * | Spawn a subprocess | **denied** (`ERR_ACCESS_DENIED`) |
 * | Exceed the heap cap | **denied** — `--max-old-space-size` |
 * | Run past the timeout | **denied** — `SIGKILL` |
 * | **Network egress** | **NOT denied** — see below |
 *
 * The global shadowing in `sandbox-code.ts` is a tripwire and nothing more: a
 * constructor walk (`({}).constructor.constructor("return globalThis")()`)
 * reaches the real `globalThis`. Verified. What makes the table hold is the
 * process options, not the shadows.
 *
 * **Residual risk: network.** Node's permission model does not cover sockets, so
 * `fetch` stays reachable through that walk. A body could POST the dataset it was
 * handed to an external host. It cannot reach another caller's datasets (each
 * analysis only receives datasets its own principal owns) nor the server's
 * credentials, so the exposure is bounded by what that caller could already read
 * through the tool surface. Closing it needs an egress policy at the container
 * level — a deployment decision — and that is the one thing to settle before
 * enabling this on a shared endpoint.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { logger } from "../../../utils/logger";
import {
  formatSandboxExecutionError,
  type SandboxExecutor,
  sandboxedGlobalShadows,
} from "./sandbox-code";

/** Wall-clock ceiling for one analysis. Past this the child is SIGKILLed. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Heap ceiling. Generous enough for turf over ~100k features. */
const MAX_HEAP_MB = 512;

/** Cap on the JSON the child may write back, so a runaway result can't fill memory. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

interface SandboxPaths {
  /** `require`-able absolute paths for the injected libraries. */
  libs: { turf: string; h3: string };
  /** The single directory the child is allowed to read. */
  readableDir: string;
}

let paths: SandboxPaths | undefined;

/**
 * Resolves the library paths and the one directory the child may read.
 *
 * The grant is the `node_modules` ROOT, not each package directory: CJS
 * resolution walks parent directories looking for `package.json`, so a
 * package-scoped grant makes `require` fail with `ERR_ACCESS_DENIED` (measured).
 * The root is still far narrower than the repo — it excludes `.env`, the source
 * tree, and everything else on the machine.
 */
const resolvePaths = (): SandboxPaths => {
  const require = createRequire(import.meta.url);
  const turf = require.resolve("@turf/turf");
  const h3 = require.resolve("h3-js");
  // First `/node_modules/` segment: correct for both a pnpm store layout
  // (…/node_modules/.pnpm/pkg/node_modules/pkg/…) and a flat npm one.
  const marker = "/node_modules/";
  const index = turf.indexOf(marker);
  const readableDir = index === -1 ? turf : turf.slice(0, index + marker.length - 1);
  return { libs: { turf, h3 }, readableDir };
};

/**
 * The child program, as a `-e` script.
 *
 * CommonJS on purpose: the child runs with no package.json in scope (its cwd is
 * an empty jail), so `require` of an absolute path is the dependable way in.
 * Everything it needs arrives on stdin — it opens no files and reads no argv.
 */
const CHILD_SOURCE = /* js */ `
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  let reply = { ok: false, name: "Error", message: "sandbox did not run" };
  try {
    const { code, paramNames, args, shadows, libs } = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    // Namespaces cannot cross a JSON boundary, so they are required in here.
    const provided = { turf: require(libs.turf), h3: require(libs.h3) };

    const callArgs = paramNames.map((name, i) =>
      Object.prototype.hasOwnProperty.call(provided, name) ? provided[name] : args[i]
    );

    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    // Never shadow a name the caller injects — a duplicate formal parameter
    // would clobber the real value with undefined.
    const active = shadows.filter((n) => !paramNames.includes(n));
    const fn = new AsyncFunction(...paramNames, ...active, code);

    const value = await fn(...callArgs, ...active.map(() => undefined));
    reply = { ok: true, value };
  } catch (error) {
    reply = {
      ok: false,
      name: (error && error.name) || "Error",
      message: (error && error.message) || String(error),
    };
  }
  try {
    process.stdout.write(JSON.stringify(reply));
  } catch (error) {
    // A value that will not serialise (circular, BigInt) must still come back as
    // a usable error rather than an empty stdout the parent cannot explain.
    process.stdout.write(
      JSON.stringify({ ok: false, name: "TypeError", message: "could not be cloned: " + error.message })
    );
  }
});
`;

export interface ProcessExecutorOptions {
  timeoutMs?: number;
}

/**
 * Creates a {@link SandboxExecutor} that runs each body in a fresh jailed child.
 *
 * Fresh per call, deliberately: a reused process would carry prototype pollution
 * or a leaked global from one caller's code into the next, which is exactly the
 * property being bought here.
 */
export function createProcessSandboxExecutor(
  options: ProcessExecutorOptions = {}
): SandboxExecutor {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    run<Result = unknown>(
      code: string,
      paramNames: readonly string[],
      args: readonly unknown[],
      verb: string
    ): Promise<{ value: Result } | { error: string }> {
      return new Promise((resolve) => {
        paths ??= resolvePaths();

        // An empty directory as cwd is what makes the read grant meaningful: the
        // child's working directory holds nothing worth reading.
        let jail: string;
        try {
          jail = mkdtempSync(`${tmpdir()}/tomtom-mcp-sandbox-`);
        } catch (error) {
          resolve({ error: formatSandboxExecutionError(verb, error) });
          return;
        }

        const payload = JSON.stringify({
          code,
          paramNames: [...paramNames],
          // Library slots are filled in the child; sending `undefined` keeps the
          // positions aligned without trying to serialise a namespace.
          args: args.map((value, index) =>
            paramNames[index] === "turf" || paramNames[index] === "h3" ? undefined : value
          ),
          shadows: [...sandboxedGlobalShadows],
          libs: paths.libs,
        });

        const child = spawn(
          process.execPath,
          [
            "--permission",
            `--allow-fs-read=${paths.readableDir}`,
            `--max-old-space-size=${MAX_HEAP_MB}`,
            "-e",
            CHILD_SOURCE,
          ],
          {
            cwd: jail,
            // No env at all: the body cannot read TOMTOM_API_KEY or anything else.
            env: {},
            stdio: ["pipe", "pipe", "pipe"],
          }
        );

        let stdout = "";
        let stderr = "";
        let truncated = false;
        let settled = false;

        const cleanup = (): void => {
          clearTimeout(timer);
          try {
            rmSync(jail, { recursive: true, force: true });
          } catch {
            // A leftover empty temp dir is harmless; never fail an analysis on it.
          }
        };

        const finish = (outcome: { value: Result } | { error: string }): void => {
          if (settled) return;
          settled = true;
          cleanup();
          child.kill("SIGKILL");
          resolve(outcome);
        };

        const timer = setTimeout(() => {
          logger.warn({ verb, timeoutMs }, "Sandbox execution timed out — killing child process");
          finish({
            error:
              `${verb} code execution timed out after ${timeoutMs}ms and was cancelled. ` +
              "Hint: the code may contain an unbounded loop, or be doing O(N·M) work over a large " +
              "dataset — pre-bucket points with `h3.latLngToCell` and compare only same-cell or " +
              "neighbour-cell pairs to turn that into roughly O(N+M).",
          });
        }, timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          if (stdout.length + chunk.length > MAX_OUTPUT_BYTES) {
            truncated = true;
            child.kill("SIGKILL");
            return;
          }
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf8")).slice(0, 2000);
        });

        child.on("error", (error) => {
          finish({ error: formatSandboxExecutionError(verb, error) });
        });

        child.on("close", (exitCode, signal) => {
          if (settled) return;

          if (truncated) {
            finish({
              error:
                `${verb} returned more than ${MAX_OUTPUT_BYTES / (1024 * 1024)}MB. ` +
                "Return an aggregate — counts, groupings, a top-N list — not the features themselves.",
            });
            return;
          }

          if (!stdout) {
            // No stdout means the runtime died before it could reply: almost
            // always the heap cap, occasionally a crash. `stderr` carries V8's
            // own message, which is more specific than anything guessable here.
            const detail = stderr.trim().split("\n")[0] ?? "";
            finish({
              error:
                `${verb} code execution was terminated (exit ${exitCode}${signal ? `, ${signal}` : ""})` +
                `${detail ? `: ${detail}` : ""}. Hint: this is usually the ${MAX_HEAP_MB}MB memory ` +
                "limit — aggregate incrementally instead of building large intermediate arrays.",
            });
            return;
          }

          try {
            const reply = JSON.parse(stdout) as
              | { ok: true; value: Result }
              | { ok: false; name: string; message: string };
            if (reply.ok) {
              finish({ value: reply.value });
              return;
            }
            // Rebuild an Error so the shared hint matcher sees the shape it would
            // on the main thread — `name` drives the SyntaxError branch.
            const error = new Error(reply.message);
            error.name = reply.name;
            finish({ error: formatSandboxExecutionError(verb, error) });
          } catch {
            finish({
              error: `${verb} produced output that could not be parsed: ${stdout.slice(0, 200)}`,
            });
          }
        });

        child.stdin.on("error", () => {
          // The child can exit before stdin drains (a syntax error in the runner,
          // or the heap cap). `close` reports it; swallow EPIPE here.
        });
        child.stdin.end(payload);
      });
    },
  };
}

/** The executor used by the analysis tool. */
export const processSandboxExecutor: SandboxExecutor = createProcessSandboxExecutor();
