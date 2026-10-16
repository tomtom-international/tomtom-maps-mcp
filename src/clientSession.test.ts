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
import { mintSessionId, parseSessionId } from "./clientSession";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("mintSessionId", () => {
  it("writes the apps and family tokens before a fresh UUID", () => {
    const sessionId = mintSessionId({ apps: "text-only", family: "claude-code" });
    expect(sessionId).toMatch(/^text-only\.claude-code\./);
    expect(sessionId).toMatch(UUID);
    expect(sessionId).toMatch(/^[\x21-\x7E]+$/);
    expect(mintSessionId({ apps: "text-only", family: "claude-code" })).not.toBe(sessionId);
  });
});

describe("parseSessionId", () => {
  it("reads back what was minted", () => {
    expect(parseSessionId(mintSessionId({ apps: "apps", family: "chatgpt" }))).toEqual({
      apps: "apps",
      family: "chatgpt",
    });
    expect(parseSessionId(mintSessionId({ apps: "unknown", family: "other" }))).toEqual({
      apps: "unknown",
      family: "other",
    });
  });

  it("is unknown on both without a session id", () => {
    expect(parseSessionId(undefined)).toEqual({ apps: "unknown", family: "unknown" });
    expect(parseSessionId("")).toEqual({ apps: "unknown", family: "unknown" });
  });

  it("keeps a text-only session minted before the family token existed", () => {
    expect(parseSessionId("text-only-3f1c9a2e-0000-4000-8000-000000000000")).toEqual({
      apps: "text-only",
      family: "unknown",
    });
  });

  it("is unknown for a token outside its closed set", () => {
    expect(parseSessionId("widgets.chatgpt.3f1c9a2e-0000-4000-8000-000000000000")).toEqual({
      apps: "unknown",
      family: "chatgpt",
    });
    expect(parseSessionId("apps.copilot.3f1c9a2e-0000-4000-8000-000000000000")).toEqual({
      apps: "apps",
      family: "unknown",
    });
    expect(parseSessionId("3f1c9a2e-0000-4000-8000-000000000000")).toEqual({
      apps: "unknown",
      family: "unknown",
    });
  });
});
