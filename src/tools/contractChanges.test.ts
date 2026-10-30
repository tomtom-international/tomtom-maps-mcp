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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "../createServer";
import { logger } from "../utils/logger";
import { isRecord } from "../utils/record";
import { CONTRACT_CHANGES, contractChangeFor } from "./contractChanges";
import { RETIRED_TOOLS } from "./retiredTools";

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

const errorPayload = (result: unknown) =>
  JSON.parse(((result as CallToolResult).content[0] as { text: string }).text);

/** The JSON Schema node at `path`, walking `properties` one segment at a time. */
function schemaAt(schema: unknown, path: string): unknown {
  let current = schema;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !isRecord(current.properties)) return undefined;
    current = current.properties[segment];
  }
  return current;
}

describe("contractChangeFor", () => {
  it("matches a removed input and a string where the input is now a list", () => {
    const match = contractChangeFor("tomtom-traffic", {
      fields: "{incidents{}}",
      categoryFilter: "7,8",
      timeValidityFilter: ["present"],
    });

    expect(match?.inputs).toEqual(["fields", "categoryFilter"]);
    expect(match?.lastRelease).toBe("1.6.11");
  });

  it("leaves a call on the current contract to run", () => {
    expect(
      contractChangeFor("tomtom-traffic", {
        bbox: [-74.02, 40.7, -73.96, 40.8],
        categoryFilter: ["accident"],
        timeValidityFilter: ["present"],
      })
    ).toBeUndefined();
    expect(
      contractChangeFor("tomtom-dynamic-map", { center: { lat: 52.37, lon: 4.9 } })
    ).toBeUndefined();
    expect(contractChangeFor("tomtom-routing", { vehicleHeading: 90 })).toBeUndefined();
  });

  it("matches a nested input the schema no longer accepts", () => {
    expect(
      contractChangeFor("tomtom-dynamic-map", {
        center: { lat: 52.37, lon: 4.9, label: "Home" },
      })?.inputs
    ).toEqual(["center.label"]);
  });
});

describe("CONTRACT_CHANGES", () => {
  let schemas: Map<string, unknown>;

  beforeAll(async () => {
    const client = await connect("claude-ai");
    const { tools } = await client.listTools();
    await client.close();
    schemas = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
  });

  it.each([...CONTRACT_CHANGES])(
    "records %s for a tool the server registers and has not retired",
    (name) => {
      expect(schemas.has(name), "A contract change is for a tool that kept its name").toBe(true);
      expect(
        RETIRED_TOOLS.has(name),
        "Delete this CONTRACT_CHANGES entry. The retired-tool error answers the name"
      ).toBe(false);
    }
  );

  it.each([...CONTRACT_CHANGES])(
    "names %s and each changed input in its message",
    (name, { message, triggers }) => {
      expect(message).toContain(name);
      for (const { path } of triggers) expect(message).toContain(path);
    }
  );

  it.each([...CONTRACT_CHANGES])(
    "records the release that last had %s's previous contract as a version",
    (_, { lastRelease, triggers }) => {
      expect(lastRelease).toMatch(/^\d+\.\d+\.\d+$/);
      expect(triggers.length).toBeGreaterThan(0);
    }
  );

  it.each([...CONTRACT_CHANGES])(
    "points %s only at inputs the current schema agrees with",
    (name, { triggers }) => {
      const schema = schemas.get(name);
      const present = triggers
        .filter((trigger) => trigger.when === "present")
        .map((trigger) => trigger.path);
      const stayed = triggers
        .filter((trigger) => trigger.when === "string")
        .map((trigger) => trigger.path);
      expect(
        present.filter((path) => schemaAt(schema, path) !== undefined),
        "A removed input is still on the schema, so a current call would be rejected"
      ).toEqual([]);
      expect(
        stayed.filter((path) => schemaAt(schema, path) === undefined),
        "A reshaped input is missing from the schema"
      ).toEqual([]);
    }
  );
});

describe("a call on a previous contract", () => {
  it("is answered with the change, and does not run the tool", async () => {
    const warn = vi.spyOn(logger, "warn");
    const client = await connect("claude-ai");
    const result = await client.callTool({
      name: "tomtom-routing",
      arguments: {
        locations: [
          [4.9, 52.37],
          [4.88, 52.36],
        ],
        currentChargeInkWh: 40,
      },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const change = CONTRACT_CHANGES.get("tomtom-routing");
    expect(errorPayload(result)).toEqual({
      error: change?.message,
      details: { tool: "tomtom-routing", lastRelease: "1.6.11", inputs: ["currentChargeInkWh"] },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "tomtom-routing",
        inputs: ["currentChargeInkWh"],
        client: "claude-ai",
      }),
      "Previous tool contract called"
    );
  });

  it("explains a string sent where the input is now a list", async () => {
    const client = await connect("claude-ai");
    const result = await client.callTool({
      name: "tomtom-traffic",
      arguments: { bbox: [-74.02, 40.7, -73.96, 40.8], categoryFilter: "0,7" },
    });
    await client.close();

    expect(errorPayload(result).details.inputs).toEqual(["categoryFilter"]);
    expect(errorPayload(result).error).toContain("list of names");
  });

  it("leaves the tool to the SDK when this client is not offered it", async () => {
    const client = await connect("claude-code", { capabilities: {} });
    const result = await client.callTool({
      name: "tomtom-dynamic-map",
      arguments: { routeInfoDetail: "basic" },
    });
    await client.close();

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Tool tomtom-dynamic-map not found");
  });
});
