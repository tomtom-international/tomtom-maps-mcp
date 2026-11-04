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
import {
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type ToolCallOutcome, withRecordedOutcome } from "../../handlers/shared/toolCallOutcome";
import type { ErrorKindName } from "../../types/types";
import { logger } from "../../utils/logger";
import { mcpRequestHandler, registeredInputShape } from "../mcpSdkPrivateFields";
import { type InputShape, inputUsage, invalidInputs } from "./inputUsage";

// The MCP SDK answers these itself, as a tool result carrying its McpError's message
const SDK_REJECTIONS: ReadonlyArray<[RegExp, ErrorKindName]> = [
  [/^MCP error -32602: Input validation error/, "IncorrectError"],
  [/^MCP error -32602: Tool .* not found$/, "NotFoundError"],
];
const NAMEABLE_TOOL = /^[A-Za-z0-9_-]{1,64}$/;
const UNNAMEABLE_TOOL = "<other>";

interface ResultSizes {
  resultBytes: number;
  appBytes: number;
}

export function logToolCalls(server: McpServer): void {
  const callTool = mcpRequestHandler(server, CallToolRequestSchema.shape.method.value);
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const started = performance.now();
    const { name, arguments: rawArguments } = request.params;
    const shape = registeredInputShape(server, name);
    const log = (outcome: ToolCallOutcome, sizes?: ResultSizes) =>
      logAt(outcome)(
        {
          tool: NAMEABLE_TOOL.test(name) ? name : UNNAMEABLE_TOOL,
          ...outcome,
          ...(shape && inputFields(shape, rawArguments)),
          ...sizes,
          durationMs: Math.round(performance.now() - started),
        },
        "Tool called"
      );
    try {
      const { result, outcome } = await withRecordedOutcome(() => callTool(request, extra));
      const toolResult = CallToolResultSchema.parse(result);
      log(outcome ?? unrecordedOutcome(toolResult), resultSizes(toolResult));
      return result;
    } catch (error) {
      log({ outcome: "tool_error", errorKind: "UnknownError", error: String(error) });
      throw error;
    }
  });
}

function unrecordedOutcome({ isError, content }: CallToolResult): ToolCallOutcome {
  if (!isError) return { outcome: "ok" };
  const text = content[0]?.type === "text" ? content[0].text : "";
  const rejection = SDK_REJECTIONS.find(([message]) => message.test(text));
  return { outcome: "tool_error", errorKind: rejection?.[1] ?? "UnknownError" };
}

function inputFields(shape: InputShape, rawArguments: unknown) {
  const rejected = invalidInputs(shape, rawArguments);
  return {
    ...inputUsage(shape, rawArguments),
    ...(rejected.length > 0 && { invalidInputs: rejected }),
  };
}

function resultSizes({ content, structuredContent, _meta }: CallToolResult): ResultSizes {
  return {
    resultBytes: Buffer.byteLength(JSON.stringify({ content, structuredContent })),
    appBytes: _meta === undefined ? 0 : Buffer.byteLength(JSON.stringify(_meta)),
  };
}

function logAt(outcome: ToolCallOutcome) {
  if (outcome.outcome !== "tool_error" && outcome.outcome !== "upstream_error") return logger.info;
  return outcome.errorKind === "IncorrectError" ? logger.warn : logger.error;
}
