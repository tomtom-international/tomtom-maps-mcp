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
 * End-to-end wiring check with NOTHING mocked: boots a real `McpServer` through
 * the real registry and asserts the tool surface the client would see.
 *
 * `createServer.test.ts` mocks `registerTools`, and `register.test.ts` mocks the
 * MCP SDK — so between them nobody proves the two halves fit together. This does,
 * and it needs no API key (the key is only read when a tool actually runs).
 */

import { describe, expect, it } from "vitest";
import { createServer } from "./createServer";
import { DEFAULT_TOOLS, TOOL_ENTRIES } from "./tools/tool-registry";

/** The SDK keeps its registrations on a private field; this is the only way in. */
const registeredNames = (server: unknown): string[] =>
  Object.keys((server as { _registeredTools: Record<string, unknown> })._registeredTools);

describe("createServer wiring", () => {
  it("registers every registry row against a real McpServer", async () => {
    const server = await createServer();

    expect(registeredNames(server).sort()).toEqual(TOOL_ENTRIES.map((e) => e.name).sort());
  });

  it("exposes the expected agent-visible tool surface", async () => {
    const server = await createServer();
    // Derived from the registry, not guessed from the name. A `tomtom-get-*`
    // prefix heuristic used to stand in for "app-internal" and silently swallowed
    // `tomtom-get-traffic` when that tool arrived.
    const appOnly = new Set(
      TOOL_ENTRIES.filter((entry) => entry.visibility === "app").map((entry) => entry.name)
    );
    const agentVisible = registeredNames(server)
      .filter((name) => !appOnly.has(name))
      .sort();

    // Spelled out rather than derived, so a tool silently appearing in or
    // vanishing from the model's surface shows up as a diff in review.
    expect(agentVisible).toEqual([
      "tomtom-data-viz",
      "tomtom-discover-places",
      "tomtom-dynamic-map",
      "tomtom-find-reachable-areas",
      "tomtom-get-traffic",
      "tomtom-locate-place",
      "tomtom-plan-route",
      "tomtom-poi-categories",
      "tomtom-reverse-geocode",
    ]);
    expect(agentVisible).toHaveLength(DEFAULT_TOOLS.length);
  });
});
