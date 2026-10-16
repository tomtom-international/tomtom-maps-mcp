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
import { clientName, mintSessionId, parseSessionId } from "./clientSession";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoded = (name: string) => Buffer.from(name).toString("base64url");

describe("clientName", () => {
  it("is the clientInfo.name as sent", () => {
    expect(clientName({ name: "openai-mcp (Codex)", version: "1.0.0" })).toBe("openai-mcp (Codex)");
    expect(clientName({ name: "Anthropic/ClaudeAI", version: "1.0.0" })).toBe("Anthropic/ClaudeAI");
  });

  it("is unknown without a client, a name, or with control characters in it", () => {
    expect(clientName(undefined)).toBe("unknown");
    expect(clientName({ name: "", version: "1.0.0" })).toBe("unknown");
    expect(clientName({ name: "   ", version: "1.0.0" })).toBe("unknown");
    expect(clientName({ name: "bad\nclient", version: "1.0.0" })).toBe("unknown");
  });

  it("keeps the first 64 characters of a long name", () => {
    const name = clientName({ name: "x".repeat(100), version: "1.0.0" });
    expect(name).toBe("x".repeat(64));
  });
});

describe("mintSessionId", () => {
  it("writes the apps token and the encoded client name before a fresh UUID", () => {
    const sessionId = mintSessionId({ apps: "text-only", clientName: "claude-code" });
    expect(sessionId).toMatch(new RegExp(`^text-only\\.${encoded("claude-code")}\\.`));
    expect(sessionId).toMatch(UUID);
    expect(mintSessionId({ apps: "text-only", clientName: "claude-code" })).not.toBe(sessionId);
  });

  it("stays header-safe for a name with spaces, slashes and dots", () => {
    const sessionId = mintSessionId({ apps: "apps", clientName: "openai-mcp (Codex) v1.2/beta" });
    expect(sessionId).toMatch(/^[\x21-\x7E]+$/);
    expect(sessionId.split(".")).toHaveLength(3);
  });
});

describe("parseSessionId", () => {
  it("reads back what was minted, the name exactly", () => {
    for (const client of ["openai-mcp (Codex)", "Anthropic/ClaudeAI", "claude-code", "unknown"]) {
      expect(parseSessionId(mintSessionId({ apps: "apps", clientName: client }))).toEqual({
        apps: "apps",
        clientName: client,
      });
    }
    expect(parseSessionId(mintSessionId({ apps: "unknown", clientName: "mcp" }))).toEqual({
      apps: "unknown",
      clientName: "mcp",
    });
  });

  it("is unknown on both without a session id", () => {
    expect(parseSessionId(undefined)).toEqual({ apps: "unknown", clientName: "unknown" });
    expect(parseSessionId("")).toEqual({ apps: "unknown", clientName: "unknown" });
  });

  it("keeps a text-only session minted before the client token existed", () => {
    expect(parseSessionId("text-only-3f1c9a2e-0000-4000-8000-000000000000")).toEqual({
      apps: "text-only",
      clientName: "unknown",
    });
  });

  it("is unknown for an apps token outside its closed set", () => {
    expect(
      parseSessionId(`widgets.${encoded("chatgpt")}.3f1c9a2e-0000-4000-8000-000000000000`)
    ).toEqual({
      apps: "unknown",
      clientName: "chatgpt",
    });
  });

  it("is unknown for a client token that is not an encoded name", () => {
    expect(parseSessionId("apps.claude-ai.3f1c9a2e-0000-4000-8000-000000000000")).toEqual({
      apps: "apps",
      clientName: "unknown",
    });
    expect(
      parseSessionId(`apps.${encoded("bad\nclient")}.3f1c9a2e-0000-4000-8000-000000000000`)
    ).toEqual({
      apps: "apps",
      clientName: "unknown",
    });
    expect(
      parseSessionId(`apps.${encoded("x".repeat(65))}.3f1c9a2e-0000-4000-8000-000000000000`)
    ).toEqual({
      apps: "apps",
      clientName: "unknown",
    });
    expect(parseSessionId("3f1c9a2e-0000-4000-8000-000000000000")).toEqual({
      apps: "unknown",
      clientName: "unknown",
    });
  });
});
