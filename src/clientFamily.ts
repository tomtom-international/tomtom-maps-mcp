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

// Names are set in each client's source and undocumented; these are the ones seen in production logs.
export function classifyClientFamily(client: Implementation | undefined): ClientFamily {
  if (!client?.name) return "unknown";
  const name = client.name.toLowerCase();
  if (name.startsWith("claude-code")) return "claude-code";
  if (name === "anthropic/claudeai" || name.startsWith("claude-ai")) return "claude-ai";
  if (name.startsWith("openai-mcp")) return name.includes("codex") ? "codex" : "chatgpt";
  if (name.startsWith("codex-mcp-client")) return "codex";
  return "other";
}
