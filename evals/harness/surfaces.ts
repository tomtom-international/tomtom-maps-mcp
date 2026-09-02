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
 * What "the same routing decision" meant on the PREVIOUS tool surface.
 *
 * The capability benchmark needs none of this — it asks whether the agent
 * answered, and an answer is an answer whichever tool produced it. Tool
 * SELECTION is different: a scenario asserts `tomtom-discover-places`, a tool the
 * old server never advertised, so replaying it against a baseline would score 0
 * and prove nothing except that the tool was renamed.
 *
 * This is the map that makes the replay mean something. Each current tool lists
 * the legacy tools it absorbed, taken from the consolidation itself
 * (`refactor!: consolidate the MCP tools toward the agent toolkit`). A baseline
 * run passes when the agent picked ANY tool from the set — which is the honest
 * question: on the old surface, was the model's choice among the seven search
 * tools defensible for this prompt?
 *
 * The three dataset tools map to nothing, on purpose. They have no legacy
 * counterpart — that IS the difference between the surfaces — so a scenario
 * expecting one is reported as `unrepresentable` and left OUT of the baseline's
 * accuracy denominator. Counting it as a baseline failure would inflate the
 * improvement with a tautology: of course the old server did not call a tool it
 * did not have.
 */

/** Current tool → the legacy tools that count as the same decision. */
export const LEGACY_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  // Seven search entry points collapsed into one. Any of them is a defensible
  // choice for a "find me places" prompt on the old surface.
  "tomtom-discover-places": [
    "tomtom-fuzzy-search",
    "tomtom-poi-search",
    "tomtom-nearby",
    "tomtom-area-search",
    "tomtom-ev-search",
    "tomtom-search-along-route",
  ],
  // locate-place is geocode plus boundary polygons; fuzzy-search was the other
  // way a model reached a named place, so it counts as the same intent.
  "tomtom-locate-place": ["tomtom-geocode", "tomtom-fuzzy-search"],
  "tomtom-reverse-geocode": ["tomtom-reverse-geocode"],
  "tomtom-poi-categories": ["tomtom-poi-categories"],
  // EV became a field on plan-route rather than its own tool.
  "tomtom-plan-route": ["tomtom-routing", "tomtom-ev-routing"],
  "tomtom-find-reachable-areas": ["tomtom-reachable-range"],
  "tomtom-get-traffic": ["tomtom-traffic"],
  "tomtom-dynamic-map": ["tomtom-dynamic-map"],
  "tomtom-data-viz": ["tomtom-data-viz"],
  // No legacy counterpart — server-held datasets did not exist.
  "tomtom-describe-dataset": [],
  "tomtom-analyse-data": [],
};

/** The 15 model-visible tools the pre-consolidation server advertised. */
export const LEGACY_TOOL_NAMES: readonly string[] = [
  ...new Set(Object.values(LEGACY_EQUIVALENTS).flat()),
].sort();

/** A scenario's tool expectations, translated onto the legacy surface. */
export interface TranslatedExpectation {
  /** Legacy tools that count as routing this prompt correctly. */
  accepted: string[];
  /** Current tools in the expectation that the legacy surface simply lacked. */
  unrepresentable: string[];
  /** Legacy tools to forbid, minus anything that is also accepted. */
  forbidden: string[];
  /**
   * Forbidden tools dropped because they translate to a tool that is also
   * accepted. Recorded rather than silently swallowed: a dropped prohibition
   * means the scenario's near-miss distinction did not EXIST on the old surface,
   * which is a finding about the consolidation, not a bug in the replay.
   */
  droppedForbidden: string[];
}

const translate = (names: readonly string[]): { tools: string[]; missing: string[] } => {
  const tools = new Set<string>();
  const missing: string[] = [];
  for (const name of names) {
    const legacy = LEGACY_EQUIVALENTS[name];
    if (legacy === undefined) {
      // An unmapped name is a map that has drifted from the registry, not a
      // capability gap. `surfaces.test.ts` fails on this; treat it as missing
      // here so a run never scores against a tool nobody defined.
      missing.push(name);
      continue;
    }
    if (legacy.length === 0) missing.push(name);
    for (const tool of legacy) tools.add(tool);
  }
  return { tools: [...tools], missing };
};

/**
 * Maps one scenario's expectations from the current surface to the legacy one.
 *
 * Forbidden tools are subtracted from the accepted set rather than allowed to
 * contradict it. `nearby` vs `area-search` was a real distinction to police on
 * the old surface and both now live inside `discover-places`, so a scenario that
 * forbids one while expecting the other becomes unsatisfiable after translation
 * — the prohibition is dropped and reported.
 */
export const toLegacyExpectation = (options: {
  expectedTool: string;
  acceptedAlternatives?: readonly string[];
  forbiddenTools?: readonly string[];
}): TranslatedExpectation => {
  const wanted = translate([options.expectedTool, ...(options.acceptedAlternatives ?? [])]);
  const banned = translate(options.forbiddenTools ?? []);

  const accepted = new Set(wanted.tools);
  const forbidden = banned.tools.filter((tool) => !accepted.has(tool));
  const droppedForbidden = banned.tools.filter((tool) => accepted.has(tool));

  return {
    accepted: [...accepted],
    unrepresentable: wanted.missing,
    forbidden,
    droppedForbidden,
  };
};
