/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * SDK Utilities - Helper functions for working with SDK GeoJSON responses.
 */

import type { Routes } from "@tomtom-org/maps-sdk/core";

/**
 * Extract waypoint positions from a Routes response.
 * Returns coordinate pairs (start, intermediate stops, end) that can be
 * passed directly to RoutingModule.showWaypoints() — the SDK handles
 * icon assignment (ORIGIN, MIDDLE, DESTINATION) automatically.
 */
export function extractWaypointPositionsFromRoutes(routes: Routes): [number, number][] {
  if (!routes.features?.length) return [];

  const route = routes.features[0];
  const coordinates = route.geometry.coordinates as [number, number][];
  const legs = route.properties.sections?.leg || [];

  if (coordinates.length < 2) return [];

  const positions: [number, number][] = [coordinates[0]];

  for (let i = 0; i < legs.length - 1; i++) {
    const endIdx = legs[i].endPointIndex;
    if (endIdx !== undefined && coordinates[endIdx]) {
      positions.push(coordinates[endIdx]);
    }
  }

  positions.push(coordinates[coordinates.length - 1]);
  return positions;
}
