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
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "../createServer";
import { logger } from "../utils/logger";
import {
  answerRetiredTools,
  RETIRED_TOOLS,
  type RetiredTool,
  retiredToolError,
} from "./retiredTools";
import TOOL_NAMES from "./toolNames.json";

vi.mock("../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/search/searchService")>()),
  fetchPOICategories: async () => ({ poiCategories: [{ id: 9379, name: "Bar" }] }),
}));

const APPS_CLIENT: ClientOptions = {
  capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } },
};

async function connect(name: string, options: ClientOptions = APPS_CLIENT): Promise<Client> {
  const server = await createServer();
  const client = new Client({ name, version: "1.0.0" }, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** Every tool the server registers: a client that renders apps is listed the app-only tools too. */
async function registeredNames(): Promise<string[]> {
  const client = await connect("claude-ai");
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

const errorPayload = (result: unknown) =>
  JSON.parse(((result as CallToolResult).content[0] as { text: string }).text);

const retired = [...RETIRED_TOOLS.keys()];

describe("RETIRED_TOOLS", () => {
  let registered: string[];
  beforeAll(async () => {
    registered = await registeredNames();
  });

  it("never retires a tool the server registers", () => {
    expect(retired.filter((name) => registered.includes(name))).toEqual([]);
  });

  it.each([...RETIRED_TOOLS])(
    "points %s only at tools the server registers",
    (_, { replacedBy }) => {
      expect(replacedBy.filter((tool) => !registered.includes(tool))).toEqual([]);
    }
  );

  it.each([...RETIRED_TOOLS])(
    "names %s and each of its replacements in its message",
    (name, { message, replacedBy }) => {
      for (const tool of [name, ...replacedBy]) expect(message).toContain(tool);
    }
  );

  it.each([...RETIRED_TOOLS])(
    "records the release that last listed %s as a version",
    (_, { lastRelease }) => {
      expect(lastRelease).toMatch(/^\d+\.\d+\.\d+$/);
    }
  );
});

describe("toolNames.json", () => {
  let registered: string[];
  beforeAll(async () => {
    registered = await registeredNames();
  });

  it("is sorted, without duplicates", () => {
    expect(TOOL_NAMES).toEqual([...new Set(TOOL_NAMES)].sort());
  });

  it("holds every tool the server registers", () => {
    const missing = registered.filter((name) => !TOOL_NAMES.includes(name));
    expect(missing, "Add each new tool's name to src/tools/toolNames.json").toEqual([]);
  });

  it("holds every retired tool", () => {
    expect(retired.filter((name) => !TOOL_NAMES.includes(name))).toEqual([]);
  });

  it("retires every name the server no longer registers", () => {
    const gone = TOOL_NAMES.filter(
      (name) => !registered.includes(name) && !RETIRED_TOOLS.has(name)
    );
    expect(
      gone,
      "Add each renamed or removed tool to RETIRED_TOOLS in src/tools/retiredTools.ts (CODING_GUIDELINES.md § 7)"
    ).toEqual([]);
  });
});

describe("a call to a retired tool", () => {
  it("is answered with an error naming the tools to call instead", async () => {
    const client = await connect("claude-ai");
    const result = await client.callTool({ name: "tomtom-static-map", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect(errorPayload(result)).toEqual({
      error: RETIRED_TOOLS.get("tomtom-static-map")?.message,
      details: {
        tool: "tomtom-static-map",
        lastRelease: "1.6.10",
        replacedBy: ["tomtom-dynamic-map"],
      },
    });
  });

  it("is answered whatever its arguments, since the retired tool's schema is gone", async () => {
    const client = await connect("claude-ai");
    const result = await client.callTool({
      name: "tomtom-waypoint-routing",
      arguments: { waypoints: [[4.9, 52.37], 52.52] },
    });
    await client.close();

    expect(errorPayload(result).details.replacedBy).toEqual(["tomtom-plan-route"]);
  });

  it("is answered for a text-only client too, naming only the replacements it is offered", async () => {
    const client = await connect("claude-code", { capabilities: {} });
    const result = await client.callTool({ name: "tomtom-static-map", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    const { error, details } = errorPayload(result);
    expect(details.replacedBy).toEqual([]);
    expect(error).toMatch(/This client isn't offered tomtom-dynamic-map\.$/);
  });

  it("is logged with the tool and the client, to tell when its entry can go", async () => {
    const warn = vi.spyOn(logger, "warn");
    const client = await connect("claude-ai");
    await client.callTool({ name: "tomtom-reachable-range", arguments: {} });
    await client.close();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-reachable-range", client: "claude-ai" }),
      "Retired tool called"
    );
  });

  it("is not listed", async () => {
    expect((await registeredNames()).filter((name) => RETIRED_TOOLS.has(name))).toEqual([]);
  });
});

describe("answerRetiredTools", () => {
  it("leaves a registered tool to run", async () => {
    const client = await connect("claude-ai");
    const result = await client.callTool({
      name: "tomtom-poi-categories",
      arguments: { filters: ["bar"] },
    });
    await client.close();

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("Bar");
  });

  it("leaves an unknown name to the SDK, which answers that it was not found", async () => {
    const client = await connect("claude-ai");
    const result = await client.callTool({ name: "tomtom-no-such-tool", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Tool tomtom-no-such-tool not found");
  });

  it("throws on a server that has no tools yet, so a missing SDK handler fails at startup", () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });

    expect(() => answerRetiredTools(server)).toThrow("register the tools first");
  });
});

describe("retiredToolError", () => {
  const retired: RetiredTool = {
    lastRelease: "1.0.0",
    replacedBy: ["tomtom-a", "tomtom-b"],
    message: "tomtom-old was removed. Use tomtom-a and tomtom-b.",
  };

  it("keeps the message and every replacement when the client is offered them all", () => {
    const result = retiredToolError("tomtom-old", retired, new Set(["tomtom-a", "tomtom-b"]));

    expect(errorPayload(result)).toEqual({
      error: retired.message,
      details: { tool: "tomtom-old", lastRelease: "1.0.0", replacedBy: ["tomtom-a", "tomtom-b"] },
    });
  });

  it("drops each replacement the client isn't offered, and names it", () => {
    const { error, details } = errorPayload(
      retiredToolError("tomtom-old", retired, new Set(["tomtom-b"]))
    );

    expect(details.replacedBy).toEqual(["tomtom-b"]);
    expect(error).toBe(`${retired.message} This client isn't offered tomtom-a.`);
  });

  it("leaves an entry with no replacement as it is", () => {
    const none: RetiredTool = { ...retired, replacedBy: [], message: "tomtom-old was removed." };

    expect(errorPayload(retiredToolError("tomtom-old", none, new Set())).error).toBe(none.message);
  });
});
