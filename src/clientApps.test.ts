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
import { appsOverride, classifyClient, clientForLog, withoutAppMeta } from "./clientApps";
import { APP_DATA_META_KEY } from "./constants";

const APPS = { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } };
const client = (name: string) => ({ name, version: "1.0.0" });

describe("classifyClient", () => {
  it("is apps for a client that advertises MCP Apps, whatever its name", () => {
    expect(classifyClient(APPS, client("claude-ai"))).toBe("apps");
    expect(classifyClient(APPS, client("claude-code"))).toBe("apps");
  });

  it("is text-only for a known text-only client without the extension, whatever its casing", () => {
    expect(classifyClient({ roots: { listChanged: true } }, client("claude-code"))).toBe(
      "text-only"
    );
    expect(classifyClient({}, client("Roo Code"))).toBe("text-only");
    expect(classifyClient({}, client("CLINE"))).toBe("text-only");
  });

  it("is unknown for any other client without the extension, which may still render apps", () => {
    expect(classifyClient({}, client("mcp"))).toBe("unknown");
    expect(classifyClient({}, client("codex-mcp-client"))).toBe("unknown");
    expect(classifyClient({}, undefined)).toBe("unknown");
  });

  it("needs the app HTML profile among the extension's mimeTypes", () => {
    const otherProfile = { extensions: { [EXTENSION_ID]: { mimeTypes: ["text/html"] } } };
    expect(classifyClient(otherProfile, client("le-chat"))).toBe("unknown");
  });
});

describe("appsOverride", () => {
  it("reads only true and false", () => {
    expect(appsOverride("true")).toBe("apps");
    expect(appsOverride("false")).toBe("text-only");
    expect(appsOverride(undefined)).toBeUndefined();
    expect(appsOverride("0")).toBeUndefined();
    expect(appsOverride(["false", "true"])).toBeUndefined();
  });
});

describe("clientForLog", () => {
  it("keeps only the name and version", () => {
    const info = {
      ...client("some-host"),
      description: "A host",
      icons: [{ src: "data:image/png;base64,AAAA" }],
    };
    expect(clientForLog(info)).toEqual(client("some-host"));
    expect(clientForLog(undefined)).toBeUndefined();
  });
});

describe("withoutAppMeta", () => {
  it("drops _meta from a JSON text result and keeps the data", () => {
    const result = withoutAppMeta({
      content: [{ type: "text", text: '{"a":1,"_meta":{"show_ui":false}}' }],
    });
    expect(result.content).toEqual([{ type: "text", text: '{"a":1}' }]);
  });

  it("drops the result's _meta, where the app data travels", () => {
    const result = withoutAppMeta({
      content: [{ type: "text", text: '{"a":1}' }],
      _meta: { [APP_DATA_META_KEY]: "H4sI" },
    });
    expect(result).toEqual({ content: [{ type: "text", text: '{"a":1}' }] });
  });

  it("keeps text that isn't a JSON object, such as an error message", () => {
    const text = 'Error: "_meta" is not here';
    expect(withoutAppMeta({ content: [{ type: "text", text }], isError: true })).toEqual({
      content: [{ type: "text", text }],
      isError: true,
    });
  });

  it("keeps JSON text that isn't an object", () => {
    for (const text of ['["_meta"]', '"_meta"']) {
      expect(withoutAppMeta({ content: [{ type: "text", text }] }).content).toEqual([
        { type: "text", text },
      ]);
    }
  });

  it("keeps content that isn't text", () => {
    const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
    expect(withoutAppMeta({ content: [image] }).content).toEqual([image]);
  });
});
