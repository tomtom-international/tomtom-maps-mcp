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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
  ServerResult,
} from "@modelcontextprotocol/sdk/types.js";

export type RequestHandler = (
  request: unknown,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => Promise<ServerResult>;

// The MCP SDK's own handler for a method, looked up once at startup so a wrapper can run
// behaviour shared by every tool call (retired-tool answers, the tool call log) around it
export function mcpRequestHandler(server: McpServer, method: string): RequestHandler {
  // The SDK offers no getter for the handlers it installs; `retiredTools.test.ts` fails if it renames them
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })
    ._requestHandlers;
  const handler = handlers?.get(method);
  if (!handler) {
    throw new Error("The MCP SDK's tools handlers were not found: register the tools first");
  }
  return handler;
}
