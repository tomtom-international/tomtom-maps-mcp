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

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectInMemory } from "../inMemoryClient";
import { cannedApiResponse } from "../services/shared/cannedApiResponses";
import { type RecordedRequest, recordFetch } from "../services/shared/recordFetch";
import { AMSTERDAM, API_TOOLS, NOT_API_TOOLS, type ToolArguments } from "./toolBaselines";

// Every input a tool advertises must change the request sent to the TomTom
// API. A schema key the service never maps compiles fine and is dropped
// silently, so this test calls each tool through the real server, once with a
// baseline and once with one input added, and compares the recorded requests.

const UTRECHT = [5.12, 52.09];

/** A value for each input, by name; COMPANIONS overrides it for one tool. */
const SAMPLES: ToolArguments = {
  query: "Tesla",
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
  with?: ToolArguments;
  drop?: string[];
  extra?: ToolArguments;
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
const ALONG_ROUTE = { mode: "alongRoute", locations: MAX_DETOUR.locations };
const HALF_WAY = { to: 50, unit: "percent" };

/** An area as an earlier result's `resolvedAreas` reports it. */
const AREA = { name: "Utrecht", boundingBox: [5, 52, 5.2, 52.2] };

/** A triangle near Utrecht, clear of `BOX`, so a union of the two differs from either. */
const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [5.05, 52.05],
      [5.15, 52.05],
      [5.1, 52.12],
      [5.05, 52.05],
    ],
  ],
};

const WITHIN_BOX = { mode: "within", boundingBox: BOX };
const WITHIN_POLYGON = { mode: "within", geometries: [POLYGON] };
const NEARBY_QUERY = { mode: "nearby", query: "Dam Square, Amsterdam" };

/**
 * Each `where` mode input: the same mode without it, then with it. `within` needs
 * one area field, so each is added to another; a `nearby` query takes the place of
 * the position.
 */
const WHERE_INPUTS: Record<string, [ToolArguments, ToolArguments]> = {
  "tomtom-locate-place nearby.radiusMeters": [NEARBY, { ...NEARBY, radiusMeters: 2500 }],
  "tomtom-locate-place nearby.query": [NEARBY, NEARBY_QUERY],
  "tomtom-locate-place within.boundingBox": [
    WITHIN_POLYGON,
    { ...WITHIN_POLYGON, boundingBox: BOX },
  ],
  "tomtom-locate-place within.queries": [WITHIN_BOX, { ...WITHIN_BOX, queries: ["Utrecht"] }],
  "tomtom-discover-places nearby.radiusMeters": [NEARBY, { ...NEARBY, radiusMeters: 2500 }],
  "tomtom-discover-places nearby.query": [NEARBY, NEARBY_QUERY],
  "tomtom-discover-places within.boundingBox": [
    WITHIN_POLYGON,
    { ...WITHIN_POLYGON, boundingBox: BOX },
  ],
  "tomtom-discover-places within.queries": [WITHIN_BOX, { ...WITHIN_BOX, queries: ["Utrecht"] }],
  "tomtom-discover-places within.geometries": [
    WITHIN_BOX,
    { ...WITHIN_BOX, geometries: [POLYGON] },
  ],
  "tomtom-discover-places within.areas": [WITHIN_BOX, { ...WITHIN_BOX, areas: [AREA] }],
  "tomtom-discover-places maxDetour.maxDetourTimeSeconds": [
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600 },
    { ...MAX_DETOUR, maxDetourTimeSeconds: 900 },
  ],
  "tomtom-discover-places maxDetour.sortBy": [
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600 },
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600, sortBy: "detourOffset" },
  ],
  "tomtom-discover-places maxDetour.stretch": [
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600 },
    { ...MAX_DETOUR, maxDetourTimeSeconds: 600, stretch: HALF_WAY },
  ],
  "tomtom-discover-places alongRoute.withinMeters": [
    ALONG_ROUTE,
    { ...ALONG_ROUTE, withinMeters: 3000 },
  ],
  "tomtom-discover-places alongRoute.stretch": [ALONG_ROUTE, { ...ALONG_ROUTE, stretch: HALF_WAY }],
  "tomtom-get-traffic nearby.radiusMeters": [NEARBY, { ...NEARBY, radiusMeters: 2500 }],
  "tomtom-get-traffic nearby.query": [NEARBY, NEARBY_QUERY],
  "tomtom-get-traffic within.boundingBox": [
    WITHIN_POLYGON,
    { ...WITHIN_POLYGON, boundingBox: BOX },
  ],
  "tomtom-get-traffic within.queries": [WITHIN_BOX, { ...WITHIN_BOX, queries: ["Utrecht"] }],
  "tomtom-get-traffic within.geometries": [WITHIN_BOX, { ...WITHIN_BOX, geometries: [POLYGON] }],
  "tomtom-get-traffic within.areas": [WITHIN_BOX, { ...WITHIN_BOX, areas: [AREA] }],
  "tomtom-get-traffic alongRoute.withinMeters": [
    ALONG_ROUTE,
    { ...ALONG_ROUTE, withinMeters: 3000 },
  ],
  "tomtom-get-traffic alongRoute.stretch": [ALONG_ROUTE, { ...ALONG_ROUTE, stretch: HALF_WAY }],
};

/** Inputs the handler consumes itself: they shape the tool result, not the API request. */
const HANDLER_INPUTS = new Set(["show_ui", "response_detail", "analyse"]);

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

let client: Client;
let tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[];

beforeAll(async () => {
  client = await connectInMemory("inputs-test");
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
  args: ToolArguments
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

function argsFor(tool: string, input: string): { base: ToolArguments; variant: ToolArguments } {
  const companion = COMPANIONS[`${tool}.${input}`] ?? {};
  const base: ToolArguments = { ...API_TOOLS[tool], ...companion.with };
  const variant: ToolArguments = { ...base, ...companion.extra };
  for (const key of companion.drop ?? []) delete variant[key];
  variant[input] = "value" in companion ? companion.value : SAMPLES[input];
  const defined = (args: ToolArguments) =>
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
    expect(names.sort()).toEqual(Object.keys(API_TOOLS).sort());
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
    const before = await requestsFor(tool, { ...API_TOOLS[tool], where: base });
    const after = await requestsFor(tool, { ...API_TOOLS[tool], where: variant });
    expect(before.error ?? after.error).toBeUndefined();
    expect(after.requests).not.toEqual(before.requests);
  });
});
