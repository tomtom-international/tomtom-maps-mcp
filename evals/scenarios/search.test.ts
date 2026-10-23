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
 * Search selection. With two search tools, "did it call the search tool?" is
 * nearly tautological, so the assertions are mostly about ARGUMENTS, via
 * `expectedArgs`: which `where` mode, which area, which radius or detour.
 */

import { describe, expect, it } from "vitest";
import { FULL_SCENARIOS, MODEL } from "../harness";
import { canonicalAndRest, runToolScenario } from "./helpers";

/** Reads `where.mode`, tolerating the model omitting `where` entirely. */
const mode = (input: { where?: { mode?: string } }): string | undefined => input.where?.mode;

type Input = Record<string, unknown> & {
  query?: string;
  poiCategories?: string[];
  where?: {
    mode?: string;
    queries?: string[];
    query?: string;
    radiusMeters?: number;
    locations?: { query?: string }[];
    maxDetourTimeSeconds?: number;
    sortBy?: string;
  };
};
type Check = (input: Input) => string | true;

/** Every check passes, or the first failure. */
const all =
  (...checks: Check[]): Check =>
  (input) => {
    for (const check of checks) {
      const verdict = check(input);
      if (verdict !== true) return verdict;
    }
    return true;
  };

const hasMode =
  (expected: string): Check =>
  (input) =>
    mode(input) === expected || `expected mode "${expected}", got "${mode(input) ?? "none"}"`;

/** Each name appears in some `where.queries` entry, case-insensitively. */
const areasNamed =
  (...names: string[]): Check =>
  (input) => {
    const queries = (input.where?.queries ?? []).map((query) => query.toLowerCase());
    const missing = names.filter((name) => !queries.some((query) => query.includes(name)));
    return missing.length === 0 || `where.queries is missing ${missing.join(", ")}`;
  };

const nearbyQueryNames =
  (name: string): Check =>
  (input) =>
    String(input.where?.query ?? "")
      .toLowerCase()
      .includes(name) || `where.query does not name ${name}`;

const radiusBetween =
  (min: number, max: number): Check =>
  (input) => {
    const radius = input.where?.radiusMeters;
    return (
      (radius !== undefined && radius >= min && radius <= max) ||
      `expected radiusMeters in [${min}, ${max}], got ${radius ?? "none"}`
    );
  };

const detourBetween =
  (min: number, max: number): Check =>
  (input) => {
    const detour = input.where?.maxDetourTimeSeconds;
    return (
      (detour !== undefined && detour >= min && detour <= max) ||
      `expected maxDetourTimeSeconds in [${min}, ${max}], got ${detour ?? "none"}`
    );
  };

/** The trip's stops name each place, in order. */
const tripThrough =
  (...names: string[]): Check =>
  (input) => {
    const stops = (input.where?.locations ?? []).map((stop) =>
      String(stop.query ?? "").toLowerCase()
    );
    const positions = names.map((name) => stops.findIndex((stop) => stop.includes(name)));
    if (positions.includes(-1))
      return `where.locations does not name every one of ${names.join(", ")}`;
    return (
      positions.every((position, index) => index === 0 || position > positions[index - 1]) ||
      `where.locations is not in the order ${names.join(" → ")}`
    );
  };

const subjectMentions =
  (...words: string[]): Check =>
  (input) => {
    const subject = [input.query ?? "", ...(input.poiCategories ?? [])].join(" ").toLowerCase();
    return (
      words.some((word) => subject.includes(word)) ||
      `neither query nor poiCategories mention ${words.join(" / ")}`
    );
  };

/** The failure this whole design risks: the region passed as the search subject. */
const subjectIsNotAPlace = (input: { query?: string }, place: string): string | true => {
  const query = String(input.query ?? "").toLowerCase();
  return query.includes(place.toLowerCase())
    ? `"${place}" was passed as the search subject (\`query\`) instead of in \`where\``
    : true;
};

/**
 * The search and lookup tools, each with the tool it may defensibly reach for
 * first. The two search tools are each other's only plausible confusion.
 */
const SELECTION = [
  { tool: "tomtom-discover-places", acceptedAlternatives: ["tomtom-poi-categories"] },
  { tool: "tomtom-locate-place", acceptedAlternatives: ["tomtom-discover-places"] },
  { tool: "tomtom-reverse-geocode", acceptedAlternatives: [] },
  { tool: "tomtom-poi-categories", acceptedAlternatives: [] },
] as const;

describe.skipIf(!MODEL)("search tool selection", { timeout: 180_000, retry: 2 }, () => {
  for (const { tool, acceptedAlternatives } of SELECTION) {
    describe(tool, () => {
      const { canonical, rest } = canonicalAndRest(tool);

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
          input.response_detail === "geometry" ||
          'response_detail was not "geometry", so no boundary would be returned',
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

/**
 * Phrasings the registry prompts do not cover: units to convert, another
 * language, a neighbourhood, a name several cities share, two areas compared,
 * and a detour budget off a drive. Each asserts the ARGUMENTS, since picking the
 * search tool is the easy part.
 */
const HARDER_SEARCHES: { prompt: string; check: Check }[] = [
  {
    prompt: "Petrol stations within half a mile of Times Square",
    check: all(hasMode("nearby"), nearbyQueryNames("times square"), radiusBetween(700, 900)),
  },
  {
    prompt: "Encuentra farmacias a menos de 300 metros de la Sagrada Família",
    check: all(hasMode("nearby"), nearbyQueryNames("sagrada"), radiusBetween(250, 350)),
  },
  {
    prompt: "Cosy cafés in De Pijp, Amsterdam",
    check: all(hasMode("within"), areasNamed("pijp"), subjectMentions("caf", "coffee")),
  },
  {
    prompt: "Pubs in Cambridge, Massachusetts",
    check: all(
      hasMode("within"),
      (input) =>
        (input.where?.queries ?? []).some((query) => /\b(ma|massachusetts|usa?)\b/i.test(query)) ||
        "the Cambridge in where.queries does not say which one"
    ),
  },
  {
    prompt: "Which has more sushi restaurants, Rotterdam or The Hague?",
    check: all(
      hasMode("within"),
      (input) =>
        areasNamed("rotterdam")(input) === true ||
        areasNamed("hague")(input) === true ||
        areasNamed("haag")(input) === true ||
        "neither city appears in where.queries"
    ),
  },
  {
    prompt: "Find Albert Heijn supermarkets in Utrecht",
    check: all(
      hasMode("within"),
      areasNamed("utrecht"),
      (input) =>
        String(input.query ?? "")
          .toLowerCase()
          .includes("albert heijn") || "the brand is not in `query`"
    ),
  },
  {
    prompt:
      "I'm driving from Utrecht to Eindhoven. Find a charging station I can reach with at most 10 extra minutes of driving.",
    check: all(hasMode("maxDetour"), tripThrough("utrecht", "eindhoven"), detourBetween(540, 660)),
  },
  {
    prompt:
      "List petrol stations in order along the drive from Lyon to Marseille, no more than 5 minutes off the route",
    check: all(
      hasMode("maxDetour"),
      tripThrough("lyon", "marseille"),
      detourBetween(240, 360),
      (input) => input.where?.sortBy === "detourOffset" || 'sortBy was not "detourOffset"'
    ),
  },
  {
    prompt:
      "Somewhere to eat on the way from Amsterdam to Brussels via Antwerp, 15 minutes detour max",
    check: all(
      hasMode("maxDetour"),
      tripThrough("amsterdam", "antwerp", "brussel"),
      detourBetween(840, 960)
    ),
  },
];

describe.skipIf(!MODEL)("harder search phrasings", { timeout: 180_000, retry: 2 }, () => {
  it.each(HARDER_SEARCHES)("$prompt", async ({ prompt, check }) => {
    const outcome = await runToolScenario({
      expectedTool: "tomtom-discover-places",
      prompt,
      acceptedAlternatives: ["tomtom-poi-categories", "tomtom-locate-place"],
      expectedArgs: { "tomtom-discover-places": check as (input: unknown) => string | true },
    });
    expect(outcome.success, outcome.failureReason).toBe(true);
  });
});
