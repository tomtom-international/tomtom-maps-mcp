/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { bboxFromGeoJSON } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, PlacesModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { parseReachableRangeResponse } from '../../shared/sdk-parsers';
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
    mapLibre: { container: 'sdk-map', center: [4.8156, 52.4414], zoom: 8 },
  });
})();

const placesModulePromise = (async () => {
  const map = await mapPromise;
  return await PlacesModule.get(map, {
    text: { title: () => 'Center' },
    theme: 'pin',
  });
})();

const rangeSourceId = 'range-source';
const rangeFillId = 'range-fill';
const rangeLineId = 'range-line';

async function processData(apiResponse: any) {
  const map = await mapPromise;
  const placesModule = await placesModulePromise;

  // Use SDK's built-in parser for correct format
  const rangeResult = parseReachableRangeResponse(apiResponse);

  if (!rangeResult?.features?.length) {
    await clear();
    return;
  }

  const rangeFeature = rangeResult.features[0];
  const geometry = rangeFeature.geometry;

  // Handle polygon geometry from SDK parser
  if (geometry.type === 'Polygon') {
    const src = map.mapLibreMap.getSource(rangeSourceId) as any;
    if (src) src.setData(rangeFeature);

    // Show center marker if available in properties
    const center = rangeFeature.properties?.center;
    if (center) {
      placesModule.show([{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [center.longitude, center.latitude] },
        properties: { label: 'Center' },
      }]);
    }

    // Fit bounds using SDK utility
    const bbox = bboxFromGeoJSON(rangeResult);
    if (bbox) {
      map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
        padding: 50,
      });
    }
  }
}

async function displayRange(apiResponse: any) {
  if (!isReady) {
    pendingData = apiResponse;
    return;
  }
  await processData(apiResponse);
}

async function clear() {
  const map = await mapPromise;
  const placesModule = await placesModulePromise;

  const src = map.mapLibreMap.getSource(rangeSourceId) as any;
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
  await placesModule.clear();
}

const app = new App({ name: 'TomTom Reachable Range', version: '1.0.0' });

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
      displayRange(apiResponse);
    }
  } catch (e) {
    console.error('Parse error:', e);
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
    const placesModule = await placesModulePromise;

    // Add map controls for theme and traffic
    await createMapControls(map, {
      position: 'top-right',
      showTrafficToggle: true,
      showThemeToggle: true,
    });

    // Setup map layers and handle ready state
    const setupLayers = async () => {
      map.mapLibreMap.addSource(rangeSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.mapLibreMap.addLayer({ id: rangeFillId, type: 'fill', source: rangeSourceId, paint: { 'fill-color': '#4a90e2', 'fill-opacity': 0.3 } });
      map.mapLibreMap.addLayer({ id: rangeLineId, type: 'line', source: rangeSourceId, paint: { 'line-color': '#4a90e2', 'line-width': 2 } });

      isReady = true;
      if (pendingData) {
        await processData(pendingData);
        pendingData = null;
      }
    };

    if (map.mapLibreMap.loaded()) {
      await setupLayers();
    } else {
      map.mapLibreMap.on('load', setupLayers);
    }
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
})();
