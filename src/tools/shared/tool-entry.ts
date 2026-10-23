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
 * The registry entry shape. Deliberately mirrors the agent toolkit's `ToolEntry`
 * (`plugins/agent-toolkit/src/types`) — `description` / `inputSchema` /
 * `execute` / `tags` / `examplePrompts` / `relatedTools` all mean the same thing
 * on both sides — plus the fields MCP needs and the toolkit does not: `title`,
 * `annotations`, `app`, `visibility`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import type { APP_DATA_META_KEY } from "../../constants";
import type { ToolTag } from "../tool-tags";
import type { WithAppData } from "./app-data";

/** MCP tool response content — one or more text parts. */
export interface ToolResponseContent {
  type: "text";
  text: string;
}

/** The MCP `CallToolResult` shape these tools return. */
export interface ToolResponse extends WithAppData {
  content: ToolResponseContent[];
  isError?: boolean;
  _meta?: Record<typeof APP_DATA_META_KEY, string>;
  [key: string]: unknown;
}

/** What the MCP SDK passes a tool callback beside its arguments. */
export type ToolCallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The call a handler answers: the server it runs on, for the app-internal tools. */
export interface ToolCall {
  server: McpServer;
  extra: ToolCallExtra;
}

/**
 * The kind of data a tool produces, which `summarize()` takes too. Same
 * vocabulary as the agent toolkit's `EntryDataKind`, minus the kinds the MCP has
 * no tool for.
 */
export type ToolDataKind = "places" | "routes" | "incidents" | "byod" | "mapState";

/**
 * Which side of the MCP sees a tool. `agent` tools appear to the model; `app`
 * tools are internal plumbing for the MCP app and are hidden from it.
 */
export type ToolVisibility = "agent" | "app";

/** The `src/apps/` directories holding the MCP apps. */
export type ToolAppCategory = "map" | "traffic" | "data-viz";

/** The MCP app that renders this tool's result, if any. */
export interface ToolApp {
  /** Built-app category directory. */
  category: ToolAppCategory;
  /** Built-app directory name, e.g. `places-and-routes`. */
  appName: string;
  /** Resource URI the tool advertises and the app resource is registered under. */
  resourceUri: string;
}

/**
 * One row of the tool registry: everything the MCP needs to register a tool and
 * everything the evals need to exercise it.
 */
export interface ToolEntry {
  /** The MCP tool name the model calls, e.g. `tomtom-discover-places`. */
  name: string;
  /** Human-readable title, shown in clients and mirrored into `annotations.title`. */
  title: string;
  /** The model-facing description. The single most important field for tool selection. */
  description: string;
  /** Zod raw shape — what `registerTool` expects. */
  inputSchema: ZodRawShape;
  /** The handler. */
  handler: (params: never, call: ToolCall) => Promise<ToolResponse>;
  /** What kind of data the tool produces. Absent for non-data tools. */
  kind?: ToolDataKind;
  /** The MCP app rendering this tool's result, if any. */
  app?: ToolApp;
  /** Defaults to `agent`. */
  visibility?: ToolVisibility;
  /** False for tools that read only data bundled with the server. Defaults to true. */
  openWorldHint?: boolean;
  /** True for a tool whose result is only its app, which a client without MCP Apps can't use. */
  uiOnly?: boolean;
  /**
   * True for a tool its app may run again, through `tomtom-get-app-data`, for app data
   * missing from the result. Only for a tool that calls no TomTom API: a re-run would
   * be a second billed request that usage figures can't tell from the first.
   */
  refetch?: boolean;
  /** Categorization, shared vocabulary with the agent toolkit. */
  tags?: readonly ToolTag[];
  /**
   * Example USER PROMPTS that should route to this tool. The single source of
   * truth for the tool-selection eval suite: `evals/scenarios/*.test.ts` reads
   * these via `getDefaultToolPrompts()`, so adding a prompt here adds a test.
   */
  examplePrompts?: readonly string[];
  /** Tools a model often needs alongside this one. */
  relatedTools?: readonly string[];
}

/**
 * Annotations shared by every TomTom tool — all of them are read-only,
 * non-destructive, idempotent lookups against a live API.
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
