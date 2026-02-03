/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomConfig, bboxFromGeoJSON } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, RoutingModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { parseRoutingResponse, extractWaypointsFromRoutes } from '../../shared/sdk-parsers';
import { shouldShowUI, hideMapUI, showMapUI } from '../../shared/ui-visibility';
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

  // Handle map ready state - check if already loaded or wait for load event
  const onReady = () => {
    mapReady = true;
    if (pendingData) {
      processRouteData(pendingData);
      pendingData = null;
    }
  };

  if (map.mapLibreMap.loaded()) {
    onReady();
  } else {
    map.mapLibreMap.on('load', onReady);
  }
})();

function processRouteData(apiResponse: any) {
  if (!routingModule) return;

  // Use SDK's built-in parser for correct format
  const routes = parseRoutingResponse(apiResponse, {
    language: 'en-GB',
    units: 'metric',
  });

  if (!routes.features?.length) {
    clear();
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
      maxZoom: 15,
    });
  }
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

/**
 * Fetch full visualization data from server using the visualizationId.
 * This calls the App-only tool that returns complete geo data for rendering.
 */
async function fetchVisualizationData(visualizationId: string): Promise<any | null> {
  try {
    const result = await app.callServerTool({
      name: 'tomtom-get-visualization-data',
      arguments: { visualizationId },
    });

    if (result.isError) {
      console.error('Failed to fetch visualization data:', result.content);
      return null;
    }

    if (result.content[0]?.type === 'text') {
      return JSON.parse(result.content[0].text);
    }

    return null;
  } catch (e) {
    console.error('Error fetching visualization data:', e);
    return null;
  }
}

app.ontoolresult = async (r) => {
  if (r.isError) return;
  try {
    if (r.content[0].type === 'text') {
      const apiResponse = JSON.parse(r.content[0].text);

      if (!shouldShowUI(apiResponse)) {
        hideMapUI();
        return;
      }

      showMapUI();

      // Check if we need to fetch full visualization data
      const visualizationId = apiResponse._meta?.visualizationId;
      if (visualizationId) {
        // Agent received trimmed data, App fetches full data for visualization
        const fullData = await fetchVisualizationData(visualizationId);
        if (fullData) {
          displayRoute(fullData);
        } else {
          // Fallback: try to render with trimmed data (may fail for complex routes)
          console.warn('Could not fetch visualization data, attempting render with trimmed data');
          displayRoute(apiResponse);
        }
      } else {
        // No visualizationId, use the data as-is (backwards compatibility)
        displayRoute(apiResponse);
      }
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
