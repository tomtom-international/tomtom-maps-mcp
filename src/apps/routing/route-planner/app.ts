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
  mapLibre: { container: 'sdk-map', center: [-0.5, 51.5], zoom: 8 },
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

  // Extract all coordinates from legs
  const allCoords: [number, number][] = [];
  (route.legs || []).forEach((leg: any) => {
    leg.points?.forEach((p: any) => {
      allCoords.push([p.longitude, p.latitude]);
    });
  });

  if (allCoords.length < 2) {
    clear();
    return;
  }

  // Create start and end waypoints
  const startCoord = allCoords[0];
  const endCoord = allCoords[allCoords.length - 1];

  const waypoints: Waypoint[] = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: startCoord },
      properties: { name: 'Start' }
    } as any,
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: endCoord },
      properties: { name: 'End' }
    } as any
  ];

  // Transform to SDK format and show route
  const sdkRoutes = transformApiRoutes(routes);
  routingModule.showRoutes(sdkRoutes);
  routingModule.showWaypoints(waypoints);

  // Fit map to show entire route
  fitBounds(allCoords);
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
    { padding: 80, maxZoom: 15 }
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

const app = new App({ name: 'TomTom Route Planner', version: '1.0.0' });
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
