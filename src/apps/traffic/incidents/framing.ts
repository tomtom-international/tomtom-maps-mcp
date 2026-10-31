/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import type { Feature } from "geojson";
import type { GetTrafficParams } from "../../../schemas/traffic/trafficSchema";

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
 * The bounds to frame the map on from the result: the app data's, or, for a
 * `response_detail: "full"` result, which carries no app data, the incidents' own.
 */
export function resultBounds(
  result: TrafficAppData & { features?: Feature[] }
): number[] | undefined {
  if (result.bbox) return result.bbox;
  return result.features?.length
    ? bboxFromGeoJSON({ type: "FeatureCollection", features: result.features })
    : undefined;
}
