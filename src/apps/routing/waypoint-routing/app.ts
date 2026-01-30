/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomConfig, Waypoint } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, RoutingModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { transformApiRoutes } from '../../shared/route-info';
import { API_KEY } from '../../shared/config';
import './styles.css';

TomTomConfig.instance.put({ apiKey: API_KEY, language: 'en-GB' });

const map = new TomTomMap({
  mapLibre: { container: 'sdk-map', center: [4.8156, 52.4414], zoom: 7 },
});

let routingModule: RoutingModule | null = null;
let mapReady = false;
let pendingData: any = null;

// Initialize routing module
(async () => {
  routingModule = await RoutingModule.get(map);

  // Add map controls for theme and traffic
  await createMapControls(map, {
    position: 'top-right',
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  map.mapLibreMap.on('load', () => {
    mapReady = true;

    // Process pending data if any
    if (pendingData) {
      processRouteData(pendingData);
      pendingData = null;
    }
  });
})();

function processRouteData(data: any) {
  if (!routingModule) return;

  const routes = data.routes || [];
  if (!routes.length) {
    clear();
    return;
  }

  const route = routes[0];
  const legs = route.legs || [];

  // Extract waypoints from leg start/end points
  const waypoints: Waypoint[] = [];
  const allCoords: [number, number][] = [];

  legs.forEach((leg: any, index: number) => {
    const points = leg.points || [];
    if (points.length === 0) return;

    // Add first point of each leg as a waypoint
    const startPoint = points[0];
    waypoints.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [startPoint.longitude, startPoint.latitude]
      },
      properties: {
        name: index === 0 ? 'Start' : `Stop ${index}`
      }
    } as any);

    // Collect all coordinates for the route line
    points.forEach((p: any) => {
      allCoords.push([p.longitude, p.latitude]);
    });
  });

  // Add final destination waypoint
  if (allCoords.length > 0) {
    const lastCoord = allCoords[allCoords.length - 1];
    waypoints.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: lastCoord
      },
      properties: {
        name: 'End'
      }
    } as any);
  }

  // Transform to SDK format and show route
  const sdkRoutes = transformApiRoutes(routes);
  routingModule.showRoutes(sdkRoutes);
  routingModule.showWaypoints(waypoints);

  // Fit map bounds to show entire route
  if (allCoords.length >= 2) {
    fitBounds(allCoords);
  }
}

function fitBounds(coords: number[][]) {
  if (coords.length < 2) return;

  const bbox = coords.reduce((acc, [lng, lat]) => ({
    minLng: Math.min(acc.minLng, lng),
    maxLng: Math.max(acc.maxLng, lng),
    minLat: Math.min(acc.minLat, lat),
    maxLat: Math.max(acc.maxLat, lat),
  }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });

  map.mapLibreMap.fitBounds(
    [[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]],
    { padding: 80, maxZoom: 14 }
  );
}

async function clear() {
  if (routingModule) {
    await routingModule.clearRoutes();
    await routingModule.clearWaypoints();
  }
}

async function displayRoute(data: any) {
  if (!mapReady || !routingModule) {
    pendingData = data;
    return;
  }
  processRouteData(data);
}

const app = new App({ name: 'TomTom Waypoint Routing', version: '1.0.0' });
app.ontoolresult = (r) => {
  if (r.isError) return;
  try {
    if (r.content[0].type === 'text') {
      displayRoute(JSON.parse(r.content[0].text));
    }
  } catch (e) {
    console.error('Error parsing route data:', e);
  }
};
app.onteardown = async () => {
  await clear();
  return {};
};
app.connect();
