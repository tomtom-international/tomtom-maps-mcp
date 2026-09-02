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
 * place `registerAppTool` is called, replacing the per-domain `create*Tools`
 * call sites.
 */

import { RESOURCE_URI_META_KEY, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer, RegisteredResource } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type WithoutApps, withoutAppMeta } from "../clientApps";
import { logger } from "../utils/logger";
import { registerAppResourceFromPath } from "./shared/resource-registry";
import { READ_ONLY_ANNOTATIONS, type ToolEntry } from "./shared/tool-entry";
import { TOOL_REGISTRY } from "./tool-registry";

/**
 * Registers one registry row: its MCP app resource (once per server, as several
 * tools share an app), then the tool itself. Returns what takes the row's app
 * parts away for a client that renders no MCP Apps.
 */
function registerToolEntry(
  server: McpServer,
  entry: ToolEntry,
  registeredApps: Set<string>
): WithoutApps {
  let resource: RegisteredResource | undefined;
  if (entry.app && !registeredApps.has(entry.app.resourceUri)) {
    resource = registerAppResourceFromPath(
      server,
      entry.app.resourceUri,
      entry.app.category,
      entry.app.appName
    );
    registeredApps.add(entry.app.resourceUri);
  }

  const visibility = entry.visibility ?? "agent";

  const tool = registerAppTool(
    server,
    entry.name,
    {
      title: entry.title,
      description: entry.description,
      inputSchema: entry.inputSchema,
      annotations: {
        title: entry.title,
        ...READ_ONLY_ANNOTATIONS,
        openWorldHint: entry.openWorldHint ?? READ_ONLY_ANNOTATIONS.openWorldHint,
      },
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

  const { show_ui, ...dataInputs } = entry.inputSchema;
  const handler = entry.handler as (args: unknown) => Promise<CallToolResult>;
  return () => {
    resource?.remove();
    if (entry.uiOnly || visibility === "app") {
      tool.remove();
      return;
    }
    tool.update<ZodRawShapeCompat, ZodRawShapeCompat>({
      ...(show_ui && { paramsSchema: dataInputs }),
      _meta: {},
      callback: async (args) => withoutAppMeta(await handler(args)),
    });
  };
}

/**
 * Registers every tool in {@link TOOL_REGISTRY} with the server, returning one
 * {@link WithoutApps} per tool.
 */
export function registerTools(server: McpServer): WithoutApps[] {
  logger.debug({ tool_count: TOOL_REGISTRY.length }, "Registering TomTom Maps tools");

  const registeredApps = new Set<string>();
  const withoutApps = TOOL_REGISTRY.map((entry) =>
    registerToolEntry(server, entry, registeredApps)
  );

  logger.debug({ tool_count: TOOL_REGISTRY.length }, "Registered TomTom Maps tools");
  return withoutApps;
}
