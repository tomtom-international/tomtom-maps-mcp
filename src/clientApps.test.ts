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

import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { describe, expect, it } from "vitest";
import { isTextOnlySession, rendersApps, textOnlySessionId, withoutAppMeta } from "./clientApps";

const APPS = { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } };
const client = (name: string) => ({ name, version: "1.0.0" });

describe("rendersApps", () => {
  it("is true for a client that advertises MCP Apps, whatever its name", () => {
    expect(rendersApps(APPS, client("claude-ai"))).toBe(true);
    expect(rendersApps(APPS, client("claude-code"))).toBe(true);
  });

  it("is false for a known text-only client without the extension", () => {
    expect(rendersApps({ roots: { listChanged: true } }, client("claude-code"))).toBe(false);
  });

  it("is undefined for any other client without the extension, which may still render apps", () => {
    expect(rendersApps({}, client("mcp"))).toBeUndefined();
    expect(rendersApps({}, undefined)).toBeUndefined();
  });

  it("needs the app HTML profile among the extension's mimeTypes", () => {
    const otherProfile = { extensions: { [EXTENSION_ID]: { mimeTypes: ["text/html"] } } };
    expect(rendersApps(otherProfile, client("le-chat"))).toBeUndefined();
  });
});

describe("text-only session", () => {
  it("recognises only the session IDs it issued", () => {
    expect(isTextOnlySession(textOnlySessionId())).toBe(true);
    expect(isTextOnlySession(undefined)).toBe(false);
    expect(isTextOnlySession("3f1c9a2e-0000-4000-8000-000000000000")).toBe(false);
  });

  it("issues a new visible-ASCII ID each time", () => {
    const id = textOnlySessionId();
    expect(id).toMatch(/^[\x21-\x7E]+$/);
    expect(textOnlySessionId()).not.toBe(id);
  });
});

describe("withoutAppMeta", () => {
  it("drops _meta from a JSON text result and keeps the data", () => {
    const result = withoutAppMeta({
      content: [{ type: "text", text: '{"a":1,"_meta":{"show_ui":false}}' }],
    });
    expect(result.content).toEqual([{ type: "text", text: '{"a":1}' }]);
  });

  it("keeps text that isn't a JSON object, such as an error message", () => {
    const text = 'Error: "_meta" is not here';
    expect(withoutAppMeta({ content: [{ type: "text", text }], isError: true })).toEqual({
      content: [{ type: "text", text }],
      isError: true,
    });
  });
});
