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
  insertStops: [{ position: [5.0, 52.2] }],
  curves: true,
  compareWithUsualRoute: true,
  directions: true,
  checkpoints: [{ afterKilometers: 0.1 }],
  categoryFilter: ["accident", "road-closed"],
  timeValidityFilter: ["future"],
  maxResults: 5,
  minPowerKW: 50,
  maxPowerKW: 150,
  connectors: ["IEC62196Type2CCS"],
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

const BOX = [4.85, 52.32, 4.95, 52.38];
const NEARBY = { mode: "nearby", position: AMSTERDAM };
const MAX_DETOUR = {
  mode: "maxDetour",
  locations: [{ position: AMSTERDAM }, { position: UTRECHT }],
  sortBy: "detourTime",
};

/** Each `where` mode input: the same mode without it, then with it. */
/** An area as an earlier result's `resolvedAreas` reports it. */
const AREA = { name: "Utrecht", boundingBox: [5, 52, 5.2, 52.2], boundaryId: "10794339" };

const WHERE_INPUTS: Record<string, [Args, Args]> = {
  "tomtom-locate-place nearby.radiusMeters": [NEARBY, { ...NEARBY, radiusMeters: 2500 }],
  "tomtom-locate-place within.boundingBox": [NEARBY, { mode: "within", boundingBox: BOX }],
  "tomtom-discover-places nearby.radiusMeters": [NEARBY, { ...NEARBY, radiusMeters: 2500 }],
  "tomtom-discover-places within.queries": [
    { mode: "within", boundingBox: BOX },
    { mode: "within", queries: ["Utrecht"] },
  ],
  "tomtom-discover-places within.geometries": [
    { mode: "within", boundingBox: BOX },
    {
      mode: "within",
      geometries: [
        {
          type: "Polygon",
          coordinates: [
            [
              [4.8, 52.3],
              [5, 52.3],
              [5, 52.4],
              [4.8, 52.3],
            ],
          ],
        },
      ],
    },
  ],
  "tomtom-discover-places within.areas": [
    { mode: "within", boundingBox: BOX },
    { mode: "within", areas: [AREA] },
  ],
  "tomtom-discover-places maxDetour.maxDetourTimeSeconds": [
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600 },
    { ...MAX_DETOUR, maxDetourTimeSeconds: 900 },
  ],
  "tomtom-discover-places maxDetour.sortBy": [
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600 },
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600, sortBy: "detourOffset" },
  ],
  "tomtom-get-traffic nearby.radiusMeters": [NEARBY, { ...NEARBY, radiusMeters: 2500 }],
  "tomtom-get-traffic within.areas": [
    { mode: "within", boundingBox: BOX },
    { mode: "within", areas: [AREA] },
  ],
  "tomtom-get-traffic alongRoute.withinMeters": [
    { mode: "alongRoute", locations: MAX_DETOUR.locations },
    { mode: "alongRoute", locations: MAX_DETOUR.locations, withinMeters: 3000 },
  ],
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
  "tomtom-plan-route.curves": "the maps-sdk finds curves in the route geometry the API returns",
  "tomtom-plan-route.directions": "lists the guidance every plan-route request asks for",
};

/** The tools that call no TomTom API, or only to draw: their inputs are checked elsewhere. */
const NOT_API_TOOLS = new Set([
  "tomtom-dynamic-map",
  "tomtom-data-viz",
  "tomtom-get-api-key",
  "tomtom-get-app-config",
  "tomtom-get-app-data",
  "tomtom-report-app-status",
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

  it.each(Object.entries(WHERE_INPUTS))("sends %s", async (id, [base, variant]) => {
    const tool = id.split(" ")[0];
    const before = await requestsFor(tool, { ...BASELINES[tool], where: base });
    const after = await requestsFor(tool, { ...BASELINES[tool], where: variant });
    expect(before.error ?? after.error).toBeUndefined();
    expect(after.requests).not.toEqual(before.requests);
  });
});
