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
 * The one eval test that needs NO credentials, and the one most worth having:
 * every registry schema must survive conversion to a JSON Schema the model can
 * be shown. A schema the AI SDK can't convert fails at the first tool call of a
 * credentialed run — after the API spend, and with an error that points at the
 * SDK rather than at the offending schema. This catches it for free.
 */

import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOLS } from "../../src/tools/tool-registry";
import { buildTools } from "./mcp-agent";
import { SPECIFIC_MOCKS } from "./mocks";

describe("buildTools", () => {
  const tools = buildTools("mocked", []);

  it("exposes exactly the model-visible tools", () => {
    expect(Object.keys(tools).sort()).toEqual(DEFAULT_TOOLS.map((e) => e.name).sort());
  });

  it("converts every tool's Zod shape to a valid JSON Schema", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      const jsonSchema = await asSchema(tool.inputSchema).jsonSchema;
      expect(jsonSchema, name).toBeTruthy();
      expect(jsonSchema.type, name).toBe("object");
      // A tool the model can't fill in is a tool it will never call correctly.
      expect(Object.keys(jsonSchema.properties ?? {}).length, name).toBeGreaterThan(0);
    }
  });

  it("carries each tool's real description through to the model", () => {
    for (const entry of DEFAULT_TOOLS) {
      expect(tools[entry.name].description, entry.name).toBe(entry.description);
    }
  });

  it("records every call it executes, and returns the canned mock", async () => {
    const calls: { name: string; output: unknown }[] = [];
    const mocked = buildTools("mocked", calls as never);
    const input = { query: "Dam Square", queryAs: "place" };

    const output = await mocked["tomtom-locate-place"].execute?.(input, {
      toolCallId: "t1",
      messages: [],
    });

    expect(output).toEqual(SPECIFIC_MOCKS["tomtom-locate-place"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("tomtom-locate-place");
  });

  it("falls back to a neutral result for tools without a canned mock", async () => {
    const withoutMock = DEFAULT_TOOLS.map((e) => e.name).filter((n) => !SPECIFIC_MOCKS[n]);
    // If this ever empties, the fallback path is dead and can go.
    for (const name of withoutMock) {
      const output = await buildTools("mocked", [])[name].execute?.(
        {},
        { toolCallId: "t", messages: [] }
      );
      expect(output, name).toEqual({ success: true });
    }
  });
});
