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
 * also sends stay out: "mcp" (Mistral Le Chat, and any Python client that
 * sets none) and "codex-mcp-client" (the Codex app and CLI).
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
 * From a client's initialize: true if it advertises the MCP Apps extension for
 * app HTML, false if it is a client known to render no apps, otherwise
 * undefined, and such a client keeps every tool.
 */
export function rendersApps(
  capabilities: ClientCapabilities,
  client: Implementation | undefined
): boolean | undefined {
  if (getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) return true;
  return client && TEXT_ONLY_CLIENTS.has(client.name) ? false : undefined;
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
