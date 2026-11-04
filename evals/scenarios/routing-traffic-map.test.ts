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

import type { ModelMessage } from "ai";
import { liveSeed, priorTurn, toolCall } from "../harness/seed";
import { describeRegistryScenarios, describeScenarios, type ScenarioRow } from "./helpers";

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

/** The user's own data arrives in their message; no tool ever returned it. */
const geoJsonSeed = (): ModelMessage[] => [
  {
    role: "user",
    content: `Here is my delivery data as GeoJSON:\n${JSON.stringify({
      type: "FeatureCollection",
      features: Array.from({ length: 5 }, (_, index) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [4.89 + index / 100, 52.37] },
        properties: { weight: index },
      })),
    })}`,
  },
  { role: "assistant", content: "Got it: 5 delivery points in Amsterdam, each with a weight." },
];

describeRegistryScenarios("routing / traffic / map tool selection", [
  {
    tool: "tomtom-plan-route",
    acceptedAlternatives: ["tomtom-locate-place"],
    // The routing description says to use it FIRST for directions, and to reach
    // for dynamic-map only when combining routes with other elements.
    forbiddenTools: ["tomtom-dynamic-map"],
  },
  {
    tool: "tomtom-get-traffic",
    acceptedAlternatives: ["tomtom-locate-place"],
    // The description explicitly forbids plotting incidents via dynamic-map.
    forbiddenTools: ["tomtom-dynamic-map"],
  },
  {
    tool: "tomtom-dynamic-map",
    acceptedAlternatives: ["tomtom-locate-place"],
    // A handful of markers is dynamic-map's job, not the large-dataset tool's.
    forbiddenTools: ["tomtom-data-viz"],
    // "Show THESE three cities" needs the turn that named them.
    priorTurns: citiesSeed,
  },
  {
    tool: "tomtom-data-viz",
    // …and the reverse: a 5000-point dataset must not go to dynamic-map.
    forbiddenTools: ["tomtom-dynamic-map"],
    // "Render THIS GeoJSON" needs the turn that supplied it.
    priorTurns: geoJsonSeed,
  },
]);

// A route the agent already calculated in an earlier turn. Because the MCP is
// stateless, "that route" only exists in message history — so these scenarios are
// how we find out whether the agent can pick a follow-up target up from history
// at all.
/**
 * A completed "route from Amsterdam to Berlin" turn, staged as history.
 *
 * `liveSeed` rather than `priorTurn`: over the real transport the route is
 * actually planned, so the follow-up refers to a result the server really
 * returned. The canned fixture below is only what mocked runs see.
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
            summary: {
              lengthInMeters: 654_000,
              travelTimeInSeconds: 23_400,
              trafficDelayInSeconds: 540,
            },
            sections: {
              traffic: [
                { categories: ["jam"], magnitudeOfDelay: "moderate", delayInSeconds: 300 },
                { categories: ["roadworks"], magnitudeOfDelay: "minor", delayInSeconds: 240 },
              ],
            },
          },
        },
      ],
      show_ui: true,
      tool: "tomtom-plan-route",
    }
  ),
  "The drive from Amsterdam to Berlin is 654 km and takes about 6h 30m.",
  {
    tool: "tomtom-routing",
    input: {
      locations: [
        [4.8932, 52.3731],
        [13.4049, 52.52],
      ],
    },
  }
);

describeScenarios("follow-up turns", [
  {
    name: "finds POIs along a route implied from an earlier turn",
    prompt: "Where can I stop for coffee on that drive?",
    expectedTool: "tomtom-discover-places",
    acceptedAlternatives: ["tomtom-poi-categories"],
    priorTurns: routeSeed,
    expectedArgs: (input: { where?: { mode?: string; locations?: unknown[] } }) => {
      const { where } = input;
      if (where?.mode !== "maxDetour" && where?.mode !== "alongRoute")
        return `expected mode "maxDetour" or "alongRoute", got "${where?.mode ?? "none"}"`;
      return (where.locations?.length ?? 0) >= 2 || "the trip has fewer than two locations";
    },
  },
  // Traffic ON a route comes from the route. `tomtom-plan-route` returns
  // `summary.trafficDelayInSeconds` and a `sections.traffic` entry per hold-up,
  // so the right move is to re-plan (the user said "right now") rather than ask
  // tomtom-get-traffic for the span of the journey — which is ~130,000 km² of
  // envelope for Amsterdam to Berlin, well past the traffic API's 10,000 km² cap.
  {
    name: "answers route traffic from the route, without a second lookup",
    prompt: "Any hold-ups on that route right now?",
    expectedTool: "tomtom-plan-route",
    // Re-planning is defensible — the user said "right now" — but so is
    // answering outright, and answering outright is better. What must NOT
    // happen is tomtom-get-traffic: that call fails on the API's area cap and
    // costs two hops to recover from.
    acceptNoToolCall:
      "the staged route carries summary.trafficDelayInSeconds and a sections.traffic entry per hold-up",
    forbiddenTools: ["tomtom-get-traffic"],
    priorTurns: routeSeed,
  },
]);

describeScenarios("routing argument shape", [
  {
    name: "names places directly instead of geocoding first",
    prompt: "Route from Amsterdam Centraal to the Rijksmuseum",
    expectedTool: "tomtom-plan-route",
    // The hop the locationInput union removes. locate-place is still accepted
    // as a route (a model may verify a place), but it must not be REQUIRED.
    expectedArgs: (input: { locations?: { query?: string; position?: unknown }[] }) => {
      const { locations } = input;
      if (!locations || locations.length < 2) return "fewer than two locations were passed";
      return (
        locations.every((location) => location.query || location.position) ||
        "a location entry was neither a query nor a position"
      );
    },
  },
  {
    name: "names the area for traffic instead of hand-building a bbox",
    prompt: "What's the traffic like in Amsterdam right now?",
    expectedTool: "tomtom-get-traffic",
    acceptedAlternatives: ["tomtom-locate-place"],
    expectedArgs: inWhere((where) => {
      if (where.mode !== "within") return `expected mode "within", got "${where.mode ?? "none"}"`;
      return (
        where.queries?.some((query) => query.toLowerCase().includes("amsterdam")) ||
        "Amsterdam did not appear in `where.queries`"
      );
    }),
  },
]);

interface TrafficWhere {
  mode?: string;
  queries?: string[];
  query?: string;
  position?: number[];
  radiusMeters?: number;
}

/** Checks a call's `where`, read as empty when the model left it out. */
function inWhere(check: (where: TrafficWhere) => string | true) {
  return (input: { where?: TrafficWhere }) => check(input.where ?? {});
}

/** Traffic phrasings beyond the registry prompts: a district, two cities, a radius. */
const harderTraffic = (row: Pick<ScenarioRow, "prompt" | "expectedArgs">): ScenarioRow => ({
  expectedTool: "tomtom-get-traffic",
  acceptedAlternatives: ["tomtom-locate-place"],
  forbiddenTools: ["tomtom-dynamic-map"],
  ...row,
});

describeScenarios(
  "harder traffic phrasings",
  [
    {
      prompt: "Are there any road closures in Kreuzberg right now?",
      expectedArgs: inWhere(
        (where) =>
          (where.mode === "within" && where.queries?.some((query) => /kreuzberg/i.test(query))) ||
          "Kreuzberg was not named in a within scope"
      ),
    },
    {
      prompt: "Compare current traffic incidents in Rotterdam and Utrecht",
      expectedArgs: inWhere(
        (where) =>
          (where.mode === "within" &&
            where.queries?.some((query) => /rotterdam|utrecht/i.test(query))) ||
          "neither city was named in a within scope"
      ),
    },
    {
      prompt: "Any accidents within 3 km of Schiphol airport?",
      expectedArgs: inWhere((where) => {
        // Named, or at coordinates within ~6 km of the terminal (4.76, 52.31).
        const atSchiphol =
          /schiphol/i.test(where.query ?? "") ||
          (where.position !== undefined &&
            Math.abs(where.position[0] - 4.76) < 0.09 &&
            Math.abs(where.position[1] - 52.31) < 0.05);
        const radius = where.radiusMeters ?? 0;
        return (
          (where.mode === "nearby" && atSchiphol && radius >= 2500 && radius <= 3500) ||
          "expected a nearby scope of about 3 km around Schiphol"
        );
      }),
    },
  ].map(harderTraffic)
);

/** Route-analysis phrasings, each asking for the plan-route input that answers it. */
const routeAnalysis = (row: Pick<ScenarioRow, "prompt" | "expectedArgs">): ScenarioRow => ({
  expectedTool: "tomtom-plan-route",
  acceptedAlternatives: ["tomtom-locate-place"],
  forbiddenTools: ["tomtom-dynamic-map"],
  ...row,
});

describeScenarios(
  "route analysis arguments",
  [
    {
      prompt: "How many hairpin bends are on the road from Bormio to Merano over the Stelvio?",
      expectedArgs: (input: { curves?: boolean }) =>
        input.curves === true || "`curves` was not set",
    },
    {
      prompt: "Is the drive from Utrecht to Rotterdam taking a different way than usual today?",
      expectedArgs: (input: { compareWithUsualRoute?: boolean }) =>
        input.compareWithUsualRoute === true || "`compareWithUsualRoute` was not set",
    },
    {
      prompt:
        "Plan Amsterdam to Maastricht with stops in Eindhoven, Utrecht and Den Bosch, in whatever order is quickest.",
      expectedArgs: (input: { insertStops?: unknown[] }) => {
        const stops = input.insertStops?.length ?? 0;
        return stops === 3 || `expected 3 insertStops, got ${stops}`;
      },
    },
    {
      prompt:
        "Driving from Paris to Barcelona, where will I be after two hours and after five hours?",
      expectedArgs: (input: { checkpoints?: { afterMinutes?: number }[] }) => {
        const checkpoints = input.checkpoints ?? [];
        const minutes = checkpoints
          .map((checkpoint) => checkpoint.afterMinutes ?? 0)
          .sort((a, b) => a - b);
        return (
          (minutes.length === 2 && minutes[0] === 120 && minutes[1] === 300) ||
          `expected checkpoints at 120 and 300 minutes, got ${JSON.stringify(checkpoints)}`
        );
      },
    },
  ].map(routeAnalysis)
);
