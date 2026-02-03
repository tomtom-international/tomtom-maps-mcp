/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, TrafficFlowModule, TrafficIncidentsModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { shouldShowUI, hideMapUI, showMapUI } from '../../shared/ui-visibility';
import { API_KEY } from '../../shared/config';
import './styles.css';

TomTomConfig.instance.put({ apiKey: API_KEY, language: 'en-GB' });

const map = new TomTomMap({
  mapLibre: { container: 'sdk-map', center: [-74.0, 40.75], zoom: 10 },
});

let trafficFlowModule: TrafficFlowModule | null = null;
let trafficIncidentsModule: TrafficIncidentsModule | null = null;
let mapReady = false;
let pendingData: any = null;

// Initialize modules
(async () => {
  // Enable TrafficFlowModule for background traffic flow visualization
  trafficFlowModule = await TrafficFlowModule.get(map);

  // Enable TrafficIncidentsModule for live incidents with built-in icons
  trafficIncidentsModule = await TrafficIncidentsModule.get(map, { visible: true });
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
  const onReady = () => {
    mapReady = true;
    if (pendingData) {
      processIncidentData(pendingData);
      pendingData = null;
    }
  };

  if (map.mapLibreMap.loaded()) {
    onReady();
  } else {
    map.mapLibreMap.on('load', onReady);
  }
})();

function processIncidentData(data: any) {
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
      fitBounds(bounds);
    }
  }

  console.log(`Received ${incidents.length} incidents from tool - live incidents displayed via TrafficIncidentsModule`);
}

function fitBounds(coords: number[][]) {
  if (coords.length < 2) return;
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
  if (!mapReady) {
    pendingData = data;
    return;
  }
  processIncidentData(data);
}

const app = new App({ name: 'TomTom Traffic Incidents', version: '1.0.0' });
app.ontoolresult = (r) => {
  if (r.isError) return;
  try {
    if (r.content[0].type === 'text') {
      const apiResponse = JSON.parse(r.content[0].text);
      if (!shouldShowUI(apiResponse)) {
        hideMapUI();
        return;
      }
      showMapUI();
      displayIncidents(apiResponse);
    }
  } catch (e) {
    console.error('Error parsing incident data:', e);
  }
};
app.onteardown = async () => {
  if (trafficFlowModule) trafficFlowModule.setVisible(false);
  if (trafficIncidentsModule) trafficIncidentsModule.setVisible(false);
  return {};
};
app.connect();
