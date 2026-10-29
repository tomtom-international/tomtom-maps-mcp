/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { APPS_CLIENT, connectInMemory } from "./inMemoryClient";

const TOOLS_LIST_BUDGET_BYTES = { apps: 69_000, textOnly: 40_000 };
const APP_BUNDLE_GZIP_BUDGET_BYTES = 415_000;

const BUILT_APPS = path.resolve(import.meta.dirname, "../dist/apps");

async function toolsListBytes(name: string, options?: Parameters<typeof connectInMemory>[1]) {
  const client = await connectInMemory(name, options);
  const { tools } = await client.listTools();
  await client.close();
  return Buffer.byteLength(JSON.stringify(tools));
}

function builtBundles(): string[] {
  return readdirSync(BUILT_APPS, { recursive: true, encoding: "utf-8" })
    .filter((file) => path.basename(file) === "app.html")
    .sort();
}

describe("payload budgets", () => {
  it("keeps the tools/list a model reads every turn within budget, for apps and text-only clients", async () => {
    expect(await toolsListBytes("claude-ai", APPS_CLIENT)).toBeLessThanOrEqual(
      TOOLS_LIST_BUDGET_BYTES.apps
    );
    expect(await toolsListBytes("claude-code")).toBeLessThanOrEqual(
      TOOLS_LIST_BUDGET_BYTES.textOnly
    );
  });

  it.skipIf(!existsSync(BUILT_APPS) && !process.env.CI)(
    "keeps every built app bundle within its gzipped budget",
    () => {
      const bundles = builtBundles();
      expect(bundles.length, "no app bundle in dist/apps: run pnpm build:apps").toBeGreaterThan(0);

      for (const bundle of bundles) {
        const gzipped = gzipSync(readFileSync(path.join(BUILT_APPS, bundle))).length;
        expect(gzipped, bundle).toBeLessThanOrEqual(APP_BUNDLE_GZIP_BUDGET_BYTES);
      }
    }
  );
});
