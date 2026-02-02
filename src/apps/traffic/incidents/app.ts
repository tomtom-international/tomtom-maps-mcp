/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomMap, TrafficFlowModule, TrafficIncidentsModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
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
    mapLibre: { container: 'sdk-map', center: [-74.0, 40.75], zoom: 10 },
  });
})();

const trafficFlowModulePromise = (async () => {
  const map = await mapPromise;
  return await TrafficFlowModule.get(map);
})();

const trafficIncidentsModulePromise = (async () => {
  const map = await mapPromise;
  return await TrafficIncidentsModule.get(map, { visible: true });
})();

async function processIncidentData(data: any) {
  const map = await mapPromise;
  const incidents = data.incidents || [];

  // Extract bounds from incidents and fit map
  if (incidents.length > 0) {
    const bounds: number[][] = [];
    incidents.forEach((inc: any) => {
      const coords = inc.geometry?.coordinates;
      if (!coords) return;
      if (inc.geometry.type === 'LineString') {
        coords.forEach((c: number[]) => bounds.push(c));
      } else if (inc.geometry.type === 'Point') {
        bounds.push(coords);
      }
    });

    if (bounds.length >= 2) {
      await fitBounds(bounds);
    }
  }

  console.log(`Received ${incidents.length} incidents from tool - live incidents displayed via TrafficIncidentsModule`);
}

async function fitBounds(coords: number[][]) {
  if (coords.length < 2) return;
  const map = await mapPromise;
  const bbox = coords.reduce((acc, [lng, lat]) => ({
    minLng: Math.min(acc.minLng, lng), maxLng: Math.max(acc.maxLng, lng),
    minLat: Math.min(acc.minLat, lat), maxLat: Math.max(acc.maxLat, lat),
  }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });

  map.mapLibreMap.fitBounds(
    [[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]],
    { padding: 60, maxZoom: 14 }
  );
}

async function displayIncidents(data: any) {
  if (!isReady) {
    pendingData = data;
    return;
  }
  await processIncidentData(data);
}

const app = new App({ name: 'TomTom Traffic Incidents', version: '1.0.0' });

/**
 * Fetch full visualization data from the server.
 * The trimmed response doesn't include geometry coordinates needed for bounds calculation.
 */
async function fetchVisualizationData(visualizationId: string): Promise<any | null> {
  try {
    const result = await app.callServerTool({
      name: 'tomtom-get-traffic-visualization-data',
      arguments: { visualizationId },
    });
    if (result.isError) return null;
    if (result.content[0]?.type === 'text') {
      return JSON.parse(result.content[0].text);
    }
    return null;
  } catch (e) {
    console.error('Failed to fetch visualization data:', e);
    return null;
  }
}

app.ontoolresult = async (r) => {
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
        const fullData = await fetchVisualizationData(visualizationId);
        if (fullData) {
          displayIncidents(fullData);
          return;
        }
      }
      // Fallback to trimmed data (may not have coordinates for bounds)
      displayIncidents(apiResponse);
    }
  } catch (e) {
    console.error('Error parsing incident data:', e);
  }
};

app.onteardown = async () => {
  const trafficFlowModule = await trafficFlowModulePromise;
  const trafficIncidentsModule = await trafficIncidentsModulePromise;
  trafficFlowModule.setVisible(false);
  trafficIncidentsModule.setVisible(false);
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
    const trafficFlowModule = await trafficFlowModulePromise;
    const trafficIncidentsModule = await trafficIncidentsModulePromise;

    // Enable traffic modules
    trafficIncidentsModule.setVisible(true);
    trafficIncidentsModule.setIconsVisible(true); // Explicitly enable incident icons
    trafficFlowModule.setVisible(true);

    // Add map controls for theme and traffic (pass existing traffic module)
    await createMapControls(map, {
      position: 'top-right',
      showTrafficToggle: true,
      showThemeToggle: true,
      externalTrafficModule: trafficFlowModule,
    });

    // Handle map ready state - check if already loaded or wait for load event
    const onReady = async () => {
      isReady = true;
      if (pendingData) {
        await processIncidentData(pendingData);
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
