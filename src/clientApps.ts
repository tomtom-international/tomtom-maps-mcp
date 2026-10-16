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

import { getUiCapability, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type {
  CallToolResult,
  ClientCapabilities,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Takes a tool's MCP Apps parts away for a client that renders no MCP Apps: its
 * app resource, and either the whole tool, if it only serves its app, or the
 * data tool's show_ui, its app _meta and the _meta in its result.
 */
export type WithoutApps = () => void;

export const CLIENT_APPS = ["apps", "text-only", "unknown"] as const;

/**
 * Whether a client gets the MCP Apps parts: "apps" if it advertises the
 * extension for app HTML, "text-only" if it is a client known to render no
 * apps (see TEXT_ONLY_CLIENTS), otherwise "unknown", and such a client keeps
 * every tool.
 */
export type ClientApps = (typeof CLIENT_APPS)[number];

/**
 * Clients known to render no MCP Apps, by the lowercased start of the
 * clientInfo.name their sources set, which no vendor documents. 
 */
const TEXT_ONLY_CLIENTS = [
  "claude-code",
  "gemini-cli-mcp-client",
  "cline",
  "zed",
  "goose-cli",
  "continue-client",
  "continue-cli-client",
  "q dev cli",
  "opencode",
  "roo code",
];

function isTextOnlyClient(client: Implementation | undefined): boolean {
  const name = client?.name.toLowerCase();
  return !!name && TEXT_ONLY_CLIENTS.some((known) => name.startsWith(known));
}

/** From a client's initialize. */
export function classifyClient(
  capabilities: ClientCapabilities,
  client: Implementation | undefined
): ClientApps {
  if (getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) return "apps";
  return isTextOnlyClient(client) ? "text-only" : "unknown";
}

/** What to log of a client's clientInfo, which may also carry icons as data: URIs. */
export function clientForLog(client: Implementation | undefined) {
  return client && { name: client.name, version: client.version };
}

/**
 * The client's own choice, from ?apps= on the MCP URL or MCP_APPS: "true" or
 * "false" decides over the client's initialize; anything else leaves it to it.
 */
export function appsOverride(value: unknown): ClientApps | undefined {
  if (value === "true") return "apps";
  if (value === "false") return "text-only";
  return undefined;
}

/**
 * A tool result without the _meta an app reads from the result text (show_ui
 * and the viz_id of the cached data), for a client that runs no app.
 */
export function withoutAppMeta(result: CallToolResult): CallToolResult {
  return {
    ...result,
    content: result.content.map((item) =>
      item.type === "text" ? { ...item, text: dropAppMeta(item.text) } : item
    ),
  };
}

function dropAppMeta(text: string): string {
  if (!text.includes('"_meta"')) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text;
    const { _meta, ...data } = parsed as Record<string, unknown>;
    return JSON.stringify(data);
  } catch {
    return text;
  }
}
