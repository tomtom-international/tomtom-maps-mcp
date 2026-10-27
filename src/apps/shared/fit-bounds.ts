/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { TomTomMap } from "@tomtom-org/maps-sdk/map";

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Frame a west-south-east-north box. Callers keep their own padding and zoom. */
export function fitMapToBounds(
  map: TomTomMap,
  bounds: MapBounds,
  options: { padding: number; maxZoom: number; duration?: number }
): void {
  map.mapLibreMap.fitBounds(
    [
      [bounds.west, bounds.south],
      [bounds.east, bounds.north],
    ],
    options
  );
}
