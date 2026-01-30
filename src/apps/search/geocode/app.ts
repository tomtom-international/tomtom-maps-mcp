/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, PlacesModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { setupPoiPopups, closePoiPopup } from '../../shared/poi-popup';
import { API_KEY } from '../../shared/config';
import './styles.css';

TomTomConfig.instance.put({ apiKey: API_KEY, language: 'en-GB' });

const map = new TomTomMap({
  mapLibre: { container: 'sdk-map', center: [4.8156, 52.4414], zoom: 8 },
});

let placesModule: PlacesModule | null = null;

(async () => {
  placesModule = await PlacesModule.get(map, {
    text: { title: (p: any) => p.properties.address?.freeformAddress || 'Unknown' },
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

async function displayResults(data: any) {
  if (!placesModule) return;
  const results = data.results || [];
  if (!results.length) { await placesModule.clear(); return; }

  const places = results.map((r: any) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.position.lon, r.position.lat] },
    properties: { ...r, address: r.address, position: r.position },
  }));

  await placesModule.show(places);
  fitBounds(results.map((r: any) => [r.position.lon, r.position.lat]));
}

function fitBounds(bounds: number[][]) {
  if (bounds.length === 1) {
    map.mapLibreMap.setCenter(bounds[0] as [number, number]);
    map.mapLibreMap.setZoom(14);
  } else if (bounds.length > 1) {
    const bbox = bounds.reduce((a, [lng, lat]) => ({
      minLng: Math.min(a.minLng, lng), maxLng: Math.max(a.maxLng, lng),
      minLat: Math.min(a.minLat, lat), maxLat: Math.max(a.maxLat, lat),
    }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });
    map.mapLibreMap.fitBounds([[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]], { padding: 50 });
  }
}

const app = new App({ name: 'TomTom Geocode', version: '1.0.0' });
app.ontoolresult = (r) => {
  if (r.isError) return;
  try { if (r.content[0].type === 'text') displayResults(JSON.parse(r.content[0].text)); }
  catch (e) { console.error(e); }
};
app.onteardown = async () => { closePoiPopup(); if (placesModule) await placesModule.clear(); return {}; };
app.connect();
