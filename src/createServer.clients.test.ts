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

import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "./createServer";

const UI_ONLY_TOOLS = [
  "tomtom-data-viz",
  "tomtom-dynamic-map",
  "tomtom-get-api-key",
  "tomtom-get-app-config",
  "tomtom-get-viz-data",
];

async function listTools(options: ClientOptions) {
  const server = await createServer();
  const client = new Client({ name: "test-client", version: "1.0.0" }, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const names = (tools: { name: string }[]) => tools.map((tool) => tool.name);
const withShowUi = (tools: { name: string; inputSchema: { properties?: object } }[]) =>
  tools.filter((tool) => tool.inputSchema.properties && "show_ui" in tool.inputSchema.properties);

describe("tools by client capabilities", () => {
  it("lists every tool, with show_ui, to a client that renders MCP Apps", async () => {
    const tools = await listTools({
      capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } },
    });

    expect(names(tools)).toEqual(expect.arrayContaining(UI_ONLY_TOOLS));
    expect(names(withShowUi(tools))).toContain("tomtom-routing");
  });

  it("drops the map tools, the app-only tools and show_ui for a client without MCP Apps", async () => {
    const tools = await listTools({ capabilities: {} });

    expect(names(tools).filter((name) => UI_ONLY_TOOLS.includes(name))).toEqual([]);
    expect(names(tools)).toContain("tomtom-routing");
    expect(names(withShowUi(tools))).toEqual([]);
  });
});
