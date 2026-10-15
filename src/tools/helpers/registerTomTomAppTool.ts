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

import { RESOURCE_URI_META_KEY, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { callerForLog, type WithoutApps, withoutAppMeta } from "../../clientApps";
import { APP_DATA, type AppData, type WithAppData } from "../../handlers/shared/appData";
import { logger } from "../../utils/logger";
import { registerAppResourceFromPath } from "./resourceRegistry";

/** The handler registerAppTool expects for this input schema. */
type AppToolHandler<Args extends ZodRawShapeCompat> = Parameters<
  typeof registerAppTool<ZodRawShapeCompat, Args>
>[3];

interface TomTomAppTool<Args extends ZodRawShapeCompat> {
  name: string;
  title: string;
  description: string;
  inputSchema: Args;
  /** The app under dist/apps as "<category>/<app>"; it is served as ui://tomtom-<category>/<app>/app.html. */
  app: `${string}/${string}`;
  /** False for tools that read only data bundled with the server. */
  openWorldHint?: boolean;
  /** True for a tool whose result is only its app, which a client without MCP Apps can't use. */
  uiOnly?: boolean;
}

/** The app for every tool whose result is places, routes or a search area. */
export const PLACES_AND_ROUTES_APP = "map/places-and-routes";

/** The app resources each server has registered: several tools share one app. */
const registeredApps = new WeakMap<McpServer, Set<string>>();

type Extra = Parameters<AppToolHandler<ZodRawShapeCompat>>[1];

/** Runs an app tool again for its app data (CONTEXT.md, App data). */
type AppDataRun = (args: unknown, extra: Extra) => Promise<CallToolResult & WithAppData>;

const appDataRuns = new WeakMap<McpServer, Map<string, AppDataRun>>();

/**
 * The full app data of app tool `name` called with `args`, for an app that
 * didn't get it inline. Any replica can answer, since the tool runs again.
 * Rejects an unknown tool or invalid arguments; undefined when the tool failed.
 */
export async function appDataOf(
  server: McpServer,
  name: string,
  args: unknown,
  extra: Extra
): Promise<{ appData?: AppData; result: CallToolResult }> {
  const run = appDataRuns.get(server)?.get(name);
  if (!run) throw new Error(`${name} has no MCP App`);
  const result = await run(args, extra);
  return { appData: result[APP_DATA], result };
}

/** Registers a read-only TomTom tool and, once per server, the MCP app that renders its result. */
export function registerTomTomAppTool<Args extends ZodRawShapeCompat>(
  server: McpServer,
  { name, title, description, inputSchema, app, openWorldHint = true, uiOnly }: TomTomAppTool<Args>,
  handler: AppToolHandler<Args>
): WithoutApps {
  const [category, appName] = app.split("/");
  const resourceUri = `ui://tomtom-${category}/${appName}/app.html`;
  const apps = registeredApps.get(server) ?? new Set<string>();
  registeredApps.set(server, apps);
  const resource = apps.has(resourceUri)
    ? undefined
    : registerAppResourceFromPath(server, resourceUri, category, appName);
  apps.add(resourceUri);
  // The SDK types the callback by a conditional on Args, which stays unresolved here.
  const run = handler as unknown as AppDataRun;
  const appHandler = (async (args: unknown, extra: Extra) =>
    withToolName(server, name, await run(args, extra), extra)) as unknown as AppToolHandler<Args>;
  const tool = registerAppTool<ZodRawShapeCompat, Args>(
    server,
    name,
    {
      title,
      description,
      inputSchema,
      annotations: {
        title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint,
      },
      _meta: { [RESOURCE_URI_META_KEY]: resourceUri },
    },
    appHandler
  );

  const schema = z.object(inputSchema as z.ZodRawShape);
  const runs = appDataRuns.get(server) ?? new Map<string, AppDataRun>();
  appDataRuns.set(server, runs);
  runs.set(name, async (args, extra) => {
    return run(schema.parse({ ...(args as object), show_ui: true }), extra);
  });

  const { show_ui, ...dataInputs } = inputSchema;
  return () => {
    resource?.remove();
    if (uiOnly) {
      tool.remove();
      return;
    }
    tool.update<ZodRawShapeCompat, ZodRawShapeCompat>({
      ...(show_ui && { paramsSchema: dataInputs }),
      _meta: {},
      callback: async (args, extra) => withoutAppMeta(await handler(args, extra)),
    });
  };
}

/**
 * Logs what the app gets, and names the tool in the text's `_meta`, so that an app
 * without its data inline knows which tool to run again for it.
 */
function withToolName(
  server: McpServer,
  name: string,
  result: CallToolResult & WithAppData,
  extra: Extra
): CallToolResult {
  const appData = result[APP_DATA];
  const [first, ...rest] = result.content;
  if (!appData || first?.type !== "text") return result;
  logger.info({ tool: name, ...callerForLog(server, extra), ...appData.report }, "App data");
  const payload = JSON.parse(first.text) as { _meta?: Record<string, unknown> };
  const text = JSON.stringify({ ...payload, _meta: { ...payload._meta, tool: name } });
  return { ...result, content: [{ ...first, text }, ...rest] };
}
