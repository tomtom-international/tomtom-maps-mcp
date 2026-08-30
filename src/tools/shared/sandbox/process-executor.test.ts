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
 * These are the tests that decide whether running model-authored code on this
 * server is defensible. Each isolation claim in `process-executor.ts` gets an
 * assertion here — a claim about a security boundary that nothing exercises is
 * just a comment.
 */

import { describe, expect, it } from "vitest";
import { createProcessSandboxExecutor } from "./process-executor";
import { runSandboxedFn } from "./sandbox-code";

const executor = createProcessSandboxExecutor({ timeoutMs: 8_000 });

const run = <T = unknown>(code: string, params: string[] = [], args: unknown[] = []) =>
  runSandboxedFn<T>(code, params, args, "Analysis", executor);

describe("ProcessSandboxExecutor", { timeout: 60_000 }, () => {
  it("runs a body and returns its value", async () => {
    const result = await run<number>("return 1 + 1;");
    expect(result).toEqual({ value: 2 });
  });

  it("passes injected data through", async () => {
    const result = await run<number>("return items.length;", ["items"], [[1, 2, 3]]);
    expect(result).toEqual({ value: 3 });
  });

  it("provides turf inside the child", async () => {
    const result = await run<number>(
      "return Math.round(turf.distance([4.9, 52.37], [4.9, 52.38], { units: 'meters' }));",
      ["turf"],
      [undefined]
    );
    expect("value" in result && (result.value as number)).toBeGreaterThan(1000);
  });

  it("provides h3 inside the child", async () => {
    const result = await run<string>("return h3.latLngToCell(52.37, 4.9, 7);", ["h3"], [undefined]);
    expect("value" in result && typeof result.value).toBe("string");
  });

  it("supports top-level await", async () => {
    const result = await run<number>("const v = await Promise.resolve(7); return v;");
    expect(result).toEqual({ value: 7 });
  });

  // --- Isolation claims ------------------------------------------------------

  it("kills an unbounded loop and explains why", async () => {
    const started = Date.now();
    const result = await run("while (true) {}");
    expect("error" in result && result.error).toContain("timed out");
    // The whole point: a spin cannot be stopped on the main thread at all.
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("survives an allocation loop instead of taking the server down", async () => {
    const result = await run("const a = []; while (true) { a.push(new Array(1e6).fill(0)); }");
    expect("error" in result).toBe(true);
    // Either the heap cap or the wall clock catches it; both are acceptable.
    expect("error" in result && /memory|timed out|terminated/i.test(result.error)).toBe(true);
  });

  it("blocks network access", async () => {
    const result = await run("return typeof fetch;");
    expect(result).toEqual({ value: "undefined" });
  });

  it("blocks process access", async () => {
    const result = await run("return typeof process;");
    expect(result).toEqual({ value: "undefined" });
  });

  it("blocks require", async () => {
    const result = await run("return typeof require;");
    expect(result).toEqual({ value: "undefined" });
  });

  // The tests below deliberately USE the constructor-walk escape, because that
  // is the realistic attacker and the shadows do not stop it. What must hold is
  // that the worker options do.
  const ESCAPE = 'const g = ({}).constructor.constructor("return globalThis")();';

  it("documents that global shadowing is only a tripwire", async () => {
    // Stated plainly in sandbox-code.ts; asserted here so nobody mistakes the
    // shadows for the boundary. If this ever starts failing, the escape closed
    // and the docs should be updated — it is not a regression.
    const result = await run(`${ESCAPE} return typeof g.process;`);
    expect(result).toEqual({ value: "object" });
  });

  it("gives the body no credentials even through the escape", async () => {
    const result = await run(`${ESCAPE} return Object.keys(g.process.env);`);

    const keys = ("value" in result ? result.value : []) as string[];
    // `env: {}` is what enforces this, not the shadows. macOS injects
    // `__CF_USER_TEXT_ENCODING` below the Node layer (a locale artifact, absent
    // on Linux), so assert on WHAT is visible rather than on an empty count —
    // a count assertion would be a platform trip-hazard for no extra safety.
    for (const key of keys) expect(key).toBe("__CF_USER_TEXT_ENCODING");
    for (const secret of [
      "TOMTOM_API_KEY",
      "ANTHROPIC_API_KEY",
      "AZURE_API_KEY",
      "PATH",
      "HOME",
      "PWD",
    ]) {
      expect(keys, secret).not.toContain(secret);
    }
  });

  it("denies filesystem reads even through the escape", async () => {
    const result = await run(
      `try { const fs = await import("node:fs"); fs.readFileSync("/etc/hosts"); return "ALLOWED"; }
       catch (e) { return e.code ?? "threw"; }`
    );
    // Enforced by --permission. Verified to be ERR_ACCESS_DENIED, not a shadow.
    expect(result).toEqual({ value: "ERR_ACCESS_DENIED" });
  });

  it("denies reading the repo's own .env", async () => {
    const result = await run(
      `try { const fs = await import("node:fs");
             return fs.readFileSync(${JSON.stringify(`${process.cwd()}/.env`)}, "utf8").length > 0 ? "READ" : "EMPTY"; }
       catch (e) { return e.code ?? "threw"; }`
    );
    // The reason this executor is a process and not a worker thread: with a
    // worker, this read SUCCEEDED (the cwd stays readable under worker-level
    // --permission) and handed the body the server's API key.
    expect(result).toEqual({ value: "ERR_ACCESS_DENIED" });
  });

  it("denies spawning a subprocess", async () => {
    const result = await run(
      `try { const cp = await import("node:child_process"); cp.execSync("echo hi"); return "ALLOWED"; }
       catch (e) { return e.code ?? "threw"; }`
    );
    expect(result).toEqual({ value: "ERR_ACCESS_DENIED" });
  });

  it("denies spawning a nested worker", async () => {
    const result = await run(
      `try { const wt = await import("node:worker_threads"); new wt.Worker("", { eval: true }); return "ALLOWED"; }
       catch (e) { return e.code ?? "threw"; }`
    );
    expect("value" in result && result.value).not.toBe("ALLOWED");
  });

  it("cannot read the server's source tree", async () => {
    const result = await run(
      `try { const fs = await import("node:fs");
             return fs.readFileSync(${JSON.stringify(`${process.cwd()}/package.json`)}, "utf8").slice(0, 4); }
       catch (e) { return e.code ?? "threw"; }`
    );
    expect(result).toEqual({ value: "ERR_ACCESS_DENIED" });
  });

  it("still loads turf and h3 despite the filesystem denial", async () => {
    // The permission grant is scoped to the two library package roots; if that
    // scoping breaks, every analysis fails rather than silently degrading.
    const result = await run(
      "return [typeof turf.area, typeof h3.latLngToCell].join(',');",
      ["turf", "h3"],
      [undefined, undefined]
    );
    expect(result).toEqual({ value: "function,function" });
  });

  it("KNOWN GAP: network egress is not blocked", async () => {
    // Node's permission model does not cover sockets. Asserted so the gap is
    // visible in the test output rather than living only in a comment — see the
    // residual-risk note in worker-executor.ts. Closing it needs a container
    // egress policy.
    const result = await run(`${ESCAPE} return typeof g.fetch;`);
    expect(result).toEqual({ value: "function" });
  });

  it("cannot mutate data the server still holds", async () => {
    const held = { features: [{ properties: { name: "original" } }] };
    const result = await run(
      "data.features[0].properties.name = 'mutated'; return data.features[0].properties.name;",
      ["data"],
      [held]
    );
    // The body saw its own copy (JSON across the process boundary)…
    expect(result).toEqual({ value: "mutated" });
    // …and the server's object is untouched.
    expect(held.features[0].properties.name).toBe("original");
  });

  // --- Error reporting -------------------------------------------------------

  it("reports a syntax error as an actionable message", async () => {
    const result = await run("return {;");
    expect("error" in result && result.error).toMatch(/Unexpected|not valid JavaScript/);
    expect("error" in result && result.error).toContain("Hint:");
  });

  it("hints on a turf typo", async () => {
    const result = await run("return turf.notARealFunction();", ["turf"], [undefined]);
    expect("error" in result && result.error).toContain("turfjs.org");
  });

  it("hints when the code reaches for another tool", async () => {
    const result = await run("return await tools.discoverPlaces();");
    expect("error" in result && result.error).toContain("dataset_ids");
  });

  it("strips an LLM's habitual require of an injected library", async () => {
    // Would otherwise be a parse-time "already been declared" before the body runs.
    const result = await run(
      "const turf = require('@turf/turf');\nreturn typeof turf.area;",
      ["turf"],
      [undefined]
    );
    expect(result).toEqual({ value: "function" });
  });

  it("runs concurrent analyses independently", async () => {
    const results = await Promise.all([run("return 1;"), run("return 2;"), run("return 3;")]);
    expect(results).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  });
});
