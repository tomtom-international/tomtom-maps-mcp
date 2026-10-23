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
import { APP_DATA_META_KEY } from "./constants";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";

vi.mock("./services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/search/searchService")>()),
  fetchPOICategories: async () => ({ poiCategories: [{ id: 9379, name: "Bar" }] }),
  fuzzySearch: async () =>
    (await import("./handlers/shared/__fixtures__")).loadFixture("orbis-fuzzy-search"),
}));

const UI_ONLY_TOOLS = [
  "tomtom-data-viz",
  "tomtom-dynamic-map",
  "tomtom-get-api-key",
  "tomtom-get-app-config",
  "tomtom-get-app-data",
  "tomtom-report-app-status",
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
      return {
        result,
        text: content.text,
        body: JSON.parse(content.text) as Record<string, unknown>,
      };
    };

    const apps = await poiCategories(await connect("claude-ai", APPS_CLIENT));
    expect(apps.body).not.toHaveProperty("_meta");
    expect(apps.result._meta).toEqual({ show_ui: false });
    expect(apps.text).not.toContain('"_meta"');
    const textOnly = await poiCategories(await connect("claude-code"));
    expect(textOnly.result._meta).toBeUndefined();
    expect(textOnly.body).not.toHaveProperty("_meta");
    expect(textOnly.body).toHaveProperty("poiCategories");
  });

  it("sends the app data in the result's _meta to an apps client only", async () => {
    const fuzzySearch = async (client: Client) => {
      const result = await client.callTool({
        name: "tomtom-fuzzy-search",
        arguments: { query: "bar", show_ui: true },
      });
      await client.close();
      return result;
    };

    const apps = await fuzzySearch(await connect("claude-ai", APPS_CLIENT));
    expect(apps._meta?.[APP_DATA_META_KEY]).toEqual(expect.any(String));
    const textOnly = await fuzzySearch(await connect("claude-code"));
    expect(textOnly._meta).toBeUndefined();
    expect(textOnly.content).toHaveLength(1);
  });

  it("names the tool in the one result _meta, and runs tomtom-data-viz again for an app that lacks its data", async () => {
    const warn = vi.spyOn(logger, "warn");
    const client = await connect("claude-ai", APPS_CLIENT);
    const fuzzy = await client.callTool({
      name: "tomtom-fuzzy-search",
      arguments: { query: "bar", show_ui: true },
    });
    const point = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.9, 52.4] },
      properties: {},
    };
    const geojson = JSON.stringify({ type: "FeatureCollection", features: [point] });
    const vizArguments = { geojson, layers: [{ type: "markers" }], show_ui: true };
    await client.callTool({ name: "tomtom-data-viz", arguments: vizArguments });
    const fetched = await client.callTool({
      name: "tomtom-get-app-data",
      arguments: { tool: "tomtom-data-viz", arguments: vizArguments, reason: "not_inline" },
    });
    await client.close();

    const [content] = fuzzy.content as Array<{ type: string; text: string }>;
    expect(content.text).not.toContain('"_meta"');
    expect(fuzzy._meta).toMatchObject({ show_ui: true, tool: "tomtom-fuzzy-search" });
    expect(fuzzy._meta?.[APP_DATA_META_KEY]).toEqual(expect.any(String));
    const wire = JSON.stringify({ content: fuzzy.content, _meta: fuzzy._meta });
    expect(wire.match(/"_meta"/g)).toEqual(['"_meta"']);
    const [data] = fetched.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(data.text).geojson).toEqual(JSON.parse(geojson));
    // It fit inline, so the app lacking it means the host dropped the result's _meta.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "tomtom-data-viz",
        reason: "not_inline",
        delivery: "inline",
      }),
      "App data fetched: host dropped it"
    );
    warn.mockRestore();
  });

  it("never runs a TomTom tool again, and answers an incorrect-input error for arguments tomtom-data-viz rejects", async () => {
    const warn = vi.spyOn(logger, "warn");
    const client = await connect("claude-ai", APPS_CLIENT);
    const fetch = async (tool: string, arguments_: Record<string, unknown>) => {
      const result = await client.callTool({
        name: "tomtom-get-app-data",
        arguments: { tool, arguments: arguments_, reason: "not_inline" },
      });
      const [content] = result.content as Array<{ type: string; text: string }>;
      return { isError: result.isError, payload: JSON.parse(content.text) };
    };

    const tomtomTool = await fetch("tomtom-fuzzy-search", { query: "bar" });
    const noApp = await fetch("tomtom-get-api-key", {});
    const noLayers = await fetch("tomtom-data-viz", {});
    await client.close();

    for (const [result, tool] of [
      [tomtomTool, "tomtom-fuzzy-search"],
      [noApp, "tomtom-get-api-key"],
    ] as const) {
      expect(result).toEqual({
        isError: true,
        payload: {
          error: "The tool doesn't run again for its app data: only tomtom-data-viz does.",
          details: { tool },
        },
      });
    }
    expect(noLayers.isError).toBe(true);
    expect(noLayers.payload.details).toEqual({
      tool: "tomtom-data-viz",
      issues: [expect.objectContaining({ path: "layers" })],
    });
    for (const tool of ["tomtom-fuzzy-search", "tomtom-get-api-key", "tomtom-data-viz"]) {
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ tool, reason: "not_inline", client: "claude-ai" }),
        "App data fetch failed"
      );
    }
    warn.mockRestore();
  });

  // A re-run of a TomTom tool is a second billed request (CONTEXT.md, App data).
  it("runs no tool again for its app data but tomtom-data-viz", async () => {
    const client = await connect("claude-ai", APPS_CLIENT);
    const { tools } = await client.listTools();
    const rerunnable: string[] = [];
    for (const { name } of tools) {
      const result = await client.callTool({
        name: "tomtom-get-app-data",
        arguments: { tool: name, arguments: {}, reason: "not_inline" },
      });
      const [content] = result.content as Array<{ type: string; text: string }>;
      if (!content.text.includes("doesn't run again for its app data")) rerunnable.push(name);
    }
    await client.close();

    expect(tools.length).toBeGreaterThan(10);
    expect(rerunnable).toEqual(["tomtom-data-viz"]);
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
      {
        client: { name: "some-agent", version: "1.0.0" },
        apps: "text-only",
        appsChosen: true,
      },
      "Client initialized"
    );
    info.mockRestore();
  });
});
