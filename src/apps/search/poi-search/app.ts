/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, PlacesModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { setupPoiPopups, closePoiPopup } from '../../shared/poi-popup';
import { API_KEY } from '../../shared/config';
import './styles.css';

// Initialize TomTom SDK
TomTomConfig.instance.put({ apiKey: API_KEY, language: 'en-GB' });

// Create map
const map = new TomTomMap({
  mapLibre: {
    container: 'sdk-map',
    center: [4.8156, 52.4414],
    zoom: 8,
  },
});

// Initialize PlacesModule
let placesModule: PlacesModule | null = null;

(async () => {
  placesModule = await PlacesModule.get(map, {
    text: {
      title: (place: any) =>
        place.properties.poi?.name ||
        place.properties.address?.freeformAddress ||
        'Unknown',
    },
    theme: 'pin',
  });

  // Setup click handlers for POI popups
  setupPoiPopups(map, placesModule);

  // Add map controls for theme and traffic
  await createMapControls(map, {
    position: 'top-right',
    showTrafficToggle: true,
    showThemeToggle: true,
  });
})();

// Display POIs on map
async function displayPOIs(data: any) {
  if (!placesModule) return;

  const results = data.results || [];
  if (results.length === 0) {
    await placesModule.clear();
    return;
  }

  // Convert to Places format
  const places = results.map((poi: any) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [poi.position.lon, poi.position.lat],
    },
    properties: {
      ...poi,
      id: poi.id,
      address: poi.address,
      poi: poi.poi,
      position: poi.position,
    },
  }));

  await placesModule.show(places);

  // Fit bounds
  const bounds = results.map((poi: any) => [poi.position.lon, poi.position.lat]);
  if (bounds.length === 1) {
    map.mapLibreMap.setCenter(bounds[0]);
    map.mapLibreMap.setZoom(14);
  } else if (bounds.length > 1) {
    const bbox = bounds.reduce(
      (acc: any, [lng, lat]: any) => ({
        minLng: Math.min(acc.minLng, lng),
        maxLng: Math.max(acc.maxLng, lng),
        minLat: Math.min(acc.minLat, lat),
        maxLat: Math.max(acc.maxLat, lat),
      }),
      { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity }
    );
    map.mapLibreMap.fitBounds(
      [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
      ],
      { padding: 50 }
    );
  }
}

// Initialize MCP App
const app = new App({ name: 'TomTom POI Search', version: '1.0.0' });

app.ontoolresult = (result) => {
  if (result.isError) return;
  try {
    const content = result.content[0];
    if (content.type === 'text') {
      displayPOIs(JSON.parse(content.text));
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
};

app.onteardown = async () => {
  closePoiPopup();
  if (placesModule) await placesModule.clear();
  return {};
};

app.connect();
