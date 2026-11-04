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
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = __dirname;

const SDK_SERVICES_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"@tomtom-org\/maps-sdk\/services"/g;

const MODULES_ALLOWED_TO_IMPORT_SDK_VALUES: Record<string, string> = {
  "schemas/search/searchSchema.ts": "reads the routeTypes constant, calls nothing",
  "schemas/routing/common.ts": "reads the routeTypes constant, calls nothing",
};

const MODULES_ALLOWED_TO_THROW_PLAIN_ERRORS: Record<string, string> = {
  "auth/jwtVerifier.ts": "a startup invariant: the server is configured without an issuer",
  "tools/mcpRequestHandler.ts":
    "a startup invariant: tools are registered before the handlers are wrapped",
  "utils/userAgent.ts": "startup invariants on the server's own user-agent names",
};

const MODULES_ALLOWED_TO_DEFAULT_ON_FAILURE: Record<string, string> = {
  "auth/mcpProjectResolver.ts": "an error response's body that is not JSON has no error code",
  "auth/tokenExchanger.ts": "an error response's body that is not JSON has no error code",
  "auth/ulsApiKeyResolver.ts": "an error response's body that is not JSON has no error code",
};

function serverSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "apps" ? [] : serverSourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [relative(SRC, path)]
      : [];
  });
}

const readSource = (path: string) => readFileSync(join(SRC, path), "utf8");

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

function importedSdkValues(source: string): string[] {
  return [...source.matchAll(SDK_SERVICES_IMPORT)].flatMap(([, names]) =>
    names
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name && !name.startsWith("type "))
      .map((name) => name.split(/\s+as\s+/).pop() as string)
  );
}

const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

const modulesMatching = (test: (source: string) => boolean) =>
  serverSourceFiles(SRC)
    .filter((path) => test(readSource(path)))
    .sort();

describe("every failed upstream call is attributed to its upstream", () => {
  it("calls the maps-sdk services only from the service modules", () => {
    const outsideServices = modulesMatching(
      (source) => importedSdkValues(source).length > 0
    ).filter((path) => !path.startsWith("services/"));

    expect(outsideServices).toEqual(Object.keys(MODULES_ALLOWED_TO_IMPORT_SDK_VALUES).sort());
  });

  it.each(serverSourceFiles(join(SRC, "services")))(
    "%s calls the SDK only through upstreamCall",
    (path) => {
      const source = withoutComments(readSource(path));
      for (const name of importedSdkValues(source)) {
        const calls = count(source, new RegExp(`\\b${name}\\(`, "g"));
        const throughServiceCall = count(
          source,
          new RegExp(`\\(signal\\)\\s*=>\\s*${name}\\(`, "g")
        );
        expect({ name, calls }).toEqual({ name, calls: throughServiceCall });
      }
    }
  );

  it("throws plain errors only from the listed startup invariants", () => {
    expect(modulesMatching((source) => /\bnew Error\(/.test(source))).toEqual(
      Object.keys(MODULES_ALLOWED_TO_THROW_PLAIN_ERRORS).sort()
    );
  });

  it("turns a failure into a default value only where listed", () => {
    const defaulting = /\.catch\(\(\)\s*=>\s*(undefined|null|\[\]|\{\})\s*\)/;

    expect(modulesMatching((source) => defaulting.test(source))).toEqual(
      Object.keys(MODULES_ALLOWED_TO_DEFAULT_ON_FAILURE).sort()
    );
  });
});
