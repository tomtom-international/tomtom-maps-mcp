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
 * Whether `vendor/` still matches the maps-sdk-js toolkit's `agent-eval` it was ported
 * from, while that package is unpublished. Skipped without a maps-sdk-js checkout:
 * `MAPS_SDK_JS_DIR`, else `../maps-sdk-js` beside this one.
 *
 * Every declaration a vendored file has that is not marked TOMTOM-MCP must be the
 * original's, comments, quotes and layout aside; the marked ones that adapt an original
 * function must still give its output with the original's defaults.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../harness/target";
import { classifyToolCall, convertToJsonString } from "./tool-evidence";

const TOOLKIT = resolve(process.env.MAPS_SDK_JS_DIR ?? join(REPO_ROOT, "..", "maps-sdk-js"));

/** Each vendored file and the original it ports. */
const PORTS = {
  "types.ts": "agent-eval/src/core/types.ts",
  "tool-evidence.ts": "agent-eval/src/judge/toolEvidence.ts",
} as const;

const HAS_TOOLKIT = Object.values(PORTS).every((original) => existsSync(join(TOOLKIT, original)));

const printer = ts.createPrinter({ removeComments: true });

/** A file's top-level declarations by name, normalised, and the names marked TOMTOM-MCP. */
function declarationsOf(file: string): { code: Map<string, string>; marked: Set<string> } {
  const text = readFileSync(file, "utf-8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const code = new Map<string, string>();
  const marked = new Set<string>();
  for (const statement of source.statements) {
    const names = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.map(({ name }) => name.getText(source))
      : (ts.isFunctionDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement)) &&
          statement.name
        ? [statement.name.text]
        : [];
    const comments = (ts.getLeadingCommentRanges(text, statement.pos) ?? [])
      .map(({ pos, end }) => text.slice(pos, end))
      .join("\n");
    const normalised = printer
      .printNode(ts.EmitHint.Unspecified, statement, source)
      .replace(/'/g, '"')
      .replace(/\s+/g, "")
      .replace(/,([}\])])/g, "$1")
      .replace(/;/g, "");
    for (const name of names) {
      code.set(name, normalised);
      if (comments.includes("TOMTOM-MCP")) marked.add(name);
    }
  }
  return { code, marked };
}

describe.skipIf(!HAS_TOOLKIT)("vendor/ against the toolkit's agent-eval", () => {
  it.each(Object.entries(PORTS))(
    "%s keeps every declaration of %s it ports, apart from its TOMTOM-MCP ones",
    (vendored, original) => {
      const port = declarationsOf(join(import.meta.dirname, vendored));
      const { code: upstream } = declarationsOf(join(TOOLKIT, original));
      for (const [name, code] of port.code) {
        if (port.marked.has(name)) continue;
        expect(upstream.get(name), `${vendored}: ${name}`).toBe(code);
      }
    }
  );

  it("compacts tool values as the original does, with its defaults", async () => {
    const upstream = await import(pathToFileURL(join(TOOLKIT, PORTS["tool-evidence.ts"])).href);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const values: unknown[] = [
      undefined,
      null,
      "short",
      "x".repeat(501),
      Array.from({ length: 8 }, (_, index) => ({ index })),
      Array.from({ length: 9 }, (_, index) => ({ index })),
      Array.from({ length: 64 }, (_, index) => index),
      Array.from({ length: 65 }, (_, index) => index),
      { a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } },
      circular,
    ];
    for (const value of values) {
      expect(convertToJsonString(value)).toBe(upstream.convertToJsonString(value));
    }
    for (const output of [
      { error: "x" },
      { count: 0 },
      { features: [] },
      { entries: [] },
      { a: 1 },
    ]) {
      const call = { name: "tool", output };
      expect(classifyToolCall(call)).toBe(upstream.classifyToolCall(call));
    }
  });
});
