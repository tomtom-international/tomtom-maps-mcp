/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { GetTrafficParams } from "../../../schemas/traffic/trafficSchema";

/**
 * The bounds to frame the map on from the tool input, before the result comes.
 * `within` unions all its fields, and `queries`, `geometries` and `nearby` resolve
 * on the server, so only a lone `boundingBox` frames from the input.
 */
export function inputBounds(where: GetTrafficParams["where"] | undefined): number[] | undefined {
  if (where?.mode !== "within" || where.queries || where.geometries) return undefined;
  return where.boundingBox;
}
