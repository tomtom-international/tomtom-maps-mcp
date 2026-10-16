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

import type { Implementation } from "@modelcontextprotocol/sdk/types.js";

export const CLIENT_FAMILIES = [
  "claude-ai",
  "claude-code",
  "chatgpt",
  "codex",
  "other",
  "unknown",
] as const;

export type ClientFamily = (typeof CLIENT_FAMILIES)[number];

/** A client we recognise by the start of its lowercased clientInfo.name. */
export interface KnownClient {
  name: string;
  family: ClientFamily;
  /** Set for a client known to render no MCP Apps; absent when it may. */
  apps?: "text-only";
}

/**
 * The clients we know, by the names their sources set, which no vendor
 * documents. Family names are the ones seen in production logs; ChatGPT
 * declares itself "openai-mcp (Codex)", the tag naming OpenAI's runtime, not
 * the Codex product. A client that doesn't advertise the MCP Apps extension
 * may still render apps, so only those listed text-only lose the app parts.
 * Names a client that renders apps also sends stay out: "mcp" (Mistral Le
 * Chat, and any Python client that sets no name), and "codex-mcp-client",
 * which every Codex host sends while only some hosts render apps. Such a
 * client can still choose with ?apps=false on the MCP URL, or MCP_APPS=false
 * over stdio.
 */
const KNOWN_CLIENTS: readonly KnownClient[] = [
  { name: "claude-code", family: "claude-code", apps: "text-only" },
  { name: "anthropic/claudeai", family: "claude-ai" },
  { name: "claude-ai", family: "claude-ai" },
  { name: "openai-mcp", family: "chatgpt" },
  { name: "codex-mcp-client", family: "codex" },
  { name: "gemini-cli-mcp-client", family: "other", apps: "text-only" },
  { name: "cline", family: "other", apps: "text-only" },
  { name: "zed", family: "other", apps: "text-only" },
  { name: "goose-cli", family: "other", apps: "text-only" },
  { name: "continue-client", family: "other", apps: "text-only" },
  { name: "continue-cli-client", family: "other", apps: "text-only" },
  { name: "q dev cli", family: "other", apps: "text-only" },
  { name: "opencode", family: "other", apps: "text-only" },
  { name: "roo code", family: "other", apps: "text-only" },
];

/** The table entry for a client's clientInfo, if we know the client. */
export function knownClient(client: Implementation | undefined): KnownClient | undefined {
  const name = client?.name.toLowerCase();
  return name ? KNOWN_CLIENTS.find((known) => name.startsWith(known.name)) : undefined;
}

/** The family of a client: other for a name we don't know, unknown without a name. */
export function classifyClientFamily(client: Implementation | undefined): ClientFamily {
  if (!client?.name) return "unknown";
  return knownClient(client)?.family ?? "other";
}
