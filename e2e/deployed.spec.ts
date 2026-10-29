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

import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { APP_URIS, LISTED_FOR_APPS, LISTED_FOR_TEXT_ONLY, listed } from "../src/appListings";
import { APP_CSP } from "../src/tools/helpers/appCsp";

const MCP_URLS: Record<string, string> = {
  prod: "https://mcp.tomtom.com/maps",
  dev: "https://mcp-dev.api-system.tomtom.com/maps",
};

const TARGET_VARIABLE = "DEPLOYED_TARGET";
const target = process.env[TARGET_VARIABLE] ?? "prod";
const apiKey = process.env.TOMTOM_API_KEY;

const APPS_CLIENT: ClientOptions = {
  capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } },
};

async function connect(query: string, options: ClientOptions = {}): Promise<Client> {
  const mcpUrl = MCP_URLS[target];
  if (!mcpUrl) throw new Error(`${TARGET_VARIABLE} is "${target}"; use one of prod, dev`);
  if (!apiKey) throw new Error("TOMTOM_API_KEY is not set");
  const client = new Client({ name: "tomtom-deployed-probe", version: "1.0.0" }, options);
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}${query}`), {
    requestInit: { headers: { "tomtom-api-key": apiKey } },
  });
  await client.connect(transport);
  return client;
}

test.describe(`${target}: the deployed MCP protocol`, () => {
  test("lists every tool with its app, and every app resource, to an apps client", async () => {
    const client = await connect("?apps=true", APPS_CLIENT);
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    await client.close();

    expect(listed(tools)).toEqual(LISTED_FOR_APPS);
    expect(resources.map((resource) => resource.uri).sort()).toEqual([...APP_URIS].sort());
  });

  test("lists only the usable tools, with no app parts, to a client that asks for no apps", async () => {
    const client = await connect("?apps=false");
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    await client.close();

    expect(listed(tools)).toEqual(LISTED_FOR_TEXT_ONLY);
    expect(resources).toEqual([]);
  });

  test("serves every app as an MCP app with its CSP and a built bundle", async () => {
    const client = await connect("?apps=true", APPS_CLIENT);
    for (const uri of APP_URIS) {
      const { contents } = await client.readResource({ uri });
      expect(contents, uri).toHaveLength(1);
      const { text, ...served } = contents[0] as (typeof contents)[0] & { text?: string };
      expect(served, uri).toEqual({ uri, mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { csp: APP_CSP } } });
      expect(text, uri).toMatch(/^<!doctype html>/i);
    }
    await client.close();
  });
});
