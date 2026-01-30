/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { Routes, Route, BBox } from '@tomtom-org/maps-sdk/core';

/**
 * Generates a unique ID for a route
 */
function generateRouteId(): string {
  return `route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Calculates bounding box from coordinates
 */
function calculateBBox(coordinates: [number, number][]): BBox {
  if (coordinates.length === 0) {
    return [0, 0, 0, 0];
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Transforms raw TomTom Routing API response to SDK GeoJSON format.
 * The SDK's RoutingModule.showRoutes() expects Routes with id, bbox, and structured properties.
 */
export function transformApiRoutes(apiRoutes: any[]): Routes {
  const features: Route[] = apiRoutes.map((route: any, index: number) => {
    const coordinates: [number, number][] = [];
    const legs = route.legs || [];

    legs.forEach((leg: any) => {
      (leg.points || []).forEach((p: any) => {
        coordinates.push([p.longitude, p.latitude]);
      });
    });

    const bbox = calculateBBox(coordinates);
    const apiSummary = route.summary || {};

    const summary = {
      lengthInMeters: apiSummary.lengthInMeters || 0,
      travelTimeInSeconds: apiSummary.travelTimeInSeconds || 0,
      trafficDelayInSeconds: apiSummary.trafficDelayInSeconds || 0,
      trafficLengthInMeters: apiSummary.trafficLengthInMeters || 0,
      departureTime: apiSummary.departureTime
        ? new Date(apiSummary.departureTime)
        : new Date(),
      arrivalTime: apiSummary.arrivalTime
        ? new Date(apiSummary.arrivalTime)
        : new Date(Date.now() + (apiSummary.travelTimeInSeconds || 0) * 1000),
      noTrafficTravelTimeInSeconds: apiSummary.noTrafficTravelTimeInSeconds,
      historicTrafficTravelTimeInSeconds: apiSummary.historicTrafficTravelTimeInSeconds,
      liveTrafficIncidentsTravelTimeInSeconds: apiSummary.liveTrafficIncidentsTravelTimeInSeconds,
    };

    const legSections = legs.map((leg: any, legIndex: number) => {
      const legSummary = leg.summary || {};
      return {
        startPointIndex: legIndex === 0 ? 0 : legs.slice(0, legIndex).reduce(
          (sum: number, l: any) => sum + (l.points?.length || 0), 0
        ),
        endPointIndex: legs.slice(0, legIndex + 1).reduce(
          (sum: number, l: any) => sum + (l.points?.length || 0), 0
        ) - 1,
        summary: {
          lengthInMeters: legSummary.lengthInMeters || apiSummary.lengthInMeters || 0,
          travelTimeInSeconds: legSummary.travelTimeInSeconds || apiSummary.travelTimeInSeconds || 0,
          trafficDelayInSeconds: legSummary.trafficDelayInSeconds || 0,
          trafficLengthInMeters: legSummary.trafficLengthInMeters || 0,
          departureTime: legSummary.departureTime
            ? new Date(legSummary.departureTime)
            : summary.departureTime,
          arrivalTime: legSummary.arrivalTime
            ? new Date(legSummary.arrivalTime)
            : summary.arrivalTime,
        },
      };
    });

    const sections = {
      leg: legSections,
      ...(route.sections && {
        traffic: route.sections
          .filter((s: any) => s.sectionType === 'TRAFFIC')
          .map((s: any) => ({ startPointIndex: s.startPointIndex, endPointIndex: s.endPointIndex })),
        toll: route.sections
          .filter((s: any) => s.sectionType === 'TOLL_ROAD')
          .map((s: any) => ({ startPointIndex: s.startPointIndex, endPointIndex: s.endPointIndex })),
        motorway: route.sections
          .filter((s: any) => s.sectionType === 'MOTORWAY')
          .map((s: any) => ({ startPointIndex: s.startPointIndex, endPointIndex: s.endPointIndex })),
      }),
    };

    return {
      type: 'Feature',
      id: generateRouteId(),
      bbox,
      geometry: { type: 'LineString', coordinates },
      properties: { summary, sections, index },
    } as Route;
  });

  const allCoords = features.flatMap(f => f.geometry.coordinates as [number, number][]);
  const collectionBbox = allCoords.length > 0 ? calculateBBox(allCoords) : undefined;

  return {
    type: 'FeatureCollection',
    features,
    ...(collectionBbox && { bbox: collectionBbox }),
  } as Routes;
}
