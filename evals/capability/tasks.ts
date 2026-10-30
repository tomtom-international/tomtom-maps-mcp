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
 *
 * The capability corpus — the benchmark that answers "does the MCP make the
 * agent smarter?"
 *
 * Tool-SELECTION evals ask "did it reach for the right tool". These ask the
 * harder question: given the right tool, can the agent actually ANSWER? Most of
 * these tasks are unanswerable today, on purpose: the trimmers delete the fields
 * they need and `capTrafficIncidents` throws away the rows they need to count.
 *
 * So the corpus is a scoreboard, not a pass/fail gate:
 *
 *   • `expected: "pass"`   — answerable today. Asserted, and a regression breaks
 *                            the build. Phase 0 must not move these.
 *   • `expected: "blocked"` — NOT answerable today. Recorded, not asserted. These
 *                            are what a later phase (`evals/phases.ts`) is
 *                            supposed to unlock, and the recorded report is the
 *                            before/after diff.
 *
 * One thing IS asserted for every task, blocked or not: the agent must not
 * fabricate. A blocked task should end in "I can only see 100 of 3,412
 * incidents", never in a confident number derived from the visible rows. That
 * makes `fabricated` the metric that must stay at zero while `blocked` shrinks.
 */

/** What the task probes. Grouped so the report can roll up by capability. */
export type Capability =
  /** Plain lookup — one call, answer is in the trimmed response. */
  | "lookup"
  /** Requires aggregating over more rows than the response returns. */
  | "aggregate-at-scale"
  /** Requires a field the trimmers delete (openingHours, categorySet, score…). */
  | "deep-attributes"
  /** Requires route geometry or guidance, both stripped today. */
  | "route-geometry"
  /** Requires combining two tools' results geometrically. */
  | "cross-reference"
  /**
   * Requires deriving a SUBSET of a result and rendering that, rather than
   * answering a question about it. `data-viz` takes GeoJSON inline or from a
   * URL, so a filtered layer has to travel back through the conversation to be
   * drawn.
   */
  | "derive-and-draw"
  /**
   * Requires explaining a route rather than measuring it: which roads and
   * countries it crosses, how alternatives differ, how curvy it is, where the
   * driver will be when. The maps-sdk's route utilities derive these from the
   * geometry and sections, which the trimmed response no longer carries.
   */
  | "route-analysis";

export interface CapabilityTask {
  id: string;
  prompt: string;
  capability: Capability;
  expected: "pass" | "blocked";
  /** What the judge scores the answer against. Be specific and checkable. */
  rubric: string;
  /** Why this is blocked today, and what unblocks it. Empty for `pass` tasks. */
  blockedBy?: string;
}

export const CAPABILITY_TASKS: readonly CapabilityTask[] = [
  // ---------------------------------------------------------------------------
  // Answerable today — the regression floor.
  // ---------------------------------------------------------------------------
  {
    id: "lookup-geocode",
    prompt: "What are the coordinates of Dam Square, Amsterdam?",
    capability: "lookup",
    expected: "pass",
    rubric:
      "States a longitude near 4.89 and a latitude near 52.37 (±0.05). Any answer without both numbers fails.",
  },
  {
    id: "lookup-route-summary",
    prompt: "How long is the drive from Amsterdam to Berlin, and how long does it take?",
    capability: "lookup",
    expected: "pass",
    rubric:
      "States a distance of roughly 600-700 km and a duration of roughly 6-8 hours, both taken from the tool result.",
  },
  {
    id: "lookup-traffic-worst",
    prompt: "What is the single worst traffic incident in Amsterdam right now?",
    capability: "lookup",
    expected: "pass",
    rubric:
      "Names one specific incident with its road and its delay or severity, drawn from the tool result. " +
      "If the tool returned no incidents, saying so is a correct answer.",
  },

  {
    id: "lookup-along-route-detour",
    prompt:
      "I'm driving from Amsterdam to Brussels. Which EV charging station along the way adds the least extra driving time, and how many minutes does it add?",
    capability: "lookup",
    expected: "pass",
    rubric:
      "Names one charging station and the extra driving time it adds, both taken from the tool result " +
      "(a detour time in seconds converted to minutes is fine). A station chosen by distance from a city, " +
      "or a detour time not present in the tool result, fails.",
  },
  {
    id: "lookup-neighbourhood-search",
    prompt: "Name five cafés inside De Jordaan in Amsterdam.",
    capability: "lookup",
    expected: "pass",
    rubric:
      "Names up to five cafés from the tool result, each with an address in the Jordaan: west of the " +
      "Prinsengracht and between the Brouwersgracht and the Leidsegracht (streets such as Westerstraat, " +
      "Rozengracht, Lindengracht, Elandsgracht, Bloemgracht). Any café elsewhere in Amsterdam fails.",
  },
  {
    id: "lookup-along-route-order",
    prompt:
      "On the drive from Lyon to Marseille, list the first three petrol stations I pass that are at most 5 minutes off the route, in the order I reach them.",
    capability: "lookup",
    expected: "pass",
    rubric:
      "Lists up to three petrol stations from the tool result in the order they fall along the route " +
      "from Lyon (northernmost first), each within a 5-minute detour. A list ordered by detour time " +
      "rather than position along the route fails unless the two orders coincide.",
  },
  {
    id: "lookup-traffic-district",
    prompt: "Are there any road closures in Amsterdam-Centrum right now? Name the roads.",
    capability: "lookup",
    expected: "pass",
    rubric:
      "Names the closed roads from the tool result, or says there are none if the tool returned none. " +
      "A road may be given with its from/to ends, and closures on one road may be grouped. " +
      "Roads outside the Centrum district (the A10 ring, Amsterdam-Noord or -Zuidoost) fail.",
  },

  // ---------------------------------------------------------------------------
  // Aggregate at scale — more rows than the response carries.
  // ---------------------------------------------------------------------------
  {
    id: "aggregate-incidents-by-road",
    prompt:
      "Across the whole Amsterdam metro area, how many traffic incidents are there per road number? Give me the top 5 roads by incident count.",
    capability: "aggregate-at-scale",
    expected: "blocked",
    rubric:
      "Gives a per-road count covering EVERY incident in the area. An answer computed from a capped subset " +
      "is only correct if it explicitly says the counts cover just the returned subset and not the full area.",
    blockedBy:
      "capTrafficIncidents returns at most 100 of potentially thousands of incidents, so a total count is unobtainable.",
  },
  {
    id: "aggregate-incidents-delay-total",
    prompt:
      "What is the total delay, in minutes, caused by all current traffic incidents in the Amsterdam metro area?",
    capability: "aggregate-at-scale",
    expected: "blocked",
    rubric:
      "States a total summed over every incident in the area, or states that the total cannot be computed because the response was capped.",
    blockedBy: "Same cap — a sum over a truncated list is simply the wrong number.",
  },
  {
    id: "aggregate-ev-connector-histogram",
    prompt:
      "For EV charging stations around Amsterdam, give me a breakdown of how many chargers there are by connector type and power band.",
    capability: "aggregate-at-scale",
    expected: "blocked",
    rubric:
      "Gives counts grouped by connector type AND by power band, covering the full result set rather than a handful of stations.",
    blockedBy:
      "The search returns a page of stations; grouping needs code over the full set, which no tool can run.",
  },

  // ---------------------------------------------------------------------------
  // Deep attributes — fields the trimmers delete.
  // ---------------------------------------------------------------------------
  {
    id: "attributes-opening-hours",
    prompt: "Which restaurants near Dam Square in Amsterdam are open right now?",
    capability: "deep-attributes",
    expected: "blocked",
    rubric:
      "Filters the results by opening hours and names the ones currently open, or states that opening-hours data is not available.",
    blockedBy:
      "trimGeoJSONFeatureProperties deletes poi.openingHours, so the agent cannot see the field it needs.",
  },
  {
    id: "attributes-category-breakdown",
    prompt:
      "Break down the places near Amsterdam Centraal by their POI category, and tell me which category is most common.",
    capability: "deep-attributes",
    expected: "blocked",
    rubric:
      "Groups results by category using each place's own category data, and names the most common one.",
    blockedBy: "trimGeoJSONFeatureProperties deletes poi.categorySet and poi.classifications.",
  },

  // ---------------------------------------------------------------------------
  // Route geometry — coordinates and guidance are stripped.
  // ---------------------------------------------------------------------------
  {
    id: "geometry-turn-count",
    prompt: "How many turns are there on the drive from Amsterdam Centraal to Utrecht Centraal?",
    capability: "route-geometry",
    expected: "blocked",
    rubric:
      "States a turn count derived from the route's guidance instructions, or states that guidance data is not available.",
    blockedBy: "trimRoutingResponse deletes properties.guidance.",
  },
  {
    id: "geometry-northernmost-point",
    prompt:
      "On the route from Amsterdam to Berlin, what is the northernmost latitude the road reaches?",
    capability: "route-geometry",
    expected: "blocked",
    rubric:
      "States a latitude taken from the route polyline, or states that the route geometry is not available.",
    blockedBy: "trimRoutingResponse deletes geometry.coordinates.",
  },

  // ---------------------------------------------------------------------------
  // Cross-reference — two results combined geometrically.
  // ---------------------------------------------------------------------------
  {
    id: "cross-ev-within-range",
    prompt:
      "How many EV charging stations fall inside the area I can reach from Amsterdam Centraal in 30 minutes?",
    capability: "cross-reference",
    expected: "blocked",
    rubric:
      "Gives a count of stations tested against the reachable-range polygon, or states that the polygon is not available to test against.",
    blockedBy:
      "maps-sdk 1.0 has no reachable-range service, so no tool computes the area to test containment against.",
  },
  {
    id: "cross-incidents-near-route",
    prompt:
      "How many current traffic incidents are within 1 km of the route from Amsterdam to Utrecht?",
    capability: "cross-reference",
    expected: "blocked",
    rubric:
      "Gives a count based on distance from the route line, or states that the route geometry is not available to measure against.",
    blockedBy:
      "Both sides are stripped: the route polyline and the incident geometries. No tool can run the spatial join.",
  },
  // ---------------------------------------------------------------------------
  // Removed with the maps-sdk 1.0 migration.
  // ---------------------------------------------------------------------------
  {
    id: "lookup-ev-availability",
    prompt: "Are there any EV chargers near Utrecht with a charger free right now?",
    capability: "lookup",
    expected: "blocked",
    rubric:
      "Names at least one station and reports its availability counts from the tool result, or states plainly that none are free.",
    blockedBy:
      "maps-sdk 1.0 has no charging availability service, so search results carry no live availability.",
  },
  // ---------------------------------------------------------------------------
  // Derive and draw. Added to answer a question the rest of the corpus cannot:
  // every other task asks something ABOUT data, so a tool that produces derived
  // data was never reached for and was removed on that evidence. This asks for a
  // subset to be DRAWN, which is the workflow that evidence did not cover.
  // ---------------------------------------------------------------------------
  {
    id: "derive-fast-chargers-map",
    prompt: "Show me just the 22 kW and faster charging stations in Amsterdam on a map.",
    capability: "derive-and-draw",
    expected: "blocked",
    // The threshold is 22 kW because that is where Amsterdam's data actually
    // splits: of 100 stations, 94 are 11 kW street chargers, 5 reach 22 kW and
    // NONE reach 50. Asking for 50 kW made "there are none" the correct answer
    // and the rubric demanded a map of an empty set — the task failed a model
    // that was right. A rubric must not assume the live data contains its answer,
    // which is why the escape clause below matters as much as the threshold.
    rubric:
      "Renders a map showing ONLY the stations meeting the power threshold, and says how many of " +
      "the stations found were kept, both numbers traceable to the tool results. Drawing every " +
      "station found, or naming the subset without rendering it, does not satisfy this. If no " +
      "station meets the threshold, saying so and not drawing a map is a correct answer.",
    blockedBy:
      "tomtom-data-viz takes GeoJSON inline or from a URL. Nothing derives a filtered dataset " +
      "server-side, so the subset must be re-emitted into the conversation to be drawn, which is " +
      "the cost datasets exist to avoid.",
  },
  // ---------------------------------------------------------------------------
  // Route analysis, from the maps-sdk 1.0.0-rc.6 route utilities. Rubrics accept
  // the answers live data can make correct: no jam, the usual roads, a single
  // route where alternatives were asked for.
  // ---------------------------------------------------------------------------
  {
    id: "route-alternatives-diff",
    prompt: "Compare the route options from Amsterdam to Brussels: what does each one avoid?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Presents at least two routes and, for each alternative, names a concrete difference from the " +
      "first route traceable to the tool results: roads only it takes, or a toll, motorway, ferry, " +
      "traffic delay or closure it adds or avoids, with the extra time or distance. Listing only " +
      "durations and lengths does not satisfy this. If the API returns a single route, saying so is correct.",
  },
  {
    id: "route-car-sick-curves",
    prompt:
      "My passenger gets car sick. Which route from Grenoble to Briançon has the fewest sharp bends?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Recommends one route and supports it with bend counts from the tool results (curves, hard " +
      "curves or hairpins), compared across the routes found. A recommendation on time or distance " +
      "alone fails. If only one route comes back, giving its bend counts and saying there is no " +
      "alternative is correct.",
  },
  {
    id: "route-motorbike-twisty",
    prompt:
      "I'm riding my motorbike from Bormio to Merano over the Stelvio Pass. How many hairpins are there, and where is the twistiest stretch?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "States a hairpin count and locates the curviest stretch by distance from the start, by its " +
      "length or by the road it is on, all traceable to the tool results. A count from general " +
      'knowledge of the Stelvio ("48 hairpins") without tool data fails.',
  },
  {
    id: "route-per-country",
    prompt:
      "Driving from Amsterdam to Milan, how many kilometres will I drive in each country, and where are the toll roads?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Lists the countries in driving order with a distance in each, and names which ones have toll " +
      "road length, all traceable to the tool results. The distances must roughly add up to the " +
      "route length. Listing countries without distances fails.",
  },
  {
    id: "route-live-vs-usual",
    prompt:
      "Is today's route from Utrecht to Rotterdam different from the usual one because of traffic?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Says whether the live route takes the same roads as the usual-traffic route and compares the " +
      "travel times, traceable to the tool results. If they differ, names the roads or incidents " +
      'involved. "Same roads as usual" is a correct answer.',
  },
  {
    id: "route-stop-order",
    prompt:
      "I have to stop in Eindhoven, Utrecht and Den Bosch on the way from Amsterdam to Maastricht. In what order?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Gives an order for the three stops taken from a planned route through them, with the route's " +
      "total time or distance. Utrecht, then Den Bosch ('s-Hertogenbosch), then Eindhoven is the " +
      "expected order; another order must be justified by the tool results. A planned route that " +
      "visits a stop twice fails.",
  },
  {
    id: "route-where-after-hours",
    prompt: "Driving from Paris to Barcelona, where will I be after four hours?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Names a town or area along the route at the four-hour mark, traceable to the tool results, " +
      "for example from a checkpoint or a reverse geocode of a point on the route. A guess from the " +
      "average speed, with no position from the tools, fails.",
  },
  {
    id: "route-motorways-used",
    prompt: "Which main roads does the fastest route from Rotterdam to Frankfurt take?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Names the main roads in driving order, at least two, each traceable to the tool results. " +
      "Road names from general knowledge, absent from the results, fail.",
  },
  {
    id: "route-first-jam-distance",
    prompt: "How far from Amsterdam is the first traffic jam on the way to Utrecht right now?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Gives the distance from the start to the first traffic section and its delay, traceable to " +
      "the tool results. If the route has no traffic sections, saying there is no jam right now is correct.",
  },
  {
    id: "route-first-jam-delay",
    prompt:
      "Driving from Amsterdam to Utrecht now, how far until the first jam, and how long is the delay?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Gives the distance to the first traffic section and that section's delay, and may add the " +
      "route's total traffic delay, all traceable to the tool results. Saying there is no delay while " +
      "the results show a traffic delay above zero fails. If the route has no traffic sections, " +
      "saying there is no jam right now is correct.",
  },
  {
    id: "route-local-departure",
    prompt: "If I leave Berlin at 8am local time next Monday, when will I arrive in Munich?",
    capability: "route-analysis",
    expected: "pass",
    rubric:
      "Gives an arrival time as Munich local time, consistent with an 8:00 local departure and the " +
      "route's travel time from the tool results. Treating 8am as UTC (arrival two hours off) fails.",
  },
];

/** Tasks whose result is asserted rather than merely recorded. */
export const REGRESSION_TASKS = CAPABILITY_TASKS.filter((task) => task.expected === "pass");

/** Tasks that phase 2 is expected to unlock. */
export const BLOCKED_TASKS = CAPABILITY_TASKS.filter((task) => task.expected === "blocked");
