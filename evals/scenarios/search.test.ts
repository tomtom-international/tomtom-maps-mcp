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
 * Search selection after the phase-4 collapse.
 *
 * Seven tools became two, which changes what these tests have to measure. "Did it
 * call the search tool?" is now nearly tautological — so the assertions here are
 * mostly about ARGUMENTS, via `expectedArgs`. The prompts are unchanged from the
 * seven-tool era on purpose: every one of them must still land correctly, which
 * is the whole safety net for the collapse.
 */

import { describe, expect, it } from "vitest";
import { FULL_SCENARIOS, MODEL } from "../harness";
import { canonicalAndRest, runToolScenario } from "./helpers";

/** Reads `where.mode`, tolerating the model omitting `where` entirely. */
const mode = (input: { where?: { mode?: string } }): string | undefined => input.where?.mode;

/** The failure this whole design risks: the region passed as the search subject. */
const subjectIsNotAPlace = (input: { query?: string }, place: string): string | true => {
  const query = String(input.query ?? "").toLowerCase();
  return query.includes(place.toLowerCase())
    ? `"${place}" was passed as the search subject (\`query\`) instead of in \`where\``
    : true;
};

describe.skipIf(!MODEL)("search tool selection", { timeout: 180_000, retry: 2 }, () => {
  for (const tool of ["tomtom-discover-places", "tomtom-locate-place"] as const) {
    describe(tool, () => {
      const { canonical, rest } = canonicalAndRest(tool);
      // The two search tools are each other's only plausible confusion now.
      const acceptedAlternatives =
        tool === "tomtom-discover-places" ? ["tomtom-poi-categories"] : ["tomtom-discover-places"];

      it(`classifies the canonical prompt: ${canonical}`, async () => {
        const outcome = await runToolScenario({
          expectedTool: tool,
          prompt: canonical,
          acceptedAlternatives,
        });
        expect(outcome.success, outcome.failureReason).toBe(true);
      });

      it.skipIf(!FULL_SCENARIOS).each(rest)("handles registry prompt: %s", async (prompt) => {
        const outcome = await runToolScenario({ expectedTool: tool, prompt, acceptedAlternatives });
        expect(outcome.success, outcome.failureReason).toBe(true);
      });
    });
  }
});

describe.skipIf(!MODEL)("search argument shape", { timeout: 180_000, retry: 2 }, () => {
  it("puts the region in `where`, not in `query`", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-discover-places",
      prompt: "Find Italian restaurants in Amsterdam",
      expectedArgs: {
        "tomtom-discover-places": (input) => {
          const notSubject = subjectIsNotAPlace(input, "Amsterdam");
          if (notSubject !== true) return notSubject;
          const queries = input.where?.queries as string[] | undefined;
          return (
            queries?.some((q: string) => q.toLowerCase().includes("amsterdam")) ||
            "Amsterdam did not appear in `where.queries`"
          );
        },
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it("skips the category pre-flight now that natural language is accepted", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-discover-places",
      prompt: "Find Italian restaurants in Amsterdam",
      // The saved hop is only saved if the model believes it can skip it — that
      // belief comes from the poiCategories description, and this is the test.
      forbiddenTools: ["tomtom-poi-categories"],
      expectedArgs: {
        "tomtom-discover-places": (input) =>
          Boolean(input.poiCategories?.length) ||
          "no poiCategories were passed — the category filter was dropped entirely",
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it('uses mode "nearby" for a coordinate-and-radius question', async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-discover-places",
      prompt: "Find petrol stations within 2km of 52.3791, 4.8994",
      expectedArgs: {
        "tomtom-discover-places": (input) =>
          mode(input) === "nearby" || `expected mode "nearby", got "${mode(input) ?? "none"}"`,
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it('uses mode "within" for a boundary question', async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-discover-places",
      prompt: "Find every bookshop inside Westminster",
      expectedArgs: {
        "tomtom-discover-places": (input) => {
          if (mode(input) !== "within")
            return `expected mode "within", got "${mode(input) ?? "none"}"`;
          return subjectIsNotAPlace(input, "Westminster");
        },
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it("asks locate-place for a boundary polygon", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-locate-place",
      prompt: "Get me the boundary of De Jordaan in Amsterdam",
      expectedArgs: {
        "tomtom-locate-place": (input) =>
          input.includeGeometry === true ||
          "includeGeometry was not set, so no boundary would be returned",
      },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });

  it("routes a single named place to locate-place, not the list tool", async () => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-locate-place",
      prompt: "What are the coordinates of Dam Square, Amsterdam?",
      forbiddenTools: ["tomtom-discover-places"],
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });
});
