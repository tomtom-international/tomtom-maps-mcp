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
 * `execute` / `tags` / `examples` / `examplePrompts` / `relatedTools` /
 * `dependsOn` all mean the same thing on both sides — plus the fields MCP needs
 * and the toolkit does not: `title`, `annotations`, `app`, `visibility`.
 */

import type { ZodRawShape } from "zod";
import type { ToolTag } from "../tool-tags";

/** MCP tool response content — one or more text parts. */
export interface ToolResponseContent {
  type: "text";
  text: string;
}

/** The MCP `CallToolResult` shape these tools return. */
export interface ToolResponse {
  content: ToolResponseContent[];
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * The kind of data a tool produces. Same vocabulary as the agent toolkit's
 * `EntryDataKind`, minus the kinds the MCP has no tool for. Phase 1 uses this to
 * pick a summarizer per kind; phase 0 records it so the registry already carries
 * the information.
 */
export type ToolDataKind = "places" | "routes" | "ranges" | "incidents" | "byod" | "mapState";

/**
 * Which side of the MCP sees a tool. `agent` tools appear to the model; `app`
 * tools are internal plumbing for the MCP app and are hidden from it.
 */
export type ToolVisibility = "agent" | "app";

/** The MCP app that renders this tool's result, if any. */
export interface ToolApp {
  /** Built-app category directory — `search`, `routing`, `traffic`, `map`, `data-viz`. */
  category: string;
  /** Built-app directory name, e.g. `poi-search`. */
  appName: string;
  /** Resource URI the tool advertises and the app resource is registered under. */
  resourceUri: string;
}

/**
 * One row of the tool registry: everything the MCP needs to register a tool and
 * everything the evals need to exercise it.
 */
export interface ToolEntry {
  /** The MCP tool name the model calls, e.g. `tomtom-poi-search`. */
  name: string;
  /** Human-readable title, shown in clients and mirrored into `annotations.title`. */
  title: string;
  /** The model-facing description. The single most important field for tool selection. */
  description: string;
  /** Zod raw shape — what `registerTool` expects. */
  inputSchema: ZodRawShape;
  /** The handler. Built by {@link defineDataTool} for data tools; hand-written for the rest. */
  handler: (params: never) => Promise<ToolResponse>;
  /** What kind of data the tool produces. Absent for non-data tools. */
  kind?: ToolDataKind;
  /** The MCP app rendering this tool's result, if any. */
  app?: ToolApp;
  /** Defaults to `agent`. */
  visibility?: ToolVisibility;
  /** Categorization, shared vocabulary with the agent toolkit. */
  tags?: readonly ToolTag[];
  /**
   * Example CALLS — literal invocations showing correct argument shapes. Not
   * currently injected into descriptions; kept as documentation and as fixtures
   * the eval suite can replay.
   */
  examples?: readonly string[];
  /**
   * Example USER PROMPTS that should route to this tool. The single source of
   * truth for the tool-selection eval suite: `evals/scenarios/*.test.ts` reads
   * these via `getDefaultToolPrompts()`, so adding a prompt here adds a test.
   */
  examplePrompts?: readonly string[];
  /** Tools a model often needs alongside this one. */
  relatedTools?: readonly string[];
  /** Tools that MUST run before this one (e.g. `tomtom-poi-categories`). */
  dependsOn?: readonly string[];
}

/**
 * Annotations shared by every TomTom tool — all of them are read-only,
 * non-destructive, idempotent lookups against a live API. Previously repeated
 * verbatim in all 18 `registerAppTool` call sites.
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
