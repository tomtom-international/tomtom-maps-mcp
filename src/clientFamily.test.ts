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

import { describe, expect, it } from "vitest";
import { classifyClientFamily } from "./clientFamily";

const client = (name: string) => ({ name, version: "1.0.0" });

describe("classifyClientFamily", () => {
  it.each([
    ["Anthropic/ClaudeAI", "claude-ai"],
    ["claude-ai", "claude-ai"],
    ["claude-ai (via mcp-remote 0.1.9)", "claude-ai"],
    ["claude-code", "claude-code"],
    ["openai-mcp", "chatgpt"],
    ["openai-mcp (Codex)", "codex"],
    ["codex-mcp-client", "codex"],
  ])("maps %s to %s", (name, family) => {
    expect(classifyClientFamily(client(name))).toBe(family);
  });

  it("ignores the casing of the name", () => {
    expect(classifyClientFamily(client("CLAUDE-CODE"))).toBe("claude-code");
    expect(classifyClientFamily(client("OpenAI-MCP (codex)"))).toBe("codex");
  });

  it("is other for a client it does not know", () => {
    expect(classifyClientFamily(client("mcp"))).toBe("other");
    expect(classifyClientFamily(client("gemini-cli-mcp-client"))).toBe("other");
    expect(classifyClientFamily(client("claude"))).toBe("other");
  });

  it("is unknown without a client or a name", () => {
    expect(classifyClientFamily(undefined)).toBe("unknown");
    expect(classifyClientFamily(client(""))).toBe("unknown");
  });
});
