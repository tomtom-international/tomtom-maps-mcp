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

import { gunzipSync } from "node:zlib";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPS_CLIENT, connectInMemory } from "./inMemoryClient";
import { cannedApiResponse } from "./services/shared/cannedApiResponses";
import { recordFetch } from "./services/shared/recordFetch";
import { AMSTERDAM, API_TOOLS, type Args } from "./tools/toolBaselines";

// The wire key the apps read, spelled out so renaming its constant fails here.
const APP_DATA_KEY = "com.tomtom/app-data";

const POINT = {
  type: "Feature",
  geometry: { type: "Point", coordinates: AMSTERDAM },
  properties: {},
};

const ARGUMENTS: Record<string, Args> = {
  ...API_TOOLS,
  "tomtom-dynamic-map": { markers: [{ lat: AMSTERDAM[1], lon: AMSTERDAM[0] }] },
  "tomtom-data-viz": {
    geojson: JSON.stringify({ type: "FeatureCollection", features: [POINT] }),
    layers: [{ type: "markers" }],
  },
};

const INPUT_DRAWN = new Set(["tomtom-traffic"]);

beforeEach(() => {
  recordFetch(cannedApiResponse);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function appTools(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.filter((tool) => tool.inputSchema.properties?.show_ui).map((tool) => tool.name);
}

async function call(client: Client, tool: string, showUi?: boolean): Promise<CallToolResult> {
  const showUiArgument = showUi === undefined ? {} : { show_ui: showUi };
  const result = await client.callTool({
    name: tool,
    arguments: { ...ARGUMENTS[tool], ...showUiArgument },
  });
  return result as CallToolResult;
}

function shape(result: CallToolResult): unknown {
  const [content] = result.content;
  if (result.isError || content?.type !== "text") return { error: result.content };
  const { _meta: textMeta, show_ui, tool } = JSON.parse(content.text);
  if (!result._meta) return { text: { _meta: textMeta, show_ui, tool } };
  const { [APP_DATA_KEY]: data, ...meta } = result._meta;
  const decoded = typeof data === "string" && decodesToObject(data) ? "base64 gzip JSON" : data;
  return {
    text: { _meta: textMeta, show_ui, tool },
    _meta: { ...meta, ...(data !== undefined && { [APP_DATA_KEY]: decoded }) },
  };
}

async function shapes(
  client: Client,
  tools: string[],
  showUi?: boolean
): Promise<Record<string, unknown>> {
  const byTool: Record<string, unknown> = {};
  for (const tool of tools) byTool[tool] = shape(await call(client, tool, showUi));
  return byTool;
}

function expectedForApps(tool: string, showUi: boolean): unknown {
  const draws = showUi && !INPUT_DRAWN.has(tool);
  const named = draws ? { tool } : {};
  return {
    text: { show_ui: showUi, ...named },
    _meta: { show_ui: showUi, ...named, ...(draws && { [APP_DATA_KEY]: "base64 gzip JSON" }) },
  };
}

function decodesToObject(data: string): boolean {
  try {
    const decoded: unknown = JSON.parse(gunzipSync(Buffer.from(data, "base64")).toString());
    return typeof decoded === "object" && decoded !== null;
  } catch {
    return false;
  }
}

describe("app result contract", () => {
  it("has arguments for every tool with an app", async () => {
    const client = await connectInMemory("claude-ai", APPS_CLIENT);
    const tools = await appTools(client);
    await client.close();

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((tool) => !(tool in ARGUMENTS))).toEqual([]);
  });

  it.each([
    ["an apps client", "claude-ai", APPS_CLIENT],
    ["an unknown client", "some-host", undefined],
  ])(
    "gives %s show_ui and the tool on the text, and one result _meta with the app data",
    async (_, name, options) => {
      const client = await connectInMemory(name, options);
      const tools = await appTools(client);
      const actual = await shapes(client, tools, true);
      await client.close();

      const expected = Object.fromEntries(tools.map((tool) => [tool, expectedForApps(tool, true)]));
      expect(tools.length).toBeGreaterThan(0);
      expect(actual).toEqual(expected);
    }
  );

  it("gives an apps client show_ui false and no app data when show_ui is false", async () => {
    const client = await connectInMemory("claude-ai", APPS_CLIENT);
    const tools = await appTools(client);
    const actual = await shapes(client, tools, false);
    await client.close();

    const expected = Object.fromEntries(tools.map((tool) => [tool, expectedForApps(tool, false)]));
    expect(actual).toEqual(expected);
  });

  it("gives a text-only client the bare response, with nothing only an app reads", async () => {
    const appsClient = await connectInMemory("claude-ai", APPS_CLIENT);
    const tools = await appTools(appsClient);
    await appsClient.close();
    const client = await connectInMemory("claude-code");
    const listed = new Set((await client.listTools()).tools.map((tool) => tool.name));
    const textOnlyTools = tools.filter((tool) => listed.has(tool));
    const actual = await shapes(client, textOnlyTools);
    await client.close();

    expect(textOnlyTools.length).toBeGreaterThan(0);
    expect(actual).toEqual(Object.fromEntries(textOnlyTools.map((tool) => [tool, { text: {} }])));
  });
});
