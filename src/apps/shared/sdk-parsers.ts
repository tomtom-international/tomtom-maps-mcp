/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * SDK Utilities - Helper functions for working with SDK GeoJSON responses.
 */

import type { Routes, Waypoints } from "@tomtom-org/maps-sdk/core";
import type { Feature, Point } from "geojson";

/**
 * Extract waypoints from parsed Routes as a Waypoints FeatureCollection.
 * The waypoints are formatted with proper properties for RoutingModule.showWaypoints()
 * including indexType for correct icon display (start, middle, finish).
 */
export function extractWaypointsFromRoutes(routes: Routes): Waypoints {
  if (!routes.features?.length) {
    return { type: "FeatureCollection" as const, features: [] } as Waypoints;
  }

  const route = routes.features[0];
  const coordinates = route.geometry.coordinates as [number, number][];
  const legs = route.properties.sections?.leg || [];

  const features: Feature<Point>[] = [];

  if (coordinates.length >= 2) {
    // Start waypoint (first coordinate)
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coordinates[0] },
      properties: {
        type: "Geography",
        address: { freeformAddress: "Start" },
        index: 0,
        indexType: "start",
      },
    });

    // Intermediate waypoints from leg end points
    for (let i = 0; i < legs.length - 1; i++) {
      const endIdx = legs[i].endPointIndex;
      if (endIdx !== undefined && coordinates[endIdx]) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: coordinates[endIdx] },
          properties: {
            type: "Geography",
            address: { freeformAddress: `Stop ${i + 1}` },
            index: i + 1,
            indexType: "middle",
            stopDisplayIndex: i + 1,
          },
        });
      }
    }

    // End waypoint (last coordinate)
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: coordinates[coordinates.length - 1] },
      properties: {
        type: "Geography",
        address: { freeformAddress: "End" },
        index: features.length,
        indexType: "finish",
      },
    });
  }

  return { type: "FeatureCollection", features } as Waypoints;
}
