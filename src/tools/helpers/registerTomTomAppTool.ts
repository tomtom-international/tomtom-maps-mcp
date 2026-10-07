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
import { type WithoutApps, withoutAppMeta } from "../../clientApps";
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
    handler
  );

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
