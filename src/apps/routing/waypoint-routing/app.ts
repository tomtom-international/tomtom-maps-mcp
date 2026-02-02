/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { bboxFromGeoJSON } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, RoutingModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { parseRoutingResponse, extractWaypointsFromRoutes } from '../../shared/sdk-parsers';
import { shouldShowUI, hideMapUI, showMapUI } from '../../shared/ui-visibility';
import { ensureTomTomConfigured } from '../../shared/sdk-config';
import './styles.css';

// Module-level state
let isReady = false;
let pendingData: any = null;

let resolveConnectedApp: (app: App) => void;
const connectedAppPromise = new Promise<App>((resolve, _) => {
  resolveConnectedApp = resolve;
});

const mapPromise = (async () => {
  const app = await connectedAppPromise;
  await ensureTomTomConfigured(app);
  return new TomTomMap({
    mapLibre: { container: 'sdk-map', center: [4.8156, 52.4414], zoom: 7 },
  });
})();

const routingModulePromise = (async () => {
  const map = await mapPromise;
  return await RoutingModule.get(map);
})();

async function processRouteData(apiResponse: any) {
  const routingModule = await routingModulePromise;
  const map = await mapPromise;

  // Use SDK's built-in parser for correct format
  const routes = parseRoutingResponse(apiResponse, {
    language: 'en-GB',
    units: 'metric',
  });

  if (!routes.features?.length) {
    await clear();
    return;
  }

  // Extract waypoints from parsed routes
  const waypoints = extractWaypointsFromRoutes(routes);

  // Show route and waypoints
  routingModule.showRoutes(routes);
  routingModule.showWaypoints(waypoints as any);

  // Fit map to route bounds using SDK utility
  const bbox = bboxFromGeoJSON(routes);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
      padding: 80,
      maxZoom: 14,
    });
  }
}

async function clear() {
  const routingModule = await routingModulePromise;
  await routingModule.clearRoutes();
  await routingModule.clearWaypoints();
}

async function displayRoute(data: any) {
  if (!isReady) {
    pendingData = data;
    return;
  }
  await processRouteData(data);
}

const app = new App({ name: 'TomTom Waypoint Routing', version: '1.0.0' });

app.ontoolresult = async (result) => {
  try {
    const content = result.content[0];
    if (content.type === 'text') {
      const apiResponse = JSON.parse(content.text);
      if (!shouldShowUI(apiResponse)) {
        hideMapUI();
        return;
      }
      showMapUI();
      await displayRoute(apiResponse);
    }
  } catch (e) {
    console.error('Error parsing route data:', e);
  }
};

app.onteardown = async () => {
  await clear();
  return {};
};

// Async initialization after connection
(async () => {
  try {
    await app.connect();
    // @ts-ignore
    resolveConnectedApp(app);

    // Wait for map and modules to be initialized
    const map = await mapPromise;
    const routingModule = await routingModulePromise;

    // Add map controls for theme and traffic
    await createMapControls(map, {
      position: 'top-right',
      showTrafficToggle: true,
      showThemeToggle: true,
    });

    // Handle map ready state - check if already loaded or wait for load event
    const onReady = async () => {
      isReady = true;
      if (pendingData) {
        await processRouteData(pendingData);
        pendingData = null;
      }
    };

    if (map.mapLibreMap.loaded()) {
      await onReady();
    } else {
      map.mapLibreMap.on('load', onReady);
    }
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
})();
