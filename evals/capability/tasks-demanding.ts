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
 * The demanding corpus (`EVAL_CORPUS=demanding`): questions whose answer is in
 * the raw data the tools fetch, but only after computing over it — fields no
 * tool summarises, geometry, two results combined, or a follow-up turn about an
 * earlier result. Any phase may answer: phase 1 by reading full results in
 * context, phase 2 with `analyse`, phase 3 with `analyse-datasets` over datasets,
 * and with `derive-datasets` where a computed area or stretch feeds the next call.
 *
 * Every task has a live oracle (`oracles.ts`) that recomputes the answer from
 * fresh data after the agent's run, and the judge scores against it within the
 * task's `tolerance`. Every task is `expected: "blocked"`: `answered` is recorded,
 * never asserted, as the corpus measures what each phase can reach rather than a
 * floor it must hold. Grounding is asserted as on every task.
 */

import type { Place } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import {
  alongLine,
  alwaysOpen,
  areaOf,
  boundaryOf,
  brandsOf,
  brandTally,
  byDistanceFrom,
  categoryOf,
  comingWeekday,
  connectorsOf,
  dateLabel,
  groupedWithin,
  h3Cells,
  hasConnectorOf,
  incidentsIn,
  incidentsInBox,
  incidentsNear,
  instructionsOf,
  km,
  listTop,
  metresAlong,
  metresBetween,
  metresToGeometry,
  openAt,
  opensOn,
  placeLabel,
  placesAlongLine,
  placesAround,
  placesAroundEach,
  placesIn,
  placesNear,
  placeWithAddress,
  pointOf,
  type Reference,
  routeBetween,
  secondsToVertex,
  sectionLengths,
  stretchOf,
  tally,
} from "./oracles";
import type { CapabilityTask } from "./tasks";
import { measured, type Tolerance } from "./tolerance";

export interface DemandingTask extends CapabilityTask {
  /** Follow-up user turns, each sent after the agent answered the one before. */
  turns?: string[];
  /** The margins `rubric` allows, by the quantity each applies to; empty for an exact match. */
  tolerance: Readonly<Record<string, Tolerance>>;
  /** Recomputes the answer from live data after the agent's run. */
  oracle: () => Promise<Reference>;
}

/** The days the opening-hours tasks ask about, named in their prompts by date. */
const SATURDAY = comingWeekday("Sat", "Europe/Amsterdam");
const SUNDAY = comingWeekday("Sun", "Europe/Amsterdam");
const FRIDAY = comingWeekday("Fri", "Europe/Amsterdam");

const isoDate = ({ year, month, day }: { year: number; month: number; day: number }) =>
  `${year}-${month}-${day}`;

export const DEMANDING_TASKS: readonly DemandingTask[] = [
  // ---------------------------------------------------------------------------
  // Deep fields of one result
  // ---------------------------------------------------------------------------
  {
    id: "deep-traffic-length-by-category",
    prompt:
      "For all current traffic incidents in Amsterdam, give the total affected road length in km " +
      "for each incident category, and name the single longest incident: where it runs from and " +
      "to, and how long it is in metres.",
    capability: "aggregate-at-scale",
    expected: "blocked",
    ...measured(
      { categoryLength: { relative: 0.2 }, longest: { relative: 0.1 } },
      (within) =>
        `Per-category lengths within ${within.categoryLength} of the reference for each category ` +
        "the reference lists at 0.5 km or more, and the same longest incident (its from/to) " +
        `within ${within.longest} of its length. A list missing such a category, or a different ` +
        "longest incident, fails."
    ),
    oracle: async () => {
      const incidents = await incidentsIn("Amsterdam");
      const lengths = new Map<string, number>();
      for (const { properties } of incidents) {
        lengths.set(
          properties.category,
          (lengths.get(properties.category) ?? 0) + (properties.lengthInMeters ?? 0)
        );
      }
      const longest = [...incidents].sort(
        (a, b) => (b.properties.lengthInMeters ?? 0) - (a.properties.lengthInMeters ?? 0)
      )[0];
      return {
        answer:
          `${incidents.length} incidents. Length by category: ` +
          [...lengths].map(([category, metres]) => `${category} ${km(metres)} km`).join(", ") +
          `. Longest: ${longest?.properties.from} → ${longest?.properties.to}, ` +
          `${Math.round(longest?.properties.lengthInMeters ?? 0)} m.`,
      };
    },
  },
  {
    id: "deep-traffic-roadworks-ending",
    prompt:
      "How many roadworks in Berlin, current or planned, started more than 30 days ago and are " +
      "scheduled to end within the next 7 days?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.15, absolute: 2, below: 15 } },
      (within) =>
        `A count within ${within.count} of the reference, stating it covers both current and ` +
        "planned roadworks."
    ),
    oracle: async () => {
      const now = Date.now();
      const incidents = await incidentsIn("Berlin", {
        categoryFilter: ["roadworks"],
        timeValidityFilter: ["present", "future"],
      });
      const matching = incidents.filter(({ properties: { startTime, endTime } }) => {
        if (!startTime || !endTime) return false;
        const started = new Date(startTime).getTime();
        const ends = new Date(endTime).getTime();
        return started < now - 30 * 86_400_000 && ends >= now && ends <= now + 7 * 86_400_000;
      });
      return {
        answer: `${matching.length} of ${incidents.length} roadworks (current and planned).`,
      };
    },
  },
  {
    id: "deep-places-open-late-saturday",
    prompt:
      "Take the 100 restaurants nearest Dam Square in Amsterdam, within 1.5 km. How many are open " +
      `at 23:30 local time on ${dateLabel(SATURDAY)}? Count only those whose opening hours are known, ` +
      "say how many have no known hours, and break the open ones down by their most specific " +
      "category (top 3).",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { open: { absolute: 3 }, unknownHours: { absolute: 5 } },
      (within) =>
        `The open count within ${within.open} of the reference, the unknown-hours count within ` +
        `${within.unknownHours}, and a top-3 breakdown sharing at least two categories with the ` +
        "reference."
    ),
    oracle: async () => {
      const places = await placesNear(["restaurant"], "Dam Square, Amsterdam", 1500, 100);
      const at = { ...SATURDAY, hour: 23, minute: 30 };
      const known = places.filter((place) => openAt(place, at) !== undefined);
      const open = known.filter((place) => openAt(place, at));
      return {
        answer:
          `${places.length} restaurants; ${open.length} open at 23:30 on ${isoDate(at)}; ` +
          `${places.length - known.length} with no known hours. ` +
          `Open by category: ${listTop(tally(open, categoryOf))}.`,
      };
    },
  },
  {
    id: "deep-ev-power-by-brand",
    prompt:
      "Take the 100 EV charging stations nearest Utrecht Centraal, within 2 km. Add up the rated " +
      "power of every connector — counting each connector as many times as the station has it — " +
      "and give the total kW per charging brand, top 3, plus the overall total.",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { total: { relative: 0.15 }, leadingBrand: { relative: 0.15 } },
      (within) =>
        `An overall total within ${within.total} of the reference, and a top 3 whose first brand ` +
        `matches the reference's, with its total within ${within.leadingBrand}.`
    ),
    oracle: async () => {
      const stations = await placesNear(
        ["electric vehicle station"],
        "Utrecht Centraal",
        2000,
        100
      );
      const brands = brandsOf(stations);
      const byBrand = new Map<string, number>();
      let unbranded = 0;
      for (const [index, station] of stations.entries()) {
        const kW = connectorsOf(station).reduce(
          (sum, { connector, count }) => sum + (connector?.ratedPowerKW ?? 0) * (count ?? 1),
          0
        );
        const brand = brands[index];
        if (brand === undefined) unbranded += kW;
        else byBrand.set(brand, (byBrand.get(brand) ?? 0) + kW);
      }
      const total = [...byBrand.values()].reduce((sum, kW) => sum + kW, unbranded);
      const top = [...byBrand]
        .sort((a, b) => b[1] - a[1])
        .map(([brand, kW]) => [brand, Math.round(kW)] as const);
      return {
        answer:
          `${stations.length} stations, ${Math.round(total)} kW in all ` +
          `(${Math.round(unbranded)} kW at stations with no brand). ` +
          `Top brands: ${listTop(top, 3, "kW")}.`,
      };
    },
  },
  {
    id: "deep-route-low-emission-share",
    prompt:
      "Driving from Amsterdam to Paris, what share of the route's distance lies inside low-emission " +
      "zones, and how many separate low-emission zone stretches does it pass through?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { share: { points: 2 }, stretches: { absolute: 1 } },
      (within) =>
        `A share within ${within.share} of the reference and the same number of stretches ` +
        `(${within.stretches}).`
    ),
    oracle: async () => {
      const route = await routeBetween(["Amsterdam", "Paris"]);
      const zones = route.properties.sections.lowEmissionZone ?? [];
      const inside = sectionLengths(route.geometry, zones).reduce((sum, metres) => sum + metres, 0);
      const total = route.properties.summary.lengthInMeters;
      return {
        answer:
          `${km(inside)} km of ${km(total)} km in low-emission zones: ` +
          `${((inside / total) * 100).toFixed(1)}%, over ${zones.length} stretches.`,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Geometry over one result
  // ---------------------------------------------------------------------------
  {
    id: "geometry-closest-pharmacy-pair",
    prompt:
      "Among the pharmacies within 1 km of Rotterdam Centraal, which two are closest to each other, " +
      "and how far apart are they in metres?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { distance: { absolute: 15, unit: "m" } },
      (within) =>
        "Names the same pair as the reference (either order) with a distance within " +
        `${within.distance}. When the reference finds fewer than two pharmacies, saying so is correct.`
    ),
    oracle: async () => {
      const pharmacies = await placesNear(["pharmacy"], "Rotterdam Centraal", 1000, 100);
      let best: [Place, Place, number] | undefined;
      for (const [i, a] of pharmacies.entries()) {
        for (const b of pharmacies.slice(i + 1)) {
          const metres = metresBetween(a, b);
          if (!best || metres < best[2]) best = [a, b, metres];
        }
      }
      return {
        answer: best
          ? `${pharmacies.length} pharmacies. Closest pair: ${placeLabel(best[0])} and ` +
            `${placeLabel(best[1])}, ${Math.round(best[2])} m apart.`
          : `${pharmacies.length} pharmacies: no pair.`,
      };
    },
  },
  {
    id: "geometry-cafe-h3-density",
    prompt:
      "Of the 100 cafés nearest Amsterdam Centraal, searching within 5 km, which H3 cell at " +
      "resolution 8 contains the most, and how many does it contain?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { count: { absolute: 2 } },
      (within) => `The same H3 cell id as the reference and a count within ${within.count}.`
    ),
    oracle: async () => {
      const cafes = await placesNear(["cafe"], "Amsterdam Centraal", 5000, 100);
      const [[cell, count] = ["none", 0]] = h3Cells(cafes, 8);
      return {
        answer: `${cafes.length} cafés. Densest resolution-8 cell: ${cell}, ${count} cafés.`,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Two results combined
  // ---------------------------------------------------------------------------
  {
    id: "cross-chargers-near-closures",
    prompt:
      "Take the 100 EV charging stations nearest Dam Square, Amsterdam, within 1.5 km. How many " +
      "of them are within 100 m of a current road closure in Amsterdam? Name the three closest to " +
      "a closure, each with its address, the closure and the distance in metres.",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      {
        count: { relative: 0.25, absolute: 3, below: 12 },
        distance: { absolute: 20, unit: "m" },
      },
      (within) =>
        `A count within ${within.count} of the reference, and at least two of the reference's ` +
        `three stations (by address), each with a distance within ${within.distance}.`
    ),
    oracle: async () => {
      const [closures, stations] = await Promise.all([
        incidentsIn("Amsterdam", { categoryFilter: ["road-closed"] }),
        placesNear(["electric vehicle station"], "Dam Square, Amsterdam", 1500, 100),
      ]);
      const nearest = stations
        .map((station) => {
          const [closure, metres] = closures
            .map(
              (incident) =>
                [
                  incident,
                  metresToGeometry(station.geometry.coordinates, incident.geometry),
                ] as const
            )
            .sort((a, b) => a[1] - b[1])[0] ?? [undefined, Number.POSITIVE_INFINITY];
          return { station, closure, metres };
        })
        .filter(({ metres }) => metres <= 100)
        .sort((a, b) => a.metres - b.metres);
      return {
        answer:
          `${stations.length} stations and ${closures.length} closures checked; ` +
          `${nearest.length} within 100 m. Closest: ` +
          nearest
            .slice(0, 3)
            .map(
              ({ station, closure, metres }) =>
                `${placeWithAddress(station)}, ${Math.round(metres)} m from ` +
                `${closure?.properties.from} → ${closure?.properties.to}`
            )
            .join("; ") +
          ".",
      };
    },
  },
  {
    id: "cross-supermarkets-along-route",
    prompt:
      "Driving from Utrecht Centraal to Amersfoort Centraal, which supermarkets are within 300 m " +
      "of the route? List them in the order I pass them.",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      {},
      () =>
        "At least two thirds of the reference's supermarkets, in the same relative order, and none " +
        "farther than 300 m from the route by the reference's measure."
    ),
    oracle: async () => {
      const route = await routeBetween(["Utrecht Centraal", "Amersfoort Centraal"]);
      const along = alongLine(
        route.geometry,
        await placesAlongLine(["supermarket"], route.geometry, 300)
      );
      return {
        answer:
          `${along.length} supermarkets within 300 m, in route order: ` +
          along.map(({ place, metres }) => `${placeLabel(place)} (km ${km(metres)})`).join("; ") +
          ".",
      };
    },
  },

  // ---------------------------------------------------------------------------
  // A conversation about an earlier result
  // ---------------------------------------------------------------------------
  {
    id: "turns-route-fast-chargers-halfway",
    prompt: "Plan a drive from Amsterdam to Brussels.",
    turns: [
      "Which EV chargers of at least 150 kW are within 2 km of that route?",
      "Of those, which is closest to the halfway point of the drive, and how far along the route is it?",
    ],
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { along: { absolute: 5, unit: "km" } },
      (within) =>
        "The final answer names the same charger as the reference (or one within 2 km of it, when " +
        "the reference's distance to the halfway point is within 2 km of its own) and gives how far " +
        `along the route it is within ${within.along}.`
    ),
    oracle: async () => {
      const route = await routeBetween(["Amsterdam", "Brussels"]);
      const line = route.geometry;
      const fast = await placesAlongLine(["electric vehicle station"], line, 2000, {
        minPowerKW: 150,
      });
      const length = route.properties.summary.lengthInMeters;
      const halfway = turf.along(line, length / 2, { units: "meters" }).geometry.coordinates;
      const [closest] = byDistanceFrom(halfway, fast);
      return {
        answer: closest
          ? `${fast.length} chargers ≥150 kW within 2 km of the route. Closest to halfway: ` +
            `${placeLabel(closest.place)}, ${km(closest.metres)} km from the halfway point, ` +
            `${km(metresAlong(line, closest.place.geometry.coordinates))} km along the ` +
            `${km(length)} km route.`
          : `${fast.length} chargers ≥150 kW within 2 km.`,
      };
    },
  },
  // ---------------------------------------------------------------------------
  // Deep fields: traffic
  // ---------------------------------------------------------------------------
  {
    id: "deep-traffic-top-events",
    prompt:
      "Across all current traffic incidents in Rotterdam, which three event descriptions occur " +
      "most often, and on how many incidents does each appear?",
    capability: "aggregate-at-scale",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.15 } },
      (within) =>
        `The same top three descriptions as the reference, each count within ${within.count}.`
    ),
    oracle: async () => {
      const incidents = await incidentsIn("Rotterdam");
      const events = tally(
        incidents.flatMap(({ properties }) => [
          ...new Set((properties.events ?? []).map((event) => event.description)),
        ]),
        (description) => description
      );
      return { answer: `${incidents.length} incidents. Top events: ${listTop(events)}.` };
    },
  },
  {
    id: "deep-traffic-probable-share",
    prompt:
      "Of all current traffic incidents in Utrecht, what share are only 'probable' rather than " +
      "'certain', and how many incidents is that?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { share: { points: 5 }, count: { absolute: 3 } },
      (within) =>
        `A share within ${within.share} of the reference and a count within ${within.count}.`
    ),
    oracle: async () => {
      const incidents = await incidentsIn("Utrecht");
      const probable = incidents.filter(
        ({ properties }) => properties.probabilityOfOccurrence === "probable"
      ).length;
      return {
        answer:
          `${probable} of ${incidents.length} incidents are probable: ` +
          `${incidents.length ? ((probable / incidents.length) * 100).toFixed(1) : 0}%.`,
      };
    },
  },
  {
    id: "deep-traffic-planned-next-week",
    prompt:
      "How many planned (not yet started) traffic incidents in Amsterdam start within the next 7 " +
      "days, and which one starts soonest: where does it run from and to, and when does it start?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      {
        count: { relative: 0.2, absolute: 3, below: 15 },
        start: { absolute: 60, unit: "minutes" },
      },
      (within) =>
        `A count within ${within.count} and the same soonest incident (from/to) as the reference, ` +
        `or one starting within ${within.start} of it.`
    ),
    oracle: async () => {
      const now = Date.now();
      const planned = (await incidentsIn("Amsterdam", { timeValidityFilter: ["future"] }))
        .filter(({ properties: { startTime } }) => {
          const starts = startTime ? new Date(startTime).getTime() : Number.NaN;
          return starts > now && starts <= now + 7 * 86_400_000;
        })
        .sort(
          (a, b) =>
            new Date(a.properties.startTime ?? 0).getTime() -
            new Date(b.properties.startTime ?? 0).getTime()
        );
      const [soonest] = planned;
      return {
        answer:
          `${planned.length} planned incidents start within 7 days.` +
          (soonest
            ? ` Soonest: ${soonest.properties.from} → ${soonest.properties.to}, starting ` +
              `${soonest.properties.startTime}.`
            : ""),
      };
    },
  },
  {
    id: "deep-traffic-oldest-closure",
    prompt:
      "Which current road closure in Rotterdam has been in place the longest? Where does it run " +
      "from and to, and since when?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured({}, () => "The same closure (from/to) and start date as the reference."),
    oracle: async () => {
      const closures = (await incidentsIn("Rotterdam", { categoryFilter: ["road-closed"] })).filter(
        ({ properties }) => properties.startTime
      );
      const [oldest] = closures.sort(
        (a, b) =>
          new Date(a.properties.startTime ?? 0).getTime() -
          new Date(b.properties.startTime ?? 0).getTime()
      );
      return {
        answer: oldest
          ? `${closures.length} closures with a start time. Oldest: ${oldest.properties.from} → ` +
            `${oldest.properties.to}, since ${oldest.properties.startTime}.`
          : "No current closures with a start time.",
      };
    },
  },
  {
    id: "deep-traffic-numbered-roads",
    prompt:
      "For all current traffic incidents in The Hague, what total length in km is on numbered " +
      "roads (those with a road number) and what total is on unnumbered roads?",
    capability: "aggregate-at-scale",
    expected: "blocked",
    ...measured(
      { total: { relative: 0.15, absolute: 0.3, below: 2, unit: "km" } },
      (within) => `Both totals within ${within.total} of the reference.`
    ),
    oracle: async () => {
      const incidents = await incidentsIn("The Hague");
      const [numbered, unnumbered] = incidents.reduce(
        ([on, off], { properties }) =>
          properties.roadNumbers?.length
            ? [on + (properties.lengthInMeters ?? 0), off]
            : [on, off + (properties.lengthInMeters ?? 0)],
        [0, 0]
      );
      return {
        answer:
          `${incidents.length} incidents: ${km(numbered)} km on numbered roads, ` +
          `${km(unnumbered)} km on unnumbered roads.`,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Deep fields: places
  // ---------------------------------------------------------------------------
  {
    id: "deep-places-sunday-earliest",
    prompt:
      "Of the 50 cafés nearest Utrecht Centraal, within 2 km, which opens earliest on " +
      `${dateLabel(SUNDAY)}, and at what local time? How many of the 50 open before 09:00 that ` +
      "day? A café still open from the night before doesn't count as opening.",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { count: { absolute: 2 } },
      (within) =>
        "The same earliest opening time as the reference (a café opening at that time; ties may be " +
        `any of them) and a before-09:00 count within ${within.count}.`
    ),
    oracle: async () => {
      const cafes = await placesNear(["cafe"], "Utrecht Centraal", 2000, 50);
      const opening = cafes
        .map((cafe) => ({ cafe, opens: opensOn(cafe, SUNDAY) }))
        .filter((entry): entry is { cafe: Place; opens: string } => entry.opens !== undefined)
        .sort((a, b) => a.opens.localeCompare(b.opens));
      const [first] = opening;
      return {
        answer:
          `${cafes.length} cafés, ${opening.length} open that Sunday (${isoDate(SUNDAY)}).` +
          (first ? ` Earliest: ${placeLabel(first.cafe)} at ${first.opens}.` : "") +
          ` ${opening.filter(({ opens }) => opens < "09:00").length} open before 09:00.`,
      };
    },
  },
  {
    id: "deep-places-fuel-always-open",
    prompt:
      "Of the 100 fuel stations nearest Rotterdam Centraal, within 10 km, how many are open around " +
      "the clock for the whole of the next seven days? How many have no known opening hours?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { count: { absolute: 4 } },
      (within) => `Both counts within ${within.count} of the reference.`
    ),
    oracle: async () => {
      const stations = await placesNear(["petrol station"], "Rotterdam Centraal", 10_000, 100);
      return {
        answer:
          `${stations.length} stations: ${stations.filter((station) => alwaysOpen(station)).length} ` +
          `open around the clock, ${stations.filter((station) => alwaysOpen(station) === undefined).length} ` +
          "with no known hours.",
      };
    },
  },
  {
    id: "deep-places-postcode-area",
    prompt:
      "Of the 100 supermarkets nearest Amsterdam Centraal, within 3 km, which 4-digit postcode " +
      "area has the most of them, and how many?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { count: { absolute: 1 } },
      (within) =>
        "The same postcode area as the reference (or one tied with it) and a count within " +
        `${within.count}.`
    ),
    oracle: async () => {
      const shops = await placesNear(["supermarket"], "Amsterdam Centraal", 3000, 100);
      const postcodes = tally(
        shops,
        (shop) => shop.properties.address?.postalCode?.match(/\d{4}/)?.[0] ?? "none"
      );
      return {
        answer: `${shops.length} supermarkets. Top postcode areas: ${listTop(postcodes)}.`,
      };
    },
  },
  {
    id: "deep-places-fuel-brand-share",
    prompt:
      "Among the 100 fuel stations nearest Utrecht Centraal, within 15 km, which brand has the " +
      "most stations, and what share of the 100 is that?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { share: { points: 4 } },
      (within) => `The same leading brand as the reference and a share within ${within.share}.`
    ),
    oracle: async () => {
      const stations = await placesNear(["petrol station"], "Utrecht Centraal", 15_000, 100);
      const share = (count: number) =>
        `${((count / Math.max(stations.length, 1)) * 100).toFixed(0)}%`;
      return {
        answer:
          `${stations.length} stations. Brands: ` +
          brandTally(stations)
            .slice(0, 3)
            .map(([brand, count]) => `${brand} ${count} (${share(count)})`)
            .join(", ") +
          ".",
      };
    },
  },
  {
    id: "deep-ev-connector-mix",
    prompt:
      "Take the 100 EV charging stations nearest Eindhoven Centraal, within 5 km. How many " +
      "connectors of each connector type are there in total (counting each station's connector " +
      "counts)? Give the top three types.",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { total: { relative: 0.15 } },
      (within) =>
        `The same top three connector types as the reference, each total within ${within.total}.`
    ),
    oracle: async () => {
      const stations = await placesNear(
        ["electric vehicle station"],
        "Eindhoven Centraal",
        5000,
        100
      );
      const totals = new Map<string, number>();
      for (const { connector, count } of stations.flatMap(connectorsOf)) {
        const type = connector?.type ?? "unknown";
        totals.set(type, (totals.get(type) ?? 0) + (count ?? 1));
      }
      return {
        answer:
          `${stations.length} stations. Connectors by type: ` +
          `${listTop([...totals].sort((a, b) => b[1] - a[1]))}.`,
      };
    },
  },
  {
    id: "deep-places-missing-contact",
    prompt:
      "Of the 100 restaurants nearest Rotterdam Centraal, within 2 km, how many list no phone " +
      "number, and how many list no website?",
    capability: "deep-attributes",
    expected: "blocked",
    ...measured(
      { count: { absolute: 3 } },
      (within) => `Both counts within ${within.count} of the reference.`
    ),
    oracle: async () => {
      const places = await placesNear(["restaurant"], "Rotterdam Centraal", 2000, 100);
      const lacking = (field: "phone" | "url") =>
        places.filter(({ properties }) => !properties.poi?.[field]).length;
      return {
        answer:
          `${places.length} restaurants: ${lacking("phone")} without a phone number, ` +
          `${lacking("url")} without a website.`,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Deep fields: routes
  // ---------------------------------------------------------------------------
  {
    id: "deep-route-toll-gates",
    prompt:
      "Driving from Lyon to Marseille, how many toll gates do I pass through, and at which km " +
      "from Lyon is each?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { position: { absolute: 2, unit: "km" } },
      (within) =>
        "The same number of toll gates as the reference, each within " +
        `${within.position} of its position.`
    ),
    oracle: async () => {
      const gates = instructionsOf(await routeBetween(["Lyon", "Marseille"])).filter(
        ({ maneuver }) => maneuver === "TOLLGATE"
      );
      return {
        answer:
          `${gates.length} toll gates, at km ` +
          (gates.map(({ routeOffsetInMeters }) => km(routeOffsetInMeters)).join(", ") || "none") +
          ".",
      };
    },
  },
  {
    id: "deep-route-border-crossing",
    prompt:
      "Driving from Amsterdam to Cologne, after how many km do I cross into Germany, and how many " +
      "manoeuvres (not counting the departure) come before the border?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { border: { absolute: 2, unit: "km" }, manoeuvres: { absolute: 2 } },
      (within) =>
        `A border distance within ${within.border} of the reference and a manoeuvre count within ` +
        `${within.manoeuvres}.`
    ),
    oracle: async () => {
      const instructions = instructionsOf(await routeBetween(["Amsterdam", "Cologne"]));
      const border = instructions.findIndex(({ maneuver }) => maneuver === "CROSS_BORDER");
      if (border < 0) return { answer: "The route crosses no border by its guidance." };
      return {
        answer:
          `The border is at km ${km(instructions[border].routeOffsetInMeters)}, after ` +
          `${instructions.slice(0, border).filter(({ maneuver }) => maneuver !== "DEPART").length} ` +
          "manoeuvres.",
      };
    },
  },
  {
    id: "deep-route-longest-stretch",
    prompt:
      "Driving from Lyon to Marseille, what is the longest stretch without any manoeuvre, in km, " +
      "and what is the instruction at its start?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { length: { absolute: 2, unit: "km" } },
      (within) =>
        `A length within ${within.length} of the reference and the same starting instruction ` +
        "(its wording may be paraphrased)."
    ),
    oracle: async () => {
      const instructions = instructionsOf(await routeBetween(["Lyon", "Marseille"]));
      const [longest] = instructions
        .slice(0, -1)
        .map((instruction, index) => ({
          instruction,
          metres: instructions[index + 1].routeOffsetInMeters - instruction.routeOffsetInMeters,
        }))
        .sort((a, b) => b.metres - a.metres);
      return {
        answer:
          `Longest stretch without a manoeuvre: ${km(longest.metres)} km, starting at km ` +
          `${km(longest.instruction.routeOffsetInMeters)} with "${longest.instruction.message}".`,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Geometry over one result
  // ---------------------------------------------------------------------------
  {
    id: "geometry-hotels-north-south",
    prompt:
      "Of the 100 hotels nearest Amsterdam Centraal, within 3 km, which is farthest north, which " +
      "is farthest south, and how far apart are those two in km?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { distance: { absolute: 0.2, unit: "km" } },
      (within) => `The same two hotels as the reference and a distance within ${within.distance}.`
    ),
    oracle: async () => {
      const hotels = await placesNear(["hotel"], "Amsterdam Centraal", 3000, 100);
      const byLatitude = [...hotels].sort(
        (a, b) => b.geometry.coordinates[1] - a.geometry.coordinates[1]
      );
      const [north, south] = [byLatitude[0], byLatitude.at(-1)];
      if (!north || !south) return { answer: "No hotels found." };
      return {
        answer:
          `${hotels.length} hotels. Northernmost: ${placeWithAddress(north)}; southernmost: ` +
          `${placeWithAddress(south)}; ${km(metresBetween(north, south))} km apart.`,
      };
    },
  },
  {
    id: "geometry-restaurant-hull-area",
    prompt:
      "What area, in km², does the convex hull of the 100 restaurants nearest Utrecht Centraal " +
      "(within 3 km) cover?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { area: { relative: 0.1 } },
      (within) => `An area within ${within.area} of the reference.`
    ),
    oracle: async () => {
      const places = await placesNear(["restaurant"], "Utrecht Centraal", 3000, 100);
      const hull = turf.convex(
        turf.featureCollection(places.map((place) => turf.point(place.geometry.coordinates)))
      );
      return {
        answer: `${places.length} restaurants; convex hull ${hull ? (turf.area(hull) / 1e6).toFixed(2) : 0} km².`,
      };
    },
  },
  {
    id: "geometry-route-stray",
    prompt:
      "Driving from Amsterdam to Groningen, what is the farthest the route strays from the " +
      "straight line between start and end, in km, and roughly where?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { distance: { relative: 0.1 } },
      (within) =>
        `A distance within ${within.distance} of the reference; the place may be described freely.`
    ),
    oracle: async () => {
      const { coordinates } = (await routeBetween(["Amsterdam", "Groningen"])).geometry;
      const straight = turf.lineString([coordinates[0], coordinates[coordinates.length - 1]]);
      const [farthest] = coordinates
        .map((vertex) => ({
          vertex,
          metres: turf.pointToLineDistance(vertex, straight, { units: "meters" }),
        }))
        .sort((a, b) => b.metres - a.metres);
      return {
        answer:
          `At most ${km(farthest.metres)} km from the straight line, at ` +
          `[${farthest.vertex.map((value) => value.toFixed(3)).join(", ")}].`,
      };
    },
  },
  {
    id: "geometry-incidents-near-station",
    prompt:
      "How many current traffic incidents in Rotterdam lie within 1 km of Rotterdam Centraal, and " +
      "which is nearest to the station: where does it run from and to, and how far is it?",
    capability: "route-geometry",
    expected: "blocked",
    ...measured(
      { count: { absolute: 2 }, distance: { absolute: 30, unit: "m" } },
      (within) =>
        `A count within ${within.count} and the same nearest incident (from/to) with a distance ` +
        `within ${within.distance}.`
    ),
    oracle: async () => {
      const [incidents, station] = await Promise.all([
        incidentsIn("Rotterdam"),
        pointOf("Rotterdam Centraal"),
      ]);
      const near = incidents
        .map((incident) => ({ incident, metres: metresToGeometry(station, incident.geometry) }))
        .filter(({ metres }) => metres <= 1000)
        .sort((a, b) => a.metres - b.metres);
      const [nearest] = near;
      return {
        answer:
          `${near.length} of ${incidents.length} incidents within 1 km.` +
          (nearest
            ? ` Nearest: ${nearest.incident.properties.from} → ${nearest.incident.properties.to}, ` +
              `${Math.round(nearest.metres)} m.`
            : ""),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Two results combined
  // ---------------------------------------------------------------------------
  {
    id: "cross-incidents-on-route",
    prompt:
      "I'm driving from Amsterdam Centraal to Utrecht Centraal. How many current traffic incidents " +
      "in Amsterdam lie within 50 m of my route, and which will I reach first?",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { count: { absolute: 2 } },
      (within) =>
        `A count within ${within.count} and the same first incident (from/to) as the reference.`
    ),
    oracle: async () => {
      const [route, incidents] = await Promise.all([
        routeBetween(["Amsterdam Centraal", "Utrecht Centraal"]),
        incidentsIn("Amsterdam"),
      ]);
      const onRoute = incidentsNear(route.geometry, incidents, 50);
      const [first] = onRoute;
      return {
        answer:
          `${onRoute.length} incidents within 50 m of the route.` +
          (first
            ? ` First reached: ${first.incident.properties.from} → ${first.incident.properties.to}, ` +
              `at km ${km(first.along)}.`
            : ""),
      };
    },
  },
  {
    id: "cross-cafes-near-pharmacies",
    prompt:
      "For each of the 10 pharmacies nearest Utrecht Centraal, count the cafés within 200 m of it, " +
      "among the 100 cafés nearest Utrecht Centraal (within 2 km). Which pharmacy has the most " +
      "cafés nearby, and how many?",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { count: { absolute: 1 } },
      (within) =>
        `The same pharmacy as the reference (or one tied with it) and a count within ${within.count}.`
    ),
    oracle: async () => {
      const [pharmacies, cafes] = await Promise.all([
        placesNear(["pharmacy"], "Utrecht Centraal", 2000, 10),
        placesNear(["cafe"], "Utrecht Centraal", 2000, 100),
      ]);
      return {
        answer:
          "Cafés within 200 m: " +
          groupedWithin(pharmacies, cafes, 200)
            .map(({ centre, near }) => `${placeWithAddress(centre)} ${near.length}`)
            .join("; ") +
          ".",
      };
    },
  },
  {
    id: "cross-hotel-farthest-supermarket",
    prompt:
      "Of the 20 hotels nearest Amsterdam Centraal (within 2 km), which is farthest from its nearest " +
      "supermarket, among the 100 supermarkets nearest Amsterdam Centraal within 3 km? How far is it?",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { distance: { absolute: 25, unit: "m" } },
      (within) => `The same hotel as the reference and a distance within ${within.distance}.`
    ),
    oracle: async () => {
      const [hotels, shops] = await Promise.all([
        placesNear(["hotel"], "Amsterdam Centraal", 2000, 20),
        placesNear(["supermarket"], "Amsterdam Centraal", 3000, 100),
      ]);
      const [worst] = hotels
        .map((hotel) => ({
          hotel,
          metres: Math.min(...shops.map((shop) => metresBetween(hotel, shop))),
        }))
        .sort((a, b) => b.metres - a.metres);
      return {
        answer: worst
          ? `${hotels.length} hotels, ${shops.length} supermarkets. Worst served: ` +
            `${placeWithAddress(worst.hotel)}, ${Math.round(worst.metres)} m from its nearest supermarket.`
          : "No hotels found.",
      };
    },
  },
  {
    id: "cross-two-routes-shared",
    prompt:
      "Compare the fastest route from Utrecht to Rotterdam with the fastest route from Utrecht to " +
      "The Hague. For how many km from Utrecht do they share the same road before they split?",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { length: { absolute: 3, unit: "km" } },
      (within) => `A shared length within ${within.length} of the reference.`
    ),
    oracle: async () => {
      const [toRotterdam, toTheHague] = await Promise.all([
        routeBetween(["Utrecht", "Rotterdam"]),
        routeBetween(["Utrecht", "The Hague"]),
      ]);
      const [a, b] = [toRotterdam.geometry, toTheHague.geometry];
      const split = a.coordinates.findIndex(
        (vertex) => turf.pointToLineDistance(vertex, b, { units: "meters" }) > 50
      );
      const shared =
        split <= 0 ? 0 : turf.length(turf.feature(stretchOf(a, 0, split)), { units: "meters" });
      return { answer: `The routes share the first ${km(shared)} km from Utrecht.` };
    },
  },
  {
    id: "cross-chargers-in-jordaan",
    prompt:
      "Of the 100 EV charging stations nearest the Westerkerk in Amsterdam (within 2 km), how many " +
      "lie inside the boundary of the Jordaan neighbourhood?",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.15, absolute: 2, below: 15 } },
      (within) => `A count within ${within.count} of the reference.`
    ),
    oracle: async () => {
      const [stations, jordaan] = await Promise.all([
        placesNear(["electric vehicle station"], "Westerkerk, Amsterdam", 2000, 100),
        boundaryOf("Jordaan, Amsterdam"),
      ]);
      const inside = stations.filter((station) =>
        turf.booleanPointInPolygon(station.geometry.coordinates, jordaan)
      ).length;
      return { answer: `${inside} of ${stations.length} stations are inside the Jordaan.` };
    },
  },
  {
    id: "cross-fast-charger-gaps",
    prompt:
      "Driving from Amsterdam to Paris, consider every charger of at least 150 kW within 1 km of " +
      "the route. What is the longest gap along the route without one, in km, and between which " +
      "points of the drive (km from Amsterdam)?",
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { gap: { absolute: 15, unit: "km" }, start: { absolute: 15, unit: "km" } },
      (within) =>
        `A longest gap within ${within.gap} of the reference, starting within ${within.start} ` +
        "of its start."
    ),
    oracle: async () => {
      const route = await routeBetween(["Amsterdam", "Paris"]);
      const found = await placesAlongLine(["electric vehicle station"], route.geometry, 1000, {
        minPowerKW: 150,
      });
      const along = [
        ...new Set(alongLine(route.geometry, found).map(({ metres }) => Math.round(metres))),
      ];
      const stops = [0, ...along, route.properties.summary.lengthInMeters];
      const [gap] = stops
        .slice(1)
        .map((end, index) => ({ from: stops[index], to: end }))
        .sort((a, b) => b.to - b.from - (a.to - a.from));
      return {
        answer:
          `${along.length} fast chargers within 1 km. Longest gap: ${km(gap.to - gap.from)} km, ` +
          `from km ${km(gap.from)} to km ${km(gap.to)}.`,
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Conversations about an earlier result
  // ---------------------------------------------------------------------------
  {
    id: "turns-italian-open-late-near-museum",
    prompt: "Find up to 50 Italian restaurants within 1 km of Leidseplein, Amsterdam.",
    turns: [
      `Which of them are still open at 22:30 on ${dateLabel(FRIDAY)}?`,
      "Of those, which is nearest the Rijksmuseum, and how far is it in metres?",
    ],
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { distance: { absolute: 40, unit: "m" } },
      (within) =>
        "The final answer names the same restaurant as the reference with a distance within " +
        `${within.distance}. When the reference finds none open, saying none is correct.`
    ),
    oracle: async () => {
      const [restaurants, museum] = await Promise.all([
        placesNear(["italian restaurant"], "Leidseplein, Amsterdam", 1000, 50),
        pointOf("Rijksmuseum, Amsterdam"),
      ]);
      const at = { ...FRIDAY, hour: 22, minute: 30 };
      const [nearest] = byDistanceFrom(
        museum,
        restaurants.filter((restaurant) => openAt(restaurant, at))
      );
      return {
        answer: nearest
          ? `${restaurants.length} restaurants. Open at 22:30 Friday and nearest the Rijksmuseum: ` +
            `${placeWithAddress(nearest.place)}, ${Math.round(nearest.metres)} m.`
          : `${restaurants.length} restaurants; none open at 22:30 Friday.`,
      };
    },
  },
  {
    id: "turns-closures-on-route",
    prompt: "What are the current road closures in Utrecht?",
    turns: [
      "Plan a drive from Utrecht Centraal to Utrecht Science Park.",
      "Does that route pass within 100 m of any of those closures? Which ones?",
    ],
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { count: { absolute: 1 } },
      (within) =>
        `The final answer's count within ${within.count} of the reference, naming at least half ` +
        "of its closures (from/to). When the reference finds none, saying none is correct."
    ),
    oracle: async () => {
      const [closures, route] = await Promise.all([
        incidentsIn("Utrecht", { categoryFilter: ["road-closed"] }),
        routeBetween(["Utrecht Centraal", "Utrecht Science Park"]),
      ]);
      const near = incidentsNear(route.geometry, closures, 100);
      return {
        answer:
          `${near.length} of ${closures.length} closures within 100 m of the route: ` +
          (near
            .map(({ incident: { properties } }) => `${properties.from} → ${properties.to}`)
            .join("; ") || "none") +
          ".",
      };
    },
  },
  {
    id: "turns-de-pijp-bars",
    prompt: "Locate the De Pijp neighbourhood in Amsterdam, with its boundary.",
    turns: [
      "How many bars are inside it? Look at up to 100.",
      "Which H3 cell at resolution 9 inside it has the most of those bars, and how many?",
    ],
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { count: { absolute: 1 } },
      (within) =>
        `The final answer's H3 cell matches the reference's and its count is within ${within.count}.`
    ),
    oracle: async () => {
      const bars = await placesIn(["bar"], [await areaOf("De Pijp, Amsterdam")], {
        upToLimit: true,
      });
      const [[cell, count] = ["none", 0]] = h3Cells(bars, 9);
      return {
        answer: `${bars.length} bars in De Pijp. Densest resolution-9 cell: ${cell}, ${count} bars.`,
      };
    },
  },
  {
    id: "turns-draw-fast-chargers",
    prompt: "Find up to 100 EV charging stations within 3 km of Utrecht Centraal.",
    turns: ["Draw only the ones with a connector of at least 22 kW on a map, as markers."],
    capability: "derive-and-draw",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.1 } },
      (within) =>
        "A map was drawn (tomtom-data-viz or tomtom-dynamic-map) with a number of stations within " +
        `${within.count} of the reference's count, as the tool result's own count or markers ` +
        "show, and the answer says how many were drawn. Drawing every station found fails."
    ),
    oracle: async () => {
      const stations = await placesNear(
        ["electric vehicle station"],
        "Utrecht Centraal",
        3000,
        100
      );
      const fast = stations.filter((station) => hasConnectorOf(station, 22));
      return {
        answer: `${fast.length} of ${stations.length} stations have a connector of at least 22 kW.`,
      };
    },
  },
  {
    id: "turns-supermarket-brands-two-cities",
    prompt: "Find up to 100 supermarkets within 2 km of Utrecht Centraal.",
    turns: [
      "Now the same around Rotterdam Centraal.",
      "Which of the two has more, and which supermarket brand leads in each, with how many?",
    ],
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { count: { absolute: 3 }, brandCount: { absolute: 2 } },
      (within) =>
        `The final answer gives both counts within ${within.count}, and the same leading brand ` +
        `per city as the reference with counts within ${within.brandCount}.`
    ),
    oracle: async () => {
      const [utrecht, rotterdam] = await Promise.all([
        placesNear(["supermarket"], "Utrecht Centraal", 2000, 100),
        placesNear(["supermarket"], "Rotterdam Centraal", 2000, 100),
      ]);
      const summary = (city: string, shops: Place[]) => {
        const [brand, count] = brandTally(shops)[0] ?? ["none", 0];
        const unbranded = brandsOf(shops).filter((shopBrand) => shopBrand === undefined).length;
        return `${city} ${shops.length}, leading brand ${brand} ${count} (${unbranded} with no brand)`;
      };
      return {
        answer: `${summary("Utrecht", utrecht)}; ${summary("Rotterdam", rotterdam)}.`,
      };
    },
  },
  {
    id: "turns-first-incident-time",
    prompt: "Plan a drive from Rotterdam to Amsterdam, leaving now.",
    turns: [
      "List the current traffic incidents within 500 m of that route.",
      "Which of those will I reach first, and after how many minutes of driving?",
    ],
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { along: { absolute: 2, unit: "km" }, time: { absolute: 5, unit: "minutes" } },
      (within) =>
        "The final answer names the same first incident (from/to) as the reference, or one within " +
        `${within.along} of it along the route, and a time within ${within.time}.`
    ),
    oracle: async () => {
      const route = await routeBetween(["Rotterdam", "Amsterdam"]);
      const near = incidentsNear(route.geometry, await incidentsInBox(route.geometry), 500);
      const [first] = near;
      return {
        answer: first
          ? `${near.length} incidents within 500 m. First: ${first.incident.properties.from} → ` +
            `${first.incident.properties.to}, at km ${km(first.along)}, after about ` +
            `${Math.round(secondsToVertex(route.properties.progress ?? [], first.index) / 60)} minutes.`
          : "No incidents within 500 m of the route.",
      };
    },
  },
  {
    id: "turns-pharmacies-open-sunday",
    prompt: "Find up to 100 pharmacies within 3 km of Den Haag Centraal.",
    turns: [
      `Which of them are open at 20:00 on ${dateLabel(SUNDAY)}?`,
      "Give me the three of those nearest Den Haag Centraal, with distances in metres.",
    ],
    capability: "cross-reference",
    expected: "blocked",
    ...measured(
      { distance: { absolute: 40, unit: "m" } },
      (within) =>
        "The final answer names at least two of the reference's three pharmacies, each with a " +
        `distance within ${within.distance}. When the reference finds fewer, naming those is correct.`
    ),
    oracle: async () => {
      const [pharmacies, station] = await Promise.all([
        placesNear(["pharmacy"], "Den Haag Centraal", 3000, 100),
        pointOf("Den Haag Centraal"),
      ]);
      const at = { ...SUNDAY, hour: 20, minute: 0 };
      const open = byDistanceFrom(
        station,
        pharmacies.filter((pharmacy) => openAt(pharmacy, at))
      );
      return {
        answer:
          `${open.length} of ${pharmacies.length} open at 20:00 on ${dateLabel(SUNDAY)}. Nearest: ` +
          (open
            .slice(0, 3)
            .map(({ place, metres }) => `${placeWithAddress(place)} ${Math.round(metres)} m`)
            .join("; ") || "none") +
          ".",
      };
    },
  },

  // ---------------------------------------------------------------------------
  // A computed area or stretch the next call searches or draws
  // ---------------------------------------------------------------------------
  {
    id: "derive-cafes-around-fast-chargers",
    prompt:
      "Find the EV charging stations with a charger of at least 150 kW within 5 km of Amsterdam " +
      "Centraal. Then find every café within 500 m of any of them. How many cafés is that, and " +
      "which charging station has the most cafés within 500 m, with how many?",
    capability: "derive-and-search",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.2, absolute: 3, below: 15 }, stationCount: { absolute: 2 } },
      (within) =>
        `A café count within ${within.count} of the reference, and the same leading station (by ` +
        `address) with a count within ${within.stationCount}. When stations tie, any tied one is ` +
        "correct."
    ),
    oracle: async () => {
      const stations = await placesAround(
        ["electric vehicle station"],
        await pointOf("Amsterdam Centraal"),
        5000,
        { minPowerKW: 150 }
      );
      if (!stations.length) return { answer: "No station of at least 150 kW within 5 km." };
      const {
        places: cafes,
        groups: [top],
      } = await placesAroundEach(["cafe"], stations, 500);
      return {
        answer:
          `${stations.length} stations of at least 150 kW; ${cafes.length} cafés within 500 m of ` +
          `one. Most: ${placeWithAddress(top.centre)}, ${top.near.length} cafés.`,
      };
    },
  },
  {
    id: "derive-fuel-belgian-stretch",
    prompt:
      "Driving from Amsterdam to Brussels, which fuel stations are within 500 m of the route on " +
      "the Belgian part of the drive? How many are there, and which are the first and the last I " +
      "pass there, each with how far from Amsterdam it is along the route?",
    capability: "derive-and-search",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.25, absolute: 3, below: 12 }, along: { absolute: 3, unit: "km" } },
      (within) =>
        "A count of stations, where several at one truck stop each count, within " +
        `${within.count} of the reference, and a first and a last station at the same addresses ` +
        "as the reference's (another station at the same truck stop also matches), each within " +
        `${within.along} of its distance along the route. Counting stations on the Dutch part fails.`
    ),
    oracle: async () => {
      const route = await routeBetween(["Amsterdam", "Brussels"]);
      const line = route.geometry;
      const stretches = (route.properties.sections.country ?? [])
        .filter(({ countryCodeISO3 }) => countryCodeISO3 === "BEL")
        .map(({ startPointIndex, endPointIndex }) =>
          stretchOf(line, startPointIndex, endPointIndex)
        );
      if (!stretches.length) return { answer: "The route does not enter Belgium." };
      const found: Place[] = [];
      for (const stretch of stretches) {
        found.push(...(await placesAlongLine(["petrol station"], stretch, 500)));
      }
      const stations = alongLine(line, [
        ...new Map(found.map((station) => [station.id, station])).values(),
      ]);
      return {
        answer:
          `The border is at km ${km(metresAlong(line, stretches[0].coordinates[0]))}` +
          (stretches.length > 1 ? `, and the route enters Belgium ${stretches.length} times` : "") +
          ". " +
          `${stations.length} fuel stations within 500 m of the Belgian part. ` +
          [stations[0], stations[stations.length - 1]]
            .filter(Boolean)
            .map(
              ({ place, metres }, index) =>
                `${index ? "Last" : "First"}: ${placeWithAddress(place)} (km ${km(metres)})`
            )
            .join("; ") +
          ".",
      };
    },
  },
  {
    id: "derive-parking-last-stretch",
    prompt:
      "Driving from Utrecht to Maastricht, how many car parks are within 300 m of the last 10 km " +
      "of the route, and which of them is closest to the end of the route, in metres in a " +
      "straight line?",
    capability: "derive-and-search",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.25, absolute: 3, below: 12 }, distance: { absolute: 50, unit: "m" } },
      (within) =>
        `A count within ${within.count} of the reference, and the same closest car park (by ` +
        `name or address) with a distance within ${within.distance}.`
    ),
    oracle: async () => {
      const { geometry: line } = await routeBetween(["Utrecht", "Maastricht"]);
      const total = turf.length(turf.feature(line), { units: "meters" });
      const lastTen = turf.lineSliceAlong(line, total - 10_000, total, {
        units: "meters",
      }).geometry;
      const end = line.coordinates[line.coordinates.length - 1];
      const parks = byDistanceFrom(
        end,
        await placesAlongLine(["parking garage", "open parking area"], lastTen, 300)
      );
      return {
        answer:
          `${parks.length} car parks within 300 m of the last 10 km. Closest to the end: ` +
          (parks[0]
            ? `${placeWithAddress(parks[0].place)}, ${Math.round(parks[0].metres)} m.`
            : "none."),
      };
    },
  },
  {
    id: "derive-midway-chargers-restaurants",
    prompt:
      "Plan a drive from Amsterdam to Paris. Looking only at the middle fifth of the drive, from " +
      "40% to 60% of its length, find the EV chargers of at least 300 kW within 500 m of the " +
      "route there. Then find the restaurants within 200 m of those chargers. Which charger has " +
      "the most restaurants within 200 m, how many, and how far from Amsterdam is it along the " +
      "route?",
    capability: "derive-and-search",
    expected: "blocked",
    ...measured(
      { count: { absolute: 2 }, along: { absolute: 5, unit: "km" } },
      (within) =>
        "The same charger as the reference (by name and town), or one tied with it, with a " +
        `restaurant count within ${within.count} and a distance along the route within ` +
        `${within.along}. When the reference's charger lies within 3 km of either end of the ` +
        "stretch, the top charger of a stretch cut a little differently is also correct. When the " +
        "reference finds no charger, saying so is correct."
    ),
    oracle: async () => {
      const { geometry: line } = await routeBetween(["Amsterdam", "Paris"]);
      const total = turf.length(turf.feature(line), { units: "meters" });
      const middle = turf.lineSliceAlong(line, total * 0.4, total * 0.6, {
        units: "meters",
      }).geometry;
      const chargers = await placesAlongLine(["electric vehicle station"], middle, 500, {
        minPowerKW: 300,
      });
      if (!chargers.length) return { answer: "No charger of at least 300 kW on that stretch." };
      // Searched around each charger, so the reference never runs past a result cap, one
      // at a time since the services do not retry a rate-limited request.
      const around: Place[][] = [];
      for (const charger of chargers) {
        around.push(await placesAround(["restaurant"], charger.geometry.coordinates, 200));
      }
      const [top] = chargers
        .map((centre, index) => ({ centre, near: around[index] }))
        .sort((a, b) => b.near.length - a.near.length);
      const restaurants = new Set(around.flat().map(({ id }) => id));
      return {
        answer:
          `The middle fifth runs from km ${km(total * 0.4)} to km ${km(total * 0.6)}; ` +
          `${chargers.length} chargers of at least 300 kW within 500 m of it, ${restaurants.size} ` +
          "restaurants within 200 m of one. Most: " +
          `${placeWithAddress(top.centre)}, ${top.near.length} within 200 m, at km ` +
          `${km(metresAlong(line, top.centre.geometry.coordinates))}.`,
      };
    },
  },
  {
    id: "derive-draw-lez-stretches",
    prompt:
      "Plan a drive from Amsterdam to Brussels and draw on a map only the parts of the route that " +
      "run through low-emission zones, as lines. How many stretches are there, and how long are " +
      "they in total?",
    capability: "derive-and-draw",
    expected: "blocked",
    ...measured(
      { stretches: { absolute: 1 }, total: { absolute: 1, unit: "km" } },
      (within) =>
        "A map was drawn (tomtom-data-viz or tomtom-dynamic-map) holding only the low-emission " +
        "stretches as lines, as the tool call or its result shows, and the answer gives the same " +
        `number of stretches (${within.stretches}) and a total within ${within.total} of the ` +
        "reference. Drawing the whole route fails."
    ),
    oracle: async () => {
      const route = await routeBetween(["Amsterdam", "Brussels"]);
      const lengths = sectionLengths(
        route.geometry,
        route.properties.sections.lowEmissionZone ?? []
      );
      return {
        answer:
          `${lengths.length} low-emission stretches, ` +
          `${km(lengths.reduce((sum, metres) => sum + metres, 0))} km in total: ` +
          `${lengths.map((metres) => `${km(metres)} km`).join(", ")}.`,
      };
    },
  },
  {
    id: "derive-draw-cafe-hexes",
    prompt:
      "Find up to 100 cafés within 1.5 km of Dam Square, Amsterdam. Draw on a map the H3 cells at " +
      "resolution 9 that hold at least three of them, as polygons coloured by how many cafés each " +
      "holds. How many cells did you draw, and what is the most cafés in one cell?",
    capability: "derive-and-draw",
    expected: "blocked",
    ...measured(
      { cells: { absolute: 2 }, maximum: { absolute: 1 } },
      (within) =>
        "A map was drawn with hexagonal polygons, as the tool call or its result shows, and the " +
        `answer gives a cell count within ${within.cells} of the reference and a maximum within ` +
        `${within.maximum}. Drawing the cafés as points fails.`
    ),
    oracle: async () => {
      const cafes = await placesNear(["cafe"], "Dam Square, Amsterdam", 1500, 100);
      const cells = h3Cells(cafes, 9).filter(([, count]) => count >= 3);
      return {
        answer:
          `${cafes.length} cafés; ${cells.length} resolution-9 cells hold at least three. Most: ` +
          `${cells[0]?.[1] ?? 0}.`,
      };
    },
  },
  {
    id: "turns-derive-rotterdam-chargers-restaurants",
    prompt: "Find up to 100 EV charging stations within 3 km of Rotterdam Centraal.",
    turns: [
      "Keep only the ones with a charger of at least 22 kW.",
      "Now find the restaurants within 100 m of those stations. How many restaurants is that in " +
        "total, and which station has the most within 100 m?",
    ],
    capability: "derive-and-search",
    expected: "blocked",
    ...measured(
      { count: { relative: 0.2, absolute: 3, below: 15 } },
      (within) =>
        `The final answer gives a restaurant count within ${within.count} of the reference, and ` +
        "the same leading station (by address) or one tied with it."
    ),
    oracle: async () => {
      const stations = (
        await placesNear(["electric vehicle station"], "Rotterdam Centraal", 3000, 100)
      ).filter((station) => hasConnectorOf(station, 22));
      if (!stations.length) return { answer: "No station of at least 22 kW within 3 km." };
      const {
        places: restaurants,
        groups: [top],
      } = await placesAroundEach(["restaurant"], stations, 100);
      return {
        answer:
          `${stations.length} stations of at least 22 kW; ${restaurants.length} restaurants within ` +
          `100 m of one. Most: ${placeWithAddress(top.centre)}, ${top.near.length}.`,
      };
    },
  },
];
