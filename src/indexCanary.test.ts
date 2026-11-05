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
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCanary } from "./canary/runCanary";

const logError = vi.hoisted(() => vi.fn());

vi.mock("./canary/runCanary", () => ({ runCanary: vi.fn() }));
vi.mock("./utils/logger", () => ({ logger: { error: logError } }));

async function startCanary(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  await import("./indexCanary");
  await vi.waitFor(() => expect(process.exitCode).toBeDefined());
}

describe("indexCanary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it.each([
    [true, 0],
    [false, 1],
  ])(
    "runs the canary against CANARY_MCP_URL and exits by its verdict (passed %s)",
    async (passed, code) => {
      vi.mocked(runCanary).mockResolvedValue(passed);

      await startCanary({ CANARY_MCP_URL: "https://mcp.test.example/maps", TOMTOM_API_KEY: "key" });

      expect(runCanary).toHaveBeenCalledWith("https://mcp.test.example/maps", "key");
      expect(process.exitCode).toBe(code);
    }
  );

  it("fails before calling anything when CANARY_MCP_URL is not set", async () => {
    await startCanary({ CANARY_MCP_URL: "", TOMTOM_API_KEY: "key" });

    expect(process.exitCode).toBe(1);
    expect(logError).toHaveBeenCalledWith(
      "Canary not started: set CANARY_MCP_URL to the MCP server to check, and TOMTOM_API_KEY to the key it calls with"
    );
  });
});
