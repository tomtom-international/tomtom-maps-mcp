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
 * Walks the tool registry and registers every row with the MCP server. The one
 * place `registerAppTool` is called, replacing 18 hand-written call sites.
 */

import { RESOURCE_URI_META_KEY, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger";
import { registerAppResourceFromPath } from "./shared/resource-registry";
import { READ_ONLY_ANNOTATIONS, type ToolEntry } from "./shared/tool-entry";
import { TOOL_REGISTRY } from "./tool-registry";

/**
 * Registers one registry row: its MCP app resource (if it has one), then the
 * tool itself.
 */
async function registerToolEntry(server: McpServer, entry: ToolEntry): Promise<void> {
  if (entry.app) {
    await registerAppResourceFromPath(
      server,
      entry.app.resourceUri,
      entry.app.category,
      entry.app.appName
    );
  }

  const visibility = entry.visibility ?? "agent";

  registerAppTool(
    server,
    entry.name,
    {
      title: entry.title,
      description: entry.description,
      inputSchema: entry.inputSchema,
      annotations: { title: entry.title, ...READ_ONLY_ANNOTATIONS },
      _meta: {
        ...(entry.app ? { [RESOURCE_URI_META_KEY]: entry.app.resourceUri } : {}),
        // App-internal tools are hidden from the model; agent tools use the
        // client default (visible to both).
        ...(visibility === "app" ? { ui: { visibility: ["app"] } } : {}),
      },
    },
    // The registry stores handlers with their own param types; `registerAppTool`
    // infers its callback from a generic `ZodRawShape`, so the arity can't be
    // proven at this seam. The registry row is the type guarantee.
    entry.handler as never
  );
}

/**
 * Registers every tool in {@link TOOL_REGISTRY} with the server.
 *
 * Resource registration reads the built app HTML off disk, so rows are handled
 * sequentially — the previous per-domain `create*Tools` functions did the same.
 */
export async function registerTools(server: McpServer): Promise<void> {
  logger.debug({ tool_count: TOOL_REGISTRY.length }, "Registering TomTom Maps tools");

  for (const entry of TOOL_REGISTRY) {
    await registerToolEntry(server, entry);
  }

  logger.debug({ tool_count: TOOL_REGISTRY.length }, "Registered TomTom Maps tools");
}
