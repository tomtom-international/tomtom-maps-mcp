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

import { describe, expect, it } from "vitest";
import { FULL_SCENARIOS, liveSeed, MODEL, priorTurn, toolCall } from "../harness";
import { canonicalAndRest, runToolScenario } from "./helpers";

/**
 * Context for prompts that point at something ("these three cities", "this
 * GeoJSON") rather than naming it.
 *
 * Those read as bad prompts standing alone, and the agent is right to refuse
 * them — both models replied "please tell me which three cities". They are not
 * bad prompts, they are *deictic* ones, and they are exactly how people talk to
 * a map assistant mid-session. What was missing is the turn that put the subject
 * on the table. Rewriting them to name their subject would test a phrasing
 * nobody uses; staging the antecedent tests the thing the tool is actually for.
 */
const citiesSeed = () =>
  priorTurn(
    "Where are Amsterdam, Berlin and Paris?",
    [
      toolCall(
        "tomtom-locate-place",
        { query: "Amsterdam", queryAs: "place" },
        {
          type: "FeatureCollection",
          features: [
            { type: "Feature", geometry: { type: "Point", coordinates: [4.8932, 52.3731] } },
            { type: "Feature", geometry: { type: "Point", coordinates: [13.4049, 52.52] } },
            { type: "Feature", geometry: { type: "Point", coordinates: [2.3522, 48.8566] } },
          ],
        }
      ),
    ],
    "Amsterdam is at 4.8932, 52.3731; Berlin at 13.4049, 52.52; Paris at 2.3522, 48.8566."
  );

const geoJsonSeed = () =>
  priorTurn(
    "Here is my delivery data as GeoJSON.",
    [
      toolCall(
        "tomtom-get-traffic",
        { where: { mode: "within", queries: ["Amsterdam"] } },
        {
          type: "FeatureCollection",
          features: Array.from({ length: 5 }, (_, index) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [4.89 + index / 100, 52.37] },
            properties: { weight: index },
          })),
          _meta: { dataset_id: "ds_deliveries" },
        }
      ),
    ],
    "I have the 5-point delivery dataset loaded as ds_deliveries."
  );

const TOOLS = [
  {
    tool: "tomtom-plan-route" as const,
    acceptedAlternatives: ["tomtom-locate-place"],
    // The routing description says to use it FIRST for directions, and to reach
    // for dynamic-map only when combining routes with other elements.
    forbiddenTools: ["tomtom-dynamic-map"],
  },
  {
    tool: "tomtom-find-reachable-areas" as const,
    acceptedAlternatives: ["tomtom-locate-place"],
    // An isochrone is not a route; routing a "how far can I get" prompt to
    // tomtom-plan-route is the classic confusion.
    forbiddenTools: ["tomtom-plan-route"],
  },
  {
    tool: "tomtom-get-traffic" as const,
    acceptedAlternatives: ["tomtom-locate-place"],
    // The description explicitly forbids plotting incidents via dynamic-map.
    forbiddenTools: ["tomtom-dynamic-map"],
  },
  {
    tool: "tomtom-dynamic-map" as const,
    acceptedAlternatives: ["tomtom-locate-place"],
    // A handful of markers is dynamic-map's job, not the large-dataset tool's.
    forbiddenTools: ["tomtom-data-viz"],
    // "Show THESE three cities" needs the turn that named them.
    priorTurns: citiesSeed,
  },
  {
    tool: "tomtom-data-viz" as const,
    acceptedAlternatives: [],
    // …and the reverse: a 5000-point dataset must not go to dynamic-map.
    forbiddenTools: ["tomtom-dynamic-map"],
    // "Render THIS GeoJSON" needs the turn that supplied it.
    priorTurns: geoJsonSeed,
  },
];

describe.skipIf(!MODEL)(
  "routing / traffic / map tool selection",
  { timeout: 180_000, retry: 2 },
  () => {
    for (const { tool, acceptedAlternatives, forbiddenTools, priorTurns } of TOOLS) {
      describe(tool, () => {
        const { canonical, rest } = canonicalAndRest(tool);

        it(`classifies the canonical prompt: ${canonical}`, async () => {
          const outcome = await runToolScenario({
            expectedTool: tool,
            prompt: canonical,
            acceptedAlternatives,
            forbiddenTools,
            priorTurns,
          });
          expect(outcome.success, outcome.failureReason).toBe(true);
        });

        it.skipIf(!FULL_SCENARIOS).each(rest)("handles registry prompt: %s", async (prompt) => {
          const outcome = await runToolScenario({
            expectedTool: tool,
            prompt,
            acceptedAlternatives,
            forbiddenTools,
            priorTurns,
          });
          expect(outcome.success, outcome.failureReason).toBe(true);
        });
      });
    }
  }
);

// A route the agent already calculated in an earlier turn. Because the MCP is
// stateless, "that route" only exists in message history — so these scenarios are
// how we find out whether the agent can pick a follow-up target up from history
// at all. Phase 1's `dataset_id` is meant to make this reliable rather than
// dependent on the model re-reading its own transcript, and these tests are the
// before/after measurement.
/**
 * A completed "route from Amsterdam to Berlin" turn, staged as history.
 *
 * `liveSeed` rather than `priorTurn`: over the real transport the route is
 * actually planned, so the `dataset_id` in the staged result is one the server
 * will still resolve on the next call. The canned fixture below is what mocked
 * runs see, and its `ds_routefixture` is exactly what must NOT reach a live
 * server — a follow-up asking for traffic "on that route" got back "Dataset
 * ds_routefixture is not available … re-run the tool that produced it", did so,
 * and turned a one-hop follow-up into three.
 */
const routeSeed = liveSeed(
  "Route from Amsterdam to Berlin",
  toolCall(
    "tomtom-plan-route",
    {
      locations: [{ position: [4.8932, 52.3731] }, { position: [13.4049, 52.52] }],
    },
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            summary: { lengthInMeters: 654_000, travelTimeInSeconds: 23_400 },
          },
        },
      ],
      _meta: { show_ui: true, dataset_id: "ds_routefixture" },
    }
  ),
  "The drive from Amsterdam to Berlin is 654 km and takes about 6h 30m."
);

describe.skipIf(!MODEL)("follow-up turns", { timeout: 180_000, retry: 2 }, () => {
  it("finds POIs along a route implied from an earlier turn", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-discover-places",
      prompt: "Where can I stop for coffee on that drive?",
      acceptedAlternatives: ["tomtom-poi-categories"],
      priorTurns: routeSeed,
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  // Traffic ON a route comes from the route. `tomtom-plan-route` returns
  // `summary.trafficDelayInSeconds` and a `sections.traffic` entry per hold-up,
  // so the right move is to re-plan (the user said "right now") rather than ask
  // tomtom-get-traffic for the span of the journey — which is ~130,000 km² of
  // envelope for Amsterdam to Berlin, well past the traffic API's 10,000 km² cap.
  it("answers route traffic from the route, without a second lookup", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-plan-route",
      prompt: "Any hold-ups on that route right now?",
      // Re-planning is defensible — the user said "right now" — but so is
      // answering outright, and answering outright is better. What must NOT
      // happen is tomtom-get-traffic: the span of Amsterdam to Berlin is ~130,000
      // km² against a 10,000 km² API cap, so that call fails and costs two hops
      // to recover from. It used to be the first thing both models reached for.
      acceptNoToolCall:
        "the staged route carries summary.trafficDelayInSeconds and a sections.traffic entry per hold-up",
      forbiddenTools: ["tomtom-get-traffic"],
      priorTurns: routeSeed,
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });
});

describe.skipIf(!MODEL)("routing argument shape", { timeout: 180_000, retry: 2 }, () => {
  // `tomtom-ev-routing` used to be a separate tool, so "did it pick the EV tool"
  // was a tool-selection question. EV is now a field on plan-route, which turns
  // the same failure into an ARGUMENT question — exactly the shift phase 4 makes
  // across the surface, and the reason expectToolCalledWith had to land first.
  it("sets `ev` for an electric-vehicle route rather than planning a plain one", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-plan-route",
      prompt: "Plan an EV route from Amsterdam to Munich with charging stops",
      acceptedAlternatives: ["tomtom-locate-place"],
      expectedArgs: {
        "tomtom-plan-route": (input) =>
          Boolean(input.ev) ||
          "`ev` was not set, so no charging stops would be planned — this is now a silent " +
            "downgrade to a plain route rather than a wrong-tool error",
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it("names places directly instead of geocoding first", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-plan-route",
      prompt: "Route from Amsterdam Centraal to the Rijksmuseum",
      // The hop the locationInput union removes. locate-place is still accepted
      // as a route (a model may verify a place), but it must not be REQUIRED.
      expectedArgs: {
        "tomtom-plan-route": (input) => {
          const locations = input.locations as
            | { query?: string; position?: unknown; dataset_id?: string }[]
            | undefined;
          if (!locations || locations.length < 2) return "fewer than two locations were passed";
          return (
            locations.every((l) => l.query || l.position || l.dataset_id) ||
            "a location entry was neither a query, a position, nor a dataset_id"
          );
        },
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it("passes several budgets in one call for nested isochrones", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-find-reachable-areas",
      prompt: "Give me 10, 20 and 30-minute isochrones from Amsterdam Centraal",
      expectedArgs: {
        "tomtom-find-reachable-areas": (input) =>
          (input.budgets as unknown[] | undefined)?.length === 3 ||
          "expected three budgets in ONE call — the old tool needed three separate calls",
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it("names the area for traffic instead of hand-building a bbox", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-get-traffic",
      prompt: "What's the traffic like in Amsterdam right now?",
      acceptedAlternatives: ["tomtom-locate-place"],
      expectedArgs: {
        "tomtom-get-traffic": (input) => {
          const where = input.where as { mode?: string; queries?: string[] } | undefined;
          if (where?.mode !== "within")
            return `expected mode "within", got "${where?.mode ?? "none"}"`;
          return (
            where.queries?.some((q) => q.toLowerCase().includes("amsterdam")) ||
            "Amsterdam did not appear in `where.queries`"
          );
        },
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });
});
