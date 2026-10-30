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

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { CLIENT_APPS, type ClientApps } from "./clientApps";
import { isOneOf } from "./services/shared/sdkInputs";

/**
 * What a client's initialize decided, carried in the Mcp-Session-Id the
 * client echoes on every later request: the HTTP server keeps no state, and
 * nothing after initialize names the client otherwise.
 */
export interface ClientSession {
  apps: ClientApps;
  clientName: string;
}

export const UNKNOWN_CLIENT = "unknown";
const MAX_CLIENT_LENGTH = 64;
// \p{Cs} matches a lone surrogate, which encodeURIComponent rejects; a valid pair is one code point
const UNSENDABLE_CHARACTERS = /[\p{Cc}\p{Cs}]/u;
const TOKEN_DELIMITER = ".";
const LEGACY_TEXT_ONLY_PREFIX = "text-only-";

export function clientName(client: Implementation | undefined): string {
  // Array.from splits by code point, so the cut never leaves half an emoji
  const name = Array.from(client?.name.trim() ?? "")
    .slice(0, MAX_CLIENT_LENGTH)
    .join("");
  return isClientName(name) ? name : UNKNOWN_CLIENT;
}

function isClientName(name: string): boolean {
  const length = Array.from(name).length;
  return length > 0 && length <= MAX_CLIENT_LENGTH && !UNSENDABLE_CHARACTERS.test(name);
}

// A name may hold spaces, slashes and dots; base64url keeps the id header-safe
// and the dot free for the delimiter.
function encodeClient(client: string): string {
  return Buffer.from(client).toString("base64url");
}

function decodeClient(token: string): string {
  const client = Buffer.from(token, "base64url").toString();
  return encodeClient(client) === token && isClientName(client) ? client : UNKNOWN_CLIENT;
}

/** A new session id: the apps token, the encoded client name, then a UUID. */
export function mintSessionId(session: ClientSession): string {
  return [session.apps, encodeClient(session.clientName), randomUUID()].join(TOKEN_DELIMITER);
}

/** The session behind an Mcp-Session-Id header; unknown on both for an absent or foreign one. */
export function parseSessionId(sessionId: string | undefined): ClientSession {
  if (sessionId?.startsWith(LEGACY_TEXT_ONLY_PREFIX))
    return { apps: "text-only", clientName: UNKNOWN_CLIENT };
  const [apps = "", clientToken = ""] = sessionId?.split(TOKEN_DELIMITER) ?? [];
  return {
    apps: isOneOf(CLIENT_APPS, apps) ? apps : "unknown",
    clientName: decodeClient(clientToken),
  };
}

/**
 * Who made a tool call, for the logs: the client's name from its initialize over
 * stdio, or from the Mcp-Session-Id over stateless HTTP, and its User-Agent.
 */
export function callerForLog(
  server: McpServer,
  extra: { requestInfo?: { headers: Record<string, string | string[] | undefined> } }
) {
  const headers = extra.requestInfo?.headers ?? {};
  const sessionId = headers["mcp-session-id"];
  const initialized = server.server.getClientVersion();
  return {
    client: initialized
      ? clientName(initialized)
      : parseSessionId(typeof sessionId === "string" ? sessionId : undefined).clientName,
    user_agent: headers["user-agent"],
  };
}
