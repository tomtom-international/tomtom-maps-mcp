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
import { z } from "zod";
import type { InputShape } from "./callLog/inputUsage";

// The MCP SDK offers no getters for its tools/call handler or the input shapes of the registered
// tools, so these getters read its private fields to let us log every tool call.

type RequestHandler = (
  request: unknown,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => Promise<ServerResult>;

// Looked up once at startup so a wrapper can run behavior shared by
// every tool call (retired-tool answers, the tool call log) around it
export function mcpRequestHandler(server: McpServer, method: string): RequestHandler {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })
    ._requestHandlers;
  const handler = handlers?.get(method);
  if (!handler) {
    throw new Error("The MCP SDK's tools handlers were not found: register the tools first");
  }
  return handler;
}

export function registeredInputShape(server: McpServer, tool: string): InputShape | undefined {
  const registered = (
    server as unknown as { _registeredTools?: Record<string, { inputSchema?: unknown }> }
  )._registeredTools;
  const schema =
    registered && Object.hasOwn(registered, tool) ? registered[tool].inputSchema : undefined;
  return schema instanceof z.core.$ZodObject ? schema._zod.def.shape : undefined;
}
