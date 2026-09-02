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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "../createServer";
import { cannedApiResponse } from "../services/shared/cannedApiResponses";
import { type RecordedRequest, recordFetch } from "../services/shared/recordFetch";

// Every input a tool advertises must change the request sent to the TomTom
// API. A schema key the service never maps compiles fine and is dropped
// silently, so this test calls each tool through the real server, once with a
// baseline and once with one input added, and compares the recorded requests.

type Args = Record<string, unknown>;

const AMSTERDAM = [4.9, 52.37];
const UTRECHT = [5.12, 52.09];

/** The arguments every call to a tool starts from. */
const BASELINES: Record<string, Args> = {
  "tomtom-discover-places": { query: "coffee" },
  "tomtom-locate-place": { query: "Amsterdam", queryAs: "place" },
  "tomtom-reverse-geocode": { position: AMSTERDAM },
  "tomtom-poi-categories": {},
  "tomtom-plan-route": { locations: [{ position: AMSTERDAM }, { position: UTRECHT }] },
  "tomtom-get-traffic": { where: { mode: "within", boundingBox: [4.8, 52.3, 4.95, 52.4] } },
};

/** A value for each input, by name; COMPANIONS overrides it for one tool. */
const SAMPLES: Args = {
  query: "Tesla",
  queryAs: "poi",
  where: { mode: "nearby", position: [4.95, 52.35], radiusMeters: 2500 },
  includeGeometry: true,
  locations: [{ position: [4.95, 52.35] }, { position: [5.0, 52.2] }],
  limit: 3,
  language: "nl-NL",
  countries: ["BE"],
  view: "IN",
  position: [4.95, 52.35],
  radius: 2500,
  poiCategories: ["RESTAURANT"],
  heading: 90,
  entityType: "Municipality",
  filters: ["CAFE"],
  routeType: "short",
  travelMode: "car",
  traffic: "historical",
  avoid: ["tollRoads"],
  departAt: "2030-01-01T08:00:00Z",
  arriveAt: "2030-01-01T08:00:00Z",
  maxAlternatives: 2,
  categoryFilter: ["accident", "road-closed"],
  timeValidityFilter: ["future"],
  maxResults: 5,
};

/**
 * Inputs that only make sense with others. `with` goes into both calls, `drop`
 * and `extra` change only the call with the input (another geometry), and
 * `value` replaces the sample.
 */
interface Companion {
  with?: Args;
  drop?: string[];
  extra?: Args;
  value?: unknown;
}
const COMPANIONS: Record<string, Companion> = {
  "tomtom-get-traffic.where": {
    value: { mode: "within", boundingBox: [4.85, 52.32, 4.95, 52.38] },
  },
};

/** Inputs the handler consumes itself: they shape the tool result, not the API request. */
const HANDLER_INPUTS = new Set(["show_ui", "response_detail"]);

/**
 * Inputs that do not change the request, each with the reason. Keep this list
 * short: an input that reaches no API belongs in no tool schema.
 */
const NOT_SENT: Record<string, string> = {
  "tomtom-poi-categories.filters": "filters the downloaded category list",
  "tomtom-get-traffic.maxResults": "the handler caps the incidents it returns",
  "tomtom-locate-place.queryAs": "orders the candidates; both indexes are always searched",
  "tomtom-locate-place.includeGeometry": "keeps every candidate in compact; fetches no boundary",
};

/** The tools that call no TomTom API, or only to draw: their inputs are checked elsewhere. */
const NOT_API_TOOLS = new Set([
  "tomtom-dynamic-map",
  "tomtom-data-viz",
  "tomtom-get-api-key",
  "tomtom-get-app-config",
  "tomtom-get-dataset",
]);

let client: Client;
let tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[];

beforeAll(async () => {
  const server = await createServer();
  client = new Client({ name: "inputs-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await client.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function requestsFor(
  tool: string,
  args: Args
): Promise<{ requests: string[]; error?: string }> {
  const recorded: RecordedRequest[] = recordFetch(cannedApiResponse);
  const result = await client.callTool({ name: tool, arguments: args });
  vi.unstubAllGlobals();
  const text = (result.content as { type: string; text?: string }[])
    .map((c) => c.text ?? "")
    .join("");
  // Routing names the response sections it wants in the Attributes header.
  const requests = recorded.map(({ url, headers, body }) => {
    url.searchParams.delete("key");
    headers.delete("tomtom-api-key");
    const query = [...url.searchParams].sort().join("&");
    return `${url.pathname}?${query} ${[...headers].sort().join("&")} ${body}`;
  });
  return { requests, ...(requests.length === 0 && { error: text.slice(0, 300) }) };
}

function argsFor(tool: string, input: string): { base: Args; variant: Args } {
  const companion = COMPANIONS[`${tool}.${input}`] ?? {};
  const base: Args = { ...BASELINES[tool], ...companion.with };
  const variant: Args = { ...base, ...companion.extra };
  for (const key of companion.drop ?? []) delete variant[key];
  variant[input] = "value" in companion ? companion.value : SAMPLES[input];
  const defined = (args: Args) =>
    Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  return { base: defined(base), variant: defined(variant) };
}

/** Why the input fails to reach the API, or undefined when it does (or needs no check). */
async function checkInput(tool: string, input: string): Promise<string | undefined> {
  const id = `${tool}.${input}`;
  if (HANDLER_INPUTS.has(input)) return undefined;
  if (!(input in SAMPLES) && !(id in COMPANIONS)) return `${id}: no sample value`;

  const { base, variant } = argsFor(tool, input);
  const before = await requestsFor(tool, base);
  if (before.error) return `${id}: baseline sent no request: ${before.error}`;
  const after = await requestsFor(tool, variant);
  const changed = JSON.stringify(before.requests) !== JSON.stringify(after.requests);
  // A cached download sends nothing the second time, which also means not sent.
  if (id in NOT_SENT) {
    return changed && !after.error ? `${id}: listed in NOT_SENT, but sent` : undefined;
  }
  if (after.error) return `${id}: rejected: ${after.error}`;
  return changed ? undefined : `${id}: not sent`;
}

describe("tool inputs reach the API", () => {
  it("covers every tool", () => {
    const names = tools.map((t) => t.name).filter((name) => !NOT_API_TOOLS.has(name));
    expect(names.sort()).toEqual(Object.keys(BASELINES).sort());
  });

  it("lists only inputs a tool advertises", () => {
    const inputs = tools.flatMap((t) =>
      Object.keys(t.inputSchema.properties ?? {}).map((input) => `${t.name}.${input}`)
    );
    const names = new Set(inputs.map((id) => id.split(".")[1]));
    const stale = [
      ...Object.keys(SAMPLES).filter((input) => !names.has(input)),
      ...[...Object.keys(COMPANIONS), ...Object.keys(NOT_SENT)].filter(
        (id) => !inputs.includes(id)
      ),
    ];
    expect(stale).toEqual([]);
  });

  it("changes the request for every input", async () => {
    const problems: string[] = [];
    for (const tool of tools.filter((t) => !NOT_API_TOOLS.has(t.name))) {
      for (const input of Object.keys(tool.inputSchema.properties ?? {})) {
        const problem = await checkInput(tool.name, input);
        if (problem) problems.push(problem);
      }
    }
    expect(problems.join("\n")).toBe("");
  }, 120_000);
});
