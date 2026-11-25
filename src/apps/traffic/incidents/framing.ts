/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { type BBox, bboxFromBBoxes, bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import type { Feature } from "geojson";
import type { WithinWhere } from "../../../schemas/shared/where";
import type { GetTrafficParams } from "../../../schemas/traffic/trafficSchema";
import { isPolygons, isRings } from "../../../tools/shared/geometry-response";
import { isRecord } from "../../../utils/record";

/** What `tomtom-get-traffic` sends the app: the searched bounds, since it draws live incidents itself. */
export interface TrafficAppData {
  bbox?: number[];
}

/**
 * The bounds to frame the map on from the tool input, before the result comes.
 * `within` unions all its fields, and `queries`, `areas`, `geometries` and `nearby`
 * resolve on the server, so only a lone `boundingBox` frames from the input.
 */
export function inputBounds(where: GetTrafficParams["where"] | undefined): number[] | undefined {
  if (where?.mode !== "within" || where.queries || where.areas || where.geometries)
    return undefined;
  return where.boundingBox;
}

/**
 * The bounds to frame the map on from the result: the app data's, or the searched
 * bounds a `response_detail: "full"` result carries, else the incidents' own.
 */
export function resultBounds(
  result: TrafficAppData & { features?: Feature[] }
): number[] | undefined {
  if (result.bbox) return result.bbox;
  return result.features?.length
    ? bboxFromGeoJSON({ type: "FeatureCollection", features: result.features })
    : undefined;
}

/** Whether a value from the host's arguments or the text is a [west, south, east, north] box. */
const isBBox = (value: unknown): value is BBox =>
  Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);

/** A `within.geometries` entry's bounds, once its rings nest as its type requires. */
function geometryBox({ type, coordinates }: NonNullable<WithinWhere["geometries"]>[number]) {
  if (type === "Polygon" && isRings(coordinates)) return bboxFromGeoJSON({ type, coordinates });
  if (type === "MultiPolygon" && isPolygons(coordinates)) {
    return bboxFromGeoJSON({ type, coordinates });
  }
  return undefined;
}

/** The bounding boxes of the areas the text's `searched.resolvedAreas` reports for `queries`. */
function resolvedAreaBoxes(agentResponse: unknown): BBox[] {
  const searched = isRecord(agentResponse) ? agentResponse.searched : undefined;
  const resolved = isRecord(searched) ? searched.resolvedAreas : undefined;
  if (!Array.isArray(resolved)) return [];
  return resolved.flatMap((entry) => {
    const box = isRecord(entry) && isRecord(entry.area) ? entry.area.boundingBox : undefined;
    return isBBox(box) ? [box] : [];
  });
}

/**
 * The bounds from the input and the result's text, for a host that drops the result `_meta`
 * and its app data: the searched `bbox` the text gives for a `nearby` or `alongRoute`, else a
 * `within`'s `boundingBox`, `areas` and `geometries`, and the areas its `queries` resolved to.
 * Undefined when a query's area is missing from the text.
 */
export function boundsWithoutAppData(
  where: GetTrafficParams["where"] | undefined,
  agentResponse: unknown
): number[] | undefined {
  if (isRecord(agentResponse) && isBBox(agentResponse.bbox)) return agentResponse.bbox;
  if (where?.mode !== "within") return undefined;
  const resolved = resolvedAreaBoxes(agentResponse);
  if (where.queries?.length && !resolved.length) return undefined;
  const boxes = [
    where.boundingBox,
    ...(where.areas ?? []).map((area) => area.boundingBox),
    ...(where.geometries ?? []).map(geometryBox),
    ...resolved,
  ].filter(isBBox);
  return boxes.length ? bboxFromBBoxes(boxes) : undefined;
}
