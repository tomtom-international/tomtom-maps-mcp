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
 * What a route is like, read with the maps-sdk's route utilities before the
 * trimmer drops the coordinates they index into: its roads, its countries, its
 * curves, and what sets one route apart from another.
 */

import {
  type BBox,
  compareRoutes,
  type DelayMagnitude,
  getCoordinateAtRouteProgress,
  getImportantRoads,
  getRouteProgressForSection,
  getSectionOverlap,
  getSectionsWithin,
  type Instruction,
  isHairpin,
  type Maneuver,
  type Route,
  type RouteProgressQuery,
  type RouteSpan,
  type Routes,
  type SectionsProps,
  type SectionsWithin,
  type SectionType,
  type TrafficIncidentCategory,
} from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Position } from "geojson";
import type { PlanRouteParams } from "../../schemas/routing/planRouteSchema";

/** The section types weighed when two routes are compared: what a driver pays, waits for or winds through. */
const COMPARED_TYPES = [
  "toll",
  "tollRoad",
  "tollVignette",
  "ferry",
  "carTrain",
  "unpaved",
  "motorway",
  "lowEmissionZone",
  "traffic",
  "curve",
  "curvyStretch",
] as const satisfies readonly SectionType[];

/** Sections whose own summary or length already says where they run, or that the analysis summarises. */
const SECTIONS_WITHOUT_PROGRESS = new Set<string>([
  "leg",
  "country",
  "distinct",
  "curve",
  "curvyStretch",
]);

/** A curve this severe makes a driver brake hard from the limit on the road into it; severity runs 0–1. */
const HARD_CURVE_SEVERITY = 0.5;

/** Roads shorter than this along the route are passing through, not taken. */
const MIN_ROAD_LENGTH_METERS = 1000;

/** The shield of a road with no number of its own: it names nothing. */
const UNNUMBERED_SHIELD = "global-fallback";

const MAX_ROADS = 10;
const MAX_CURVY_STRETCHES = 3;
const MAX_AVOIDED_INCIDENTS = 5;
const MAX_DIRECTIONS = 150;

/** The guidance counts, each over the manoeuvres a driver would name that way. */
const MANOEUVRE_KINDS = {
  turnCount: ["TURN_LEFT", "TURN_RIGHT", "SHARP_LEFT", "SHARP_RIGHT"],
  slightTurnCount: ["SLIGHT_LEFT", "SLIGHT_RIGHT"],
  forkCount: ["KEEP_LEFT", "KEEP_RIGHT"],
  roundaboutCount: [
    "ROUNDABOUT_STRAIGHT",
    "ROUNDABOUT_SHARP_RIGHT",
    "ROUNDABOUT_RIGHT",
    "ROUNDABOUT_SLIGHT_RIGHT",
    "ROUNDABOUT_SLIGHT_LEFT",
    "ROUNDABOUT_LEFT",
    "ROUNDABOUT_SHARP_LEFT",
    "ROUNDABOUT_BACK",
  ],
  uTurnCount: ["MAKE_UTURN"],
  motorwayExitCount: ["EXIT_MOTORWAY_LEFT", "EXIT_MOTORWAY_RIGHT"],
  motorwayChangeCount: ["SWITCH_MOTORWAY_LEFT", "SWITCH_MOTORWAY_RIGHT"],
  mergeCount: ["MERGE_LEFT_LANE", "MERGE_RIGHT_LANE"],
} as const satisfies Record<string, readonly Maneuver[]>;

/** Instructions that mark the trip itself rather than a manoeuvre on the road. */
const TRIP_MARKERS = new Set<Maneuver>([
  "DEPART",
  "ARRIVE",
  "ARRIVE_LEFT",
  "ARRIVE_RIGHT",
  "ARRIVE_AHEAD",
  "WAYPOINT_LEFT",
  "WAYPOINT_RIGHT",
  "WAYPOINT_REACHED",
  "WAYPOINT_AHEAD",
]);

/** What a part of a route carries of one section type. */
interface Carried {
  count: number;
  lengthInMeters: number;
  /** traffic: the delay within the part, a jam's share of it when it reaches outside. */
  delayInSeconds?: number;
  /** traffic: the road closures. */
  closures?: number;
  /** curve: the hairpins. */
  hairpins?: number;
}

type CarriedByType = Partial<Record<(typeof COMPARED_TYPES)[number], Carried>>;

interface CountryStretch {
  /** ISO 3166-1 alpha-2, as tool inputs such as `countries` take it. */
  countryCode: string;
  startsAfterMeters?: number;
  lengthInMeters?: number;
  travelTimeInSeconds?: number;
  tollRoadLengthInMeters?: number;
  motorwayLengthInMeters?: number;
}

interface CurvyStretch {
  startsAfterMeters?: number;
  lengthInMeters: number;
  curveCount: number;
  hairpinCount: number;
  minRadiusInMeters: number;
  curvinessScore: number;
  road?: string;
  startPosition?: Position;
}

interface Curvature {
  curveCount: number;
  hairpinCount: number;
  hardCurveCount: number;
  /** The curves' summed roadcurvature.com score: how much winding road the route offers. */
  curvinessScore: number;
  curvyStretchCount: number;
  curvyStretchesLengthInMeters: number;
  curviestStretches: CurvyStretch[];
}

/** One route against another: the roads each drives alone and what those roads carry. */
interface RouteDifference {
  extraTravelTimeInSeconds: number;
  extraLengthInMeters: number;
  sameRoads: boolean;
  ownRoadsLengthInMeters: number;
  ownRoads: string[];
  otherRouteOwnRoads: string[];
  adds: CarriedByType;
  avoids: CarriedByType;
}

/** The route's jams at a glance, so a question about them needs no reading of `sections`. */
interface TrafficAlong {
  /** The summary's delay over free flow, all jams together. */
  delayInSeconds: number;
  /** Today's travel time over the time usual traffic gives: negative when faster than usual. */
  delayVersusUsualInSeconds?: number;
  jamCount: number;
  firstJam?: {
    startsAfterMeters?: number;
    lengthInMeters?: number;
    delayInSeconds?: number;
    magnitudeOfDelay: DelayMagnitude;
    categories: TrafficIncidentCategory[];
  };
}

/** A road by the number on its signs; `shield` is the kind of road, such as `deu-motorway`. */
interface Road {
  name: string;
  shield?: string;
  lengthInMeters: number;
}

/** How far the route drives at one speed limit, all its stretches together. */
interface SpeedLimitLength {
  maxSpeedLimitInKmh: number;
  lengthInMeters: number;
}

/** How many of each manoeuvre the route's guidance holds; a kind it has none of is left out. */
type GuidanceCounts = { manoeuvreCount: number; turnCount: number } & Partial<
  Record<keyof typeof MANOEUVRE_KINDS, number>
>;

/** One guidance instruction as a step of directions. */
export interface DirectionStep {
  startsAfterMeters: number;
  maneuver: Maneuver;
  /** The routing service's wording, e.g. "Take exit 31 onto the N230 toward Utrecht-Noord." */
  instruction?: string;
  /** The road the step leads onto, given only when there is no instruction to name it. */
  road?: string;
}

/** Added to each route of a compact plan-route result. */
export interface RouteAnalysis {
  /** [west, south, east, north]: how far the route reaches in each direction. */
  boundingBox: BBox;
  roads: Road[];
  countries: CountryStretch[];
  traffic: TrafficAlong;
  /** The distance at each speed limit, fastest first, where the API gives limits. */
  speedLimits?: SpeedLimitLength[];
  tunnels?: { count: number; lengthInMeters: number };
  /** How far the route runs through built-up areas. */
  urbanLengthInMeters?: number;
  guidance?: GuidanceCounts;
  curvature?: Curvature;
  comparedToFirstRoute?: RouteDifference;
}

const round = (value: number): number => Math.round(value);

const metersAlong = (route: Route, span: RouteSpan | undefined): number =>
  (span && getRouteProgressForSection(route, span)?.delta.distanceInMeters) ?? 0;

/** How far the route runs along the section, within the spans when given. */
function lengthWithin(route: Route, section: RouteSpan, spans?: readonly RouteSpan[]): number {
  if (!spans) return metersAlong(route, section);
  return spans.reduce((sum, span) => sum + metersAlong(route, getSectionOverlap(section, span)), 0);
}

/**
 * The roads within the spans, or along the whole route without them, in driving order and each once.
 * Road shields cover the whole route, so they decide; the important road stretches, read where there
 * are none, name only the one or two roads that label the route.
 */
function roadsAlong(route: Route, within?: readonly RouteSpan[]): Road[] {
  const { roadShields } = route.properties.sections;
  if (!roadShields?.length) {
    return getImportantRoads(route, { within, minLengthInMeters: MIN_ROAD_LENGTH_METERS }).flatMap(
      (road) => (road.name ? [{ name: road.name, lengthInMeters: round(road.lengthInMeters) }] : [])
    );
  }
  const roads = new Map<string, Road>();
  let previous: string | undefined;
  for (const section of [...roadShields].sort((a, b) => a.startPointIndex - b.startPointIndex)) {
    const numbered = section.roadShieldReferences.filter(
      (shield) => shield.shieldContent && shield.reference !== UNNUMBERED_SHIELD
    );
    // A road signed together with another, such as an E-road, stays the road the route was on.
    const shield = numbered.find((each) => each.shieldContent === previous) ?? numbered[0];
    if (!shield?.shieldContent) continue;
    previous = shield.shieldContent;
    const lengthInMeters = lengthWithin(route, section, within);
    const road = roads.get(shield.shieldContent);
    if (road) road.lengthInMeters += lengthInMeters;
    else if (lengthInMeters) {
      roads.set(shield.shieldContent, {
        name: shield.shieldContent,
        shield: shield.reference,
        lengthInMeters,
      });
    }
  }
  return [...roads.values()]
    .filter((road) => road.lengthInMeters >= MIN_ROAD_LENGTH_METERS)
    .map((road) => ({ ...road, lengthInMeters: round(road.lengthInMeters) }));
}

const roadNames = (route: Route, within?: readonly RouteSpan[]): string[] =>
  roadsAlong(route, within).map((road) => road.name);

/** The main roads along the route in driving order, the longest kept when there are many. */
function mainRoads(route: Route): Road[] {
  const named = roadsAlong(route);
  if (named.length <= MAX_ROADS) return named;
  const longest = new Set(
    [...named].sort((a, b) => b.lengthInMeters - a.lengthInMeters).slice(0, MAX_ROADS)
  );
  return named.filter((road) => longest.has(road));
}

/** Each stretch of the route in one country, in driving order: a country entered twice is listed twice. */
function countries(route: Route): CountryStretch[] {
  return (route.properties.sections.country ?? []).map((section) => {
    const progress = getRouteProgressForSection(route, section);
    const within = getSectionsWithin(route, { within: [section], types: ["tollRoad", "motorway"] });
    return {
      countryCode: section.countryCodeISO2,
      ...(progress && {
        startsAfterMeters: round(progress.start.distanceInMeters),
        lengthInMeters: round(progress.delta.distanceInMeters),
        travelTimeInSeconds: round(progress.delta.travelTimeInSeconds),
      }),
      ...(within.tollRoad && { tollRoadLengthInMeters: round(within.tollRoad.lengthInMeters) }),
      ...(within.motorway && { motorwayLengthInMeters: round(within.motorway.lengthInMeters) }),
    };
  });
}

function trafficAlong(route: Route): TrafficAlong {
  const jams = route.properties.sections.traffic ?? [];
  const [first] = [...jams].sort((a, b) => a.startPointIndex - b.startPointIndex);
  const progress = first && getRouteProgressForSection(route, first);
  const { summary } = route.properties;
  return {
    delayInSeconds: round(summary.trafficDelayInSeconds ?? 0),
    ...(summary.historicTrafficTravelTimeInSeconds !== undefined && {
      delayVersusUsualInSeconds: round(
        summary.travelTimeInSeconds - summary.historicTrafficTravelTimeInSeconds
      ),
    }),
    jamCount: jams.length,
    ...(first && {
      firstJam: {
        ...(progress && {
          startsAfterMeters: round(progress.start.distanceInMeters),
          lengthInMeters: round(progress.delta.distanceInMeters),
        }),
        ...(first.delayInSeconds !== undefined && { delayInSeconds: first.delayInSeconds }),
        magnitudeOfDelay: first.magnitudeOfDelay,
        categories: first.categories,
      },
    }),
  };
}

function speedLimits(route: Route): SpeedLimitLength[] | undefined {
  const sections = route.properties.sections.speedLimit;
  if (!sections?.length) return undefined;
  const byLimit = new Map<number, number>();
  for (const section of sections) {
    const limit = section.maxSpeedLimitInKmh;
    byLimit.set(limit, (byLimit.get(limit) ?? 0) + metersAlong(route, section));
  }
  return [...byLimit]
    .sort(([a], [b]) => b - a)
    .map(([maxSpeedLimitInKmh, meters]) => ({
      maxSpeedLimitInKmh,
      lengthInMeters: round(meters),
    }));
}

const totalLength = (route: Route, sections: readonly RouteSpan[]): number =>
  round(sections.reduce((sum, section) => sum + metersAlong(route, section), 0));

const instructionsOf = (route: Route): Instruction[] =>
  route.properties.guidance?.instructions ?? [];

function guidanceCounts(route: Route): GuidanceCounts | undefined {
  const instructions = instructionsOf(route);
  if (!instructions.length) return undefined;
  const counts: GuidanceCounts = {
    manoeuvreCount: instructions.filter(({ maneuver }) => !TRIP_MARKERS.has(maneuver)).length,
    turnCount: 0,
  };
  for (const [kind, maneuvers] of Object.entries(MANOEUVRE_KINDS)) {
    const kinds: readonly Maneuver[] = maneuvers;
    const count = instructions.filter(({ maneuver }) => kinds.includes(maneuver)).length;
    if (count || kind === "turnCount") counts[kind as keyof typeof MANOEUVRE_KINDS] = count;
  }
  return counts;
}

/**
 * The route's guidance as directions, in driving order: each manoeuvre, where it
 * comes, and what to do there. Capped, so only a long trip loses its last steps.
 */
export function directionsOf(route: Route): { steps: DirectionStep[]; truncated: boolean } {
  const instructions = instructionsOf(route);
  const steps = instructions
    .slice(0, MAX_DIRECTIONS)
    .map(({ routeOffsetInMeters, maneuver, message, nextRoadInfo }): DirectionStep => {
      const road =
        nextRoadInfo?.streetName?.text ||
        nextRoadInfo?.roadShields?.map((shield) => shield.roadNumber.text).join("/");
      return {
        startsAfterMeters: round(routeOffsetInMeters),
        maneuver,
        ...(message ? { instruction: message } : road && { road }),
      };
    });
  return { steps, truncated: instructions.length > MAX_DIRECTIONS };
}

function curvature(route: Route): Curvature | undefined {
  const { curve, curvyStretch } = route.properties.sections;
  if (!curve && !curvyStretch) return undefined;
  const curves = curve ?? [];
  const stretches = curvyStretch ?? [];
  const curviest = [...stretches]
    .sort((a, b) => b.curvinessScore - a.curvinessScore)
    .slice(0, MAX_CURVY_STRETCHES);
  return {
    curveCount: curves.length,
    hairpinCount: curves.filter(isHairpin).length,
    hardCurveCount: curves.filter((curve) => curve.severity >= HARD_CURVE_SEVERITY).length,
    curvinessScore: round(curves.reduce((sum, curve) => sum + curve.curvinessScore, 0)),
    curvyStretchCount: stretches.length,
    curvyStretchesLengthInMeters: round(
      stretches.reduce((sum, stretch) => sum + stretch.lengthInMeters, 0)
    ),
    curviestStretches: curviest.map((stretch) => {
      const start = getRouteProgressForSection(route, stretch)?.start;
      const road = roadNames(route, [stretch])[0];
      return {
        ...(start && { startsAfterMeters: round(start.distanceInMeters) }),
        lengthInMeters: round(stretch.lengthInMeters),
        curveCount: stretch.curveCount,
        hairpinCount: stretch.hairpinCount,
        minRadiusInMeters: round(stretch.minRadiusInMeters),
        curvinessScore: round(stretch.curvinessScore),
        ...(road && { road }),
        startPosition: route.geometry.coordinates[stretch.startPointIndex],
      };
    }),
  };
}

/** What each compared type carries, by count and length, with the delay a jam adds pro rata. */
function carried(within: SectionsWithin): CarriedByType {
  const result: CarriedByType = {};
  for (const type of COMPARED_TYPES) {
    const ofType = within[type];
    if (!ofType) continue;
    result[type] = { count: ofType.sections.length, lengthInMeters: round(ofType.lengthInMeters) };
  }
  const { traffic, curve } = within;
  if (traffic && result.traffic) {
    result.traffic.delayInSeconds = round(
      traffic.sections.reduce(
        (sum, jam, index) => sum + (jam.delayInSeconds ?? 0) * traffic.shares[index],
        0
      )
    );
    result.traffic.closures = traffic.sections.filter((jam) =>
      jam.categories.includes("road-closed")
    ).length;
  }
  if (curve && result.curve) result.curve.hairpins = curve.sections.filter(isHairpin).length;
  return result;
}

const spanLength = (spans: readonly { lengthInMeters: number }[]): number =>
  round(spans.reduce((sum, span) => sum + span.lengthInMeters, 0));

/** `route` against `reference`: the time and length it adds, its own roads, and what they carry. */
function difference(route: Route, reference: Route): RouteDifference {
  const comparison = compareRoutes(route, reference, { types: COMPARED_TYPES });
  const { summary } = route.properties;
  return {
    extraTravelTimeInSeconds:
      summary.travelTimeInSeconds - reference.properties.summary.travelTimeInSeconds,
    extraLengthInMeters: summary.lengthInMeters - reference.properties.summary.lengthInMeters,
    sameRoads: !comparison.distinct.length && !comparison.referenceDistinct.length,
    ownRoadsLengthInMeters: spanLength(comparison.distinct),
    ownRoads: roadNames(route, comparison.distinct),
    otherRouteOwnRoads: roadNames(reference, comparison.referenceDistinct),
    adds: carried(comparison.adds),
    avoids: carried(comparison.avoids),
  };
}

/** The analysis of each route, alternatives compared with the first. */
export function analyzeRoutes(routes: Routes): RouteAnalysis[] {
  const [first] = routes.features;
  return routes.features.map((route, index) => {
    const { tunnel, urban } = route.properties.sections;
    const limits = speedLimits(route);
    const guidance = guidanceCounts(route);
    const curves = curvature(route);
    return {
      boundingBox: turf.bbox(route).map((degrees) => Number(degrees.toFixed(5))) as BBox,
      roads: mainRoads(route),
      countries: countries(route),
      traffic: trafficAlong(route),
      ...(limits && { speedLimits: limits }),
      ...(tunnel?.length && {
        tunnels: { count: tunnel.length, lengthInMeters: totalLength(route, tunnel) },
      }),
      ...(urban?.length && { urbanLengthInMeters: totalLength(route, urban) }),
      ...(guidance && { guidance }),
      ...(curves && { curvature: curves }),
      ...(index > 0 && { comparedToFirstRoute: difference(route, first) }),
    };
  });
}

/**
 * The live route against the one usual traffic would take, which carries the live
 * traffic along it too: the jams and closures the live route goes around. Its
 * travel time is with usual traffic, not today's.
 */
export function compareWithUsualRoute(live: Route, usual: Route) {
  const comparison = compareRoutes(usual, live, { types: COMPARED_TYPES });
  return {
    sameRoads: !comparison.distinct.length && !comparison.referenceDistinct.length,
    usualRouteLengthInMeters: usual.properties.summary.lengthInMeters,
    usualRouteTravelTimeInSeconds: usual.properties.summary.travelTimeInSeconds,
    liveRouteOwnRoads: roadNames(live, comparison.referenceDistinct),
    usualRouteOwnRoads: roadNames(usual, comparison.distinct),
    liveRouteAvoids: carried(comparison.adds),
    liveRouteAdds: carried(comparison.avoids),
    avoidedIncidents: (comparison.adds.traffic?.sections ?? [])
      .slice(0, MAX_AVOIDED_INCIDENTS)
      .map(({ categories, magnitudeOfDelay, delayInSeconds }) => ({
        categories,
        magnitudeOfDelay,
        ...(delayInSeconds !== undefined && { delayInSeconds }),
      })),
  };
}

/** A copy of the routes whose sections each say where they start and how far and long they run. */
export function withSectionProgress(routes: Routes): Routes {
  return {
    ...routes,
    features: routes.features.map((route) => {
      const sections: SectionsProps = { ...route.properties.sections };
      for (const [type, entries] of Object.entries(sections)) {
        if (SECTIONS_WITHOUT_PROGRESS.has(type) || !Array.isArray(entries)) continue;
        Object.assign(sections, {
          [type]: entries.map((section: Partial<RouteSpan> & { lengthInMeters?: number }) => {
            const { startPointIndex, endPointIndex } = section;
            const progress =
              startPointIndex !== undefined && endPointIndex !== undefined
                ? getRouteProgressForSection(route, { startPointIndex, endPointIndex })
                : undefined;
            if (!progress) return section;
            return {
              ...section,
              startsAfterMeters: round(progress.start.distanceInMeters),
              lengthInMeters: section.lengthInMeters ?? round(progress.delta.distanceInMeters),
              travelTimeInSeconds: round(progress.delta.travelTimeInSeconds),
            };
          }),
        });
      }
      return { ...route, properties: { ...route.properties, sections } };
    }),
  };
}

/** A position reached along the route, by time or by distance driven. */
export type Checkpoint = NonNullable<PlanRouteParams["checkpoints"]>[number];

/** Where the route is at the checkpoint, or undefined past its end. */
export function positionAtCheckpoint(route: Route, checkpoint: Checkpoint) {
  const { travelTimeInSeconds, lengthInMeters } = route.properties.summary;
  const [query, pastEnd]: [RouteProgressQuery, boolean] =
    "afterMinutes" in checkpoint
      ? [
          { traveledTimeInSeconds: checkpoint.afterMinutes * 60 },
          checkpoint.afterMinutes * 60 > travelTimeInSeconds,
        ]
      : [
          { traveledDistanceInMeters: checkpoint.afterKilometers * 1000 },
          checkpoint.afterKilometers * 1000 > lengthInMeters,
        ];
  const at = pastEnd ? undefined : getCoordinateAtRouteProgress(route, query);
  return (
    at && {
      position: at.position,
      distanceFromStartInMeters: round(at.distanceInMeters),
      travelTimeFromStartInSeconds: round(at.travelTimeInSeconds),
    }
  );
}
