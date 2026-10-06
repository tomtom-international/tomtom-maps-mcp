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
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createServer } from "./createServer";

const UI_ONLY_TOOLS = [
  "tomtom-data-viz",
  "tomtom-dynamic-map",
  "tomtom-get-api-key",
  "tomtom-get-app-config",
  "tomtom-get-viz-data",
];

const APPS_CLIENT: ClientOptions = {
  capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } },
};

/** Connects a client over stdio-like transport, as Claude Desktop or Claude Code do. */
async function connect(name: string, options: ClientOptions = {}): Promise<Client> {
  const server = await createServer();
  const client = new Client({ name, version: "1.0.0" }, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const names = (tools: Tool[]) => tools.map((tool) => tool.name);
const withShowUi = (tools: Tool[]) =>
  names(tools.filter((tool) => tool.inputSchema.properties?.show_ui));
const withAppMeta = (tools: Tool[]) => names(tools.filter((tool) => tool._meta?.ui));

describe("tools by client", () => {
  it("lists every tool, app and show_ui to a client that advertises MCP Apps", async () => {
    const client = await connect("claude-ai", APPS_CLIENT);
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    await client.close();

    expect(names(tools)).toEqual(expect.arrayContaining(UI_ONLY_TOOLS));
    expect(withShowUi(tools)).toContain("tomtom-routing");
    expect(withAppMeta(tools)).toContain("tomtom-routing");
    expect(resources.length).toBeGreaterThan(0);
  });

  it("lists everything to an unknown client without the extension, which may still render apps", async () => {
    const client = await connect("some-host");
    const { tools } = await client.listTools();
    await client.close();

    expect(names(tools)).toEqual(expect.arrayContaining(UI_ONLY_TOOLS));
    expect(withShowUi(tools)).toContain("tomtom-routing");
  });

  it("drops every app part for a known text-only client", async () => {
    const client = await connect("claude-code", { capabilities: { roots: { listChanged: true } } });
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    await client.close();

    expect(names(tools).filter((name) => UI_ONLY_TOOLS.includes(name))).toEqual([]);
    expect(names(tools)).toContain("tomtom-routing");
    expect(withShowUi(tools)).toEqual([]);
    expect(withAppMeta(tools)).toEqual([]);
    expect(resources).toEqual([]);
  });

  it("answers a text-only client without the _meta the apps read", async () => {
    const client = await connect("claude-code");
    const result = await client.callTool({
      name: "tomtom-poi-categories",
      arguments: { filters: ["bar"] },
    });
    await client.close();

    const [content] = result.content as Array<{ type: string; text: string }>;
    expect(content.text).not.toContain("_meta");
    expect(JSON.parse(content.text)).toHaveProperty("poiCategories");
  });
});
