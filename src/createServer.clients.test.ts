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
import {
  ResourceListChangedNotificationSchema,
  type Tool,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ClientApps } from "./clientApps";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";

vi.mock("./services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/search/searchService")>()),
  fetchPOICategories: async () => ({ poiCategories: [{ id: 9379, name: "Bar" }] }),
}));

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
async function connect(
  name: string,
  options: ClientOptions = {},
  clientApps?: ClientApps
): Promise<Client> {
  const server = await createServer(clientApps);
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
    const poiCategories = async (client: Client) => {
      const result = await client.callTool({
        name: "tomtom-poi-categories",
        arguments: { filters: ["bar"] },
      });
      await client.close();
      const [content] = result.content as Array<{ type: string; text: string }>;
      return JSON.parse(content.text);
    };

    expect(await poiCategories(await connect("claude-ai", APPS_CLIENT))).toHaveProperty("_meta");
    const textOnly = await poiCategories(await connect("claude-code"));
    expect(textOnly).not.toHaveProperty("_meta");
    expect(textOnly).toHaveProperty("poiCategories");
  });

  it("tells a text-only client of the change once for each list", async () => {
    const server = await createServer();
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    const heard: string[] = [];
    client.setNotificationHandler(ToolListChangedNotificationSchema, (n) => {
      heard.push(n.method);
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, (n) => {
      heard.push(n.method);
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await client.listTools();
    await client.close();

    expect(heard.sort()).toEqual([
      "notifications/resources/list_changed",
      "notifications/tools/list_changed",
    ]);
  });

  it("follows what the caller already knows over the client's initialize", async () => {
    const textOnly = await connect("claude-ai", APPS_CLIENT, "text-only");
    const textOnlyTools = (await textOnly.listTools()).tools;
    await textOnly.close();
    const apps = await connect("claude-code", {}, "apps");
    const appsTools = (await apps.listTools()).tools;
    await apps.close();

    expect(withShowUi(textOnlyTools)).toEqual([]);
    expect(names(appsTools)).toEqual(expect.arrayContaining(UI_ONLY_TOOLS));
  });

  it("logs every client, its choice included", async () => {
    const info = vi.spyOn(logger, "info");
    const client = await connect("some-agent", {}, "text-only");
    await client.close();

    expect(info).toHaveBeenCalledWith(
      { client: { name: "some-agent", version: "1.0.0" }, apps: "text-only", appsChosen: true },
      "Client initialized"
    );
    info.mockRestore();
  });
});
