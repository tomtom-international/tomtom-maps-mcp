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
 * Helpers for `tomtom-analyse-datasets` code: the reads that models get wrong when
 * they write them against raw TomTom data. Measured on the demanding corpus, code
 * that guessed `connector.type` paths, walked opening-hours ranges or read route
 * progress by hand came back with nulls, "[object Object]" or zero, and the model
 * then reported that the data was missing.
 *
 * Shipped as JavaScript source because the sandbox is a separate process: the
 * child evaluates it with `turf` and exposes the result as `place`, `route` and
 * `incident`.
 */

/** Names the helpers are injected under, in the order the source returns them. */
export const HELPER_NAMES = ["place", "route", "incident"] as const;

/** A function body taking `turf` and returning `{ place, route, incident }`. */
export const HELPERS_SOURCE = /* js */ `
const key = (y, mo, d, h, mi) => (((y * 100 + mo) * 100 + d) * 100 + h) * 100 + mi;
const rangeKey = (t) => key(t.year, t.month, t.day, t.hour, t.minute);
const parseLocal = (text) => {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2}))?/.exec(String(text));
  if (!m) throw new TypeError('expected a local time "YYYY-MM-DDTHH:MM", got ' + JSON.stringify(text));
  return m.slice(1).map((part) => Number(part ?? 0));
};
const props = (feature) => (feature && feature.properties) || {};
const ranges = (feature) => (props(feature).poi?.openingHours?.timeRanges);

const place = {
  openAt(feature, localTime) {
    const all = ranges(feature);
    if (!all) return undefined;
    const at = key(...parseLocal(localTime));
    return all.some((r) => rangeKey(r.start) <= at && at < rangeKey(r.end));
  },
  opensOn(feature, localDate) {
    const all = ranges(feature);
    if (!all) return undefined;
    const [y, mo, d] = parseLocal(localDate);
    const start = key(y, mo, d, 0, 0);
    const end = key(y, mo, d, 23, 59);
    // A range starting at 00:00 is the night before carrying over, not an opening.
    const opens = all.map((r) => rangeKey(r.start)).filter((k) => k > start && k <= end);
    if (!opens.length) return undefined;
    const hhmm = Math.min(...opens) % 10000;
    return String(Math.floor(hhmm / 100)).padStart(2, "0") + ":" + String(hhmm % 100).padStart(2, "0");
  },
  alwaysOpen(feature) {
    return props(feature).poi?.openingHours?.alwaysOpenThisPeriod;
  },
  connectors(feature) {
    return (props(feature).chargingPark?.connectors ?? []).map((entry) => ({
      type: entry.connector?.type,
      ratedPowerKW: entry.connector?.ratedPowerKW,
      currentType: entry.connector?.currentType,
      count: entry.count ?? 1,
    }));
  },
  maxPowerKW(feature) {
    return Math.max(0, ...place.connectors(feature).map((c) => c.ratedPowerKW ?? 0));
  },
  brand(feature) {
    const brands = (props(feature).poi?.brands ?? [])
      .map((b) => (typeof b === "string" ? b : b?.name))
      .filter(Boolean);
    const name = String(props(feature).poi?.name ?? "").toLowerCase();
    return (
      brands.find((b) => name.includes(b.toLowerCase())) ??
      brands.find((b) => /^[\\x20-\\x7E]+$/.test(b))
    );
  },
  categories(feature) {
    return props(feature).poi?.categories ?? [];
  },
  name(feature) {
    return props(feature).poi?.name ?? props(feature).address?.freeformAddress;
  },
};

const lineOf = (routeFeature) => {
  const g = routeFeature?.geometry;
  if (!g || g.type !== "LineString") throw new TypeError("expected a route feature with a LineString geometry");
  return g;
};
// value, on the scale of the pairs' first members, read off their second, linearly between them.
const rescale = (pairs, value) => {
  const after = pairs.findIndex(([x]) => x >= value);
  if (after < 0) return pairs.at(-1)[1];
  if (after === 0) return pairs[0][1];
  const [x0, y0] = pairs[after - 1];
  const [x1, y1] = pairs[after];
  return y0 + ((value - x0) / (x1 - x0 || 1)) * (y1 - y0);
};
// The line's length up to each vertex, and the route's own distance and time against it, as the
// results measure them: scaled between progress entries, or to the summary when progress doesn't
// span the line. A line without them is measured by its own length, with no times.
const scalesOf = (routeFeature, line) => {
  const along = [0];
  for (let i = 1; i < line.coordinates.length; i++) {
    along.push(along[i - 1] + turf.distance(line.coordinates[i - 1], line.coordinates[i], { units: "meters" }));
  }
  const last = along.length - 1;
  const { progress = [], summary = {} } = props(routeFeature);
  const entries =
    progress.at(0)?.pointIndex === 0 && progress.at(-1)?.pointIndex === last
      ? progress
      : [
          { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
          { pointIndex: last, distanceInMeters: summary.lengthInMeters, travelTimeInSeconds: summary.travelTimeInSeconds },
        ];
  const pairs = (field) =>
    entries.filter((p) => typeof p[field] === "number").map((p) => [along[p.pointIndex], p[field]]);
  const distances = pairs("distanceInMeters");
  const times = pairs("travelTimeInSeconds");
  const measured = distances.length > 1;
  return {
    along,
    meters: (lineMeters) => (measured ? rescale(distances, lineMeters) : lineMeters),
    lineMeters: (meters) => (measured ? rescale(distances.map(([x, y]) => [y, x]), meters) : meters),
    seconds: (lineMeters) => (times.length > 1 ? rescale(times, lineMeters) : undefined),
  };
};

const route = {
  locate(routeFeature, point) {
    const line = lineOf(routeFeature);
    const scales = scalesOf(routeFeature, line);
    const coordinates = point?.geometry ? turf.getCoord(turf.centroid(point)) : point;
    const nearest = turf.nearestPointOnLine(line, coordinates, { units: "meters" });
    return {
      meters: scales.meters(nearest.properties.location),
      seconds: scales.seconds(nearest.properties.location),
      offRouteMeters: nearest.properties.dist,
    };
  },
  pointAt(routeFeature, meters) {
    const line = lineOf(routeFeature);
    const lineMeters = scalesOf(routeFeature, line).lineMeters(meters);
    return turf.along(line, lineMeters, { units: "meters" }).geometry.coordinates;
  },
  sections(routeFeature, kind) {
    const line = lineOf(routeFeature);
    const scales = scalesOf(routeFeature, line);
    return (props(routeFeature).sections?.[kind] ?? []).map((section) => {
      const start = scales.along[section.startPointIndex] ?? 0;
      const end = scales.along[section.endPointIndex] ?? scales.along.at(-1);
      const startMeters = scales.meters(start);
      const endMeters = scales.meters(end);
      return {
        ...section,
        startMeters,
        endMeters,
        lengthMeters: endMeters - startMeters,
        startSeconds: scales.seconds(start),
        endSeconds: scales.seconds(end),
      };
    });
  },
  instructions(routeFeature) {
    return props(routeFeature).guidance?.instructions ?? [];
  },
};

const incident = {
  events(feature) {
    return (props(feature).events ?? []).map((e) => e.description);
  },
  distanceTo(feature, point) {
    const g = feature?.geometry;
    if (!g) return undefined;
    if (g.type === "Point") return turf.distance(point, g.coordinates, { units: "meters" });
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    if (!lines.length) return turf.distance(point, turf.centroid(g), { units: "meters" });
    return Math.min(...lines.map((l) => turf.pointToLineDistance(point, turf.lineString(l), { units: "meters" })));
  },
};

return { place, route, incident };
`;
