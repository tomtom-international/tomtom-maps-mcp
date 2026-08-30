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
 * Asserts that the tool surface a real MCP client SEES matches the registry the
 * in-process evals READ. No model, no API key — just a built `dist/`.
 *
 * This is the check that keeps the fast in-process modes honest: if the wire
 * surface ever diverges from `TOOL_REGISTRY` (a schema that fails JSON-Schema
 * conversion, an app tool leaking into the model's view, a description mangled
 * in transit), every in-process eval would keep passing while real clients saw
 * something else. Opt-in via `EVAL_TRANSPORT=stdio` since it needs the build.
 */

import { asSchema } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TOOLS, TOOL_ENTRIES } from "../../src/tools/tool-registry";
import { openStdioSession, type StdioSession } from "./stdio-session";
import { TARGET } from "./target";

// Skipped against a baseline (`EVAL_SERVER_ROOT`): every assertion here compares
// the wire to THIS checkout's registry, which an older server is supposed to
// differ from. Running it there would report the whole point of the comparison
// as a failure.
const ENABLED = process.env.EVAL_TRANSPORT === "stdio" && !TARGET.isBaseline;

describe.skipIf(!ENABLED)("real MCP transport", { timeout: 120_000 }, () => {
  let session: StdioSession;

  beforeAll(async () => {
    session = await openStdioSession();
  });

  afterAll(async () => {
    await session?.close();
  });

  it("advertises exactly the model-visible registry tools", () => {
    expect([...session.toolNames].sort()).toEqual(DEFAULT_TOOLS.map((e) => e.name).sort());
  });

  it("hides the app-internal tools from a non-app client", () => {
    // Derived from the registry as well as spelled out, so renaming an app tool
    // cannot leave this assertion passing vacuously (it did, briefly, when
    // tomtom-get-viz-data became tomtom-get-dataset).
    const appOnly = TOOL_ENTRIES.filter((e) => e.visibility === "app").map((e) => e.name);
    expect(appOnly.length).toBeGreaterThan(0);
    for (const name of appOnly) expect(session.toolNames, name).not.toContain(name);

    for (const hidden of ["tomtom-get-api-key", "tomtom-get-app-config", "tomtom-get-dataset"]) {
      expect(session.toolNames, hidden).not.toContain(hidden);
    }
  });

  it("serves each tool's registry description verbatim over the wire", () => {
    const tools = session.buildTools([]);
    for (const entry of DEFAULT_TOOLS) {
      expect(tools[entry.name].description, entry.name).toBe(entry.description);
    }
  });

  it("serves a usable JSON Schema for every tool", async () => {
    const tools = session.buildTools([]);
    for (const [name, tool] of Object.entries(tools)) {
      const schema = await asSchema(tool.inputSchema).jsonSchema;
      expect(schema.type, name).toBe("object");
      // A tool the model cannot fill in is a tool it will never call correctly.
      expect(Object.keys(schema.properties ?? {}).length, name).toBeGreaterThan(0);
    }
  });
});
