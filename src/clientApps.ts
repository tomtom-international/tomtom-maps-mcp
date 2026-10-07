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

import { randomUUID } from "node:crypto";
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

/**
 * The clientInfo names, from each client's source, of clients that render no
 * MCP Apps. A client that doesn't advertise the extension may still render
 * apps, so only these lose the app parts. Names a client that renders apps
 * also sends stay out:
 * - "mcp": Mistral Le Chat renders apps and advertises nothing, and any Python
 *   client that sets no name sends it too.
 * - "codex-mcp-client": every Codex host sends it. Codex passes the extension
 *   on only when its host declares it, so the Codex app gets apps from the
 *   capability, but a host that sends neither may be one that renders them.
 * Such a client can still choose with ?apps=false on the MCP URL, or
 * MCP_APPS=false over stdio.
 */
const TEXT_ONLY_CLIENTS = new Set([
  "claude-code",
  "gemini-cli-mcp-client",
  "Cline",
  "Zed",
  "goose-cli",
  "continue-client",
  "continue-cli-client",
  "Q DEV CLI",
  "opencode",
  "Roo Code",
]);

/**
 * Whether a client gets the MCP Apps parts: "apps" if it advertises the
 * extension for app HTML, "text-only" if it is a client known to render no
 * apps, otherwise "unknown", and such a client keeps every tool.
 */
export type ClientApps = "apps" | "text-only" | "unknown";

/** From a client's initialize. */
export function classifyClient(
  capabilities: ClientCapabilities,
  client: Implementation | undefined
): ClientApps {
  if (getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) return "apps";
  return client && TEXT_ONLY_CLIENTS.has(client.name) ? "text-only" : "unknown";
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

const TEXT_ONLY_SESSION = "text-only-";

/**
 * The HTTP server is stateless, so a request after initialize can't see the
 * client. For a client known to render no apps, initialize returns this
 * Mcp-Session-Id, which a client MUST send on every later request. Other
 * clients get no session, as before.
 */
export function textOnlySessionId(): string {
  return TEXT_ONLY_SESSION + randomUUID();
}

export function isTextOnlySession(sessionId: string | undefined): boolean {
  return sessionId?.startsWith(TEXT_ONLY_SESSION) ?? false;
}
