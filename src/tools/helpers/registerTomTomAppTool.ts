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
import { type WithoutApps, withoutAppMeta } from "../../clientApps";
import { callerForLog } from "../../clientSession";
import { APP_DATA, type AppData, type WithAppData } from "../../handlers/shared/appData";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { isRecord } from "../../utils/record";
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
  /**
   * True for a tool its app may run again, through `tomtom-get-app-data`, for app data
   * missing from the result. Only for a tool that calls no TomTom API: a re-run would
   * be a second billed request that usage figures can't tell from the first.
   */
  refetch?: boolean;
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
 * Undefined when the tool failed.
 *
 * @throws {IncorrectError} For a tool not registered with `refetch`, or arguments the tool rejects.
 */
export async function appDataOf(
  server: McpServer,
  name: string,
  args: unknown,
  extra: Extra
): Promise<{ appData?: AppData; result: CallToolResult }> {
  const run = appDataRuns.get(server)?.get(name);
  if (!run) {
    throw new IncorrectError(
      "The tool doesn't run again for its app data: only tomtom-data-viz does.",
      { tool: name }
    );
  }
  const result = await run(args, extra);
  return { appData: result[APP_DATA], result };
}

/** Registers a read-only TomTom tool and, once per server, the MCP app that renders its result. */
export function registerTomTomAppTool<Args extends ZodRawShapeCompat>(
  server: McpServer,
  {
    name,
    title,
    description,
    inputSchema,
    app,
    openWorldHint = true,
    uiOnly,
    refetch,
  }: TomTomAppTool<Args>,
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
    withToolName(
      server,
      name,
      await run(args, extra),
      extra,
      refetch
    )) as unknown as AppToolHandler<Args>;
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

  if (refetch) {
    const schema = z.object(inputSchema as z.ZodRawShape);
    const runs = appDataRuns.get(server) ?? new Map<string, AppDataRun>();
    appDataRuns.set(server, runs);
    runs.set(name, async (args, extra) => {
      const parsed = schema.safeParse({ ...(args as object), show_ui: true });
      if (!parsed.success) {
        throw new IncorrectError("The arguments don't match the tool's input schema.", {
          tool: name,
          issues: parsed.error.issues.map(({ path, message }) => ({
            path: path.join("."),
            message,
          })),
        });
      }
      return run(parsed.data, extra);
    });
  }

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
 * Logs what the app gets, and names the tool in the result's `_meta` and on the text,
 * so a host that drops the result `_meta` still leaves the app a tool to report.
 */
function withToolName(
  server: McpServer,
  name: string,
  result: CallToolResult & WithAppData,
  extra: Extra,
  refetch?: boolean
): CallToolResult {
  const appData = result[APP_DATA];
  if (!appData) return result;
  const fields = { tool: name, ...callerForLog(server, extra), ...appData.report };
  if (appData.report.delivery === "too_large" && !refetch) {
    logger.warn(fields, "App data too large for the result: the app can't draw");
  } else logger.info(fields, "App data");
  const named = { ...result, _meta: { ...result._meta, tool: name } };
  const [first, ...rest] = result.content;
  if (first?.type !== "text") return named;
  try {
    const payload: unknown = JSON.parse(first.text);
    if (!isRecord(payload)) return named;
    const text = JSON.stringify({ ...payload, tool: name });
    return { ...named, content: [{ ...first, text }, ...rest] };
  } catch {
    return named;
  }
}
