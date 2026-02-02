/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { bboxFromGeoJSON } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, PlacesModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { setupPoiPopups, closePoiPopup } from '../../shared/poi-popup';
import { parseReverseGeocodingResponse } from '../../shared/sdk-parsers';
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
    text: { title: (p: any) => p.properties.address?.freeformAddress || 'Unknown' },
    theme: 'pin',
  });
})();

// Process the data once ready
async function processData(apiResponse: any) {
  const placesModule = await placesModulePromise;
  const map = await mapPromise;

  // Use SDK's built-in parser for correct format
  const revGeoResult = parseReverseGeocodingResponse(apiResponse);

  if (!revGeoResult.features?.length) {
    placesModule.clear();
    return;
  }

  placesModule.show(revGeoResult.features as any);

  // Fit bounds using SDK utility
  const bbox = bboxFromGeoJSON(revGeoResult);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
      padding: 50,
      maxZoom: 15,
    });
  }
}

// Display results on map - queues data if not ready
async function displayResults(apiResponse: any) {
  if (!isReady) {
    pendingData = apiResponse;
    return;
  }
  await processData(apiResponse);
}

const app = new App({ name: 'TomTom Reverse Geocode', version: '1.0.0' });

/**
 * Fetch full visualization data from the server.
 */
async function fetchVisualizationData(visualizationId: string): Promise<any | null> {
  try {
    const result = await app.callServerTool({
      name: 'tomtom-get-search-visualization-data',
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

      const visualizationId = apiResponse._meta?.visualizationId;
      if (visualizationId) {
        const fullData = await fetchVisualizationData(visualizationId);
        if (fullData) {
          displayResults(fullData);
          return;
        }
      }
      displayResults(apiResponse);
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
};

app.onteardown = async () => {
  closePoiPopup();
  const placesModule = await placesModulePromise;
  await placesModule.clear();
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

    // Setup click handlers for POI popups
    setupPoiPopups(map, placesModule);

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
        await processData(pendingData);
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
