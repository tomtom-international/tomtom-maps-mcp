/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { BBox } from "@tomtom-org/maps-sdk/core";
import type { TomTomMap } from "@tomtom-org/maps-sdk/map";

/** Frame a west-south-east-north box. Callers keep their own padding and zoom. */
export function fitMapToBounds(
  map: TomTomMap,
  bbox: BBox,
  options: { padding: number; maxZoom: number; duration?: number }
): void {
  map.mapLibreMap.fitBounds(bbox, options);
}
