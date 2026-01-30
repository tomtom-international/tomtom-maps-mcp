/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, PlacesModule } from '@tomtom-org/maps-sdk/map';
import { createMapControls } from '../../shared/map-controls';
import { API_KEY } from '../../shared/config';
import './styles.css';

TomTomConfig.instance.put({ apiKey: API_KEY, language: 'en-GB' });

const map = new TomTomMap({
  mapLibre: { container: 'sdk-map', center: [4.8156, 52.4414], zoom: 8 },
});

let placesModule: PlacesModule | null = null;
const rangeSourceId = 'range-source';
const rangeFillId = 'range-fill';
const rangeLineId = 'range-line';

(async () => {
  placesModule = await PlacesModule.get(map, {
    text: { title: () => 'Center' },
    theme: 'pin',
  });

  // Add map controls for theme and traffic
  await createMapControls(map, {
    position: 'top-right',
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  map.mapLibreMap.on('load', () => {
    map.mapLibreMap.addSource(rangeSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.mapLibreMap.addLayer({ id: rangeFillId, type: 'fill', source: rangeSourceId, paint: { 'fill-color': '#4a90e2', 'fill-opacity': 0.3 } });
    map.mapLibreMap.addLayer({ id: rangeLineId, type: 'line', source: rangeSourceId, paint: { 'line-color': '#4a90e2', 'line-width': 2 } });
  });
})();

async function displayRange(data: any) {
  const range = data.reachableRange;
  if (!range?.boundary) { await clear(); return; }

  const coords = range.boundary.map((p: any) => [p.longitude, p.latitude]);
  if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
    coords.push(coords[0]); // Close polygon
  }

  const src = map.mapLibreMap.getSource(rangeSourceId) as any;
  if (src) src.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} });

  if (placesModule && range.center) {
    await placesModule.show([{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [range.center.longitude, range.center.latitude] },
      properties: { label: 'Center' },
    }]);
  }

  fitBounds(coords);
}

function fitBounds(coords: number[][]) {
  if (coords.length < 3) return;
  const bbox = coords.reduce((a, [lng, lat]) => ({
    minLng: Math.min(a.minLng, lng), maxLng: Math.max(a.maxLng, lng),
    minLat: Math.min(a.minLat, lat), maxLat: Math.max(a.maxLat, lat),
  }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });
  map.mapLibreMap.fitBounds([[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]], { padding: 50 });
}

async function clear() {
  const src = map.mapLibreMap.getSource(rangeSourceId) as any;
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
  if (placesModule) await placesModule.clear();
}

const app = new App({ name: 'TomTom Reachable Range', version: '1.0.0' });
app.ontoolresult = (r) => {
  if (r.isError) return;
  try { if (r.content[0].type === 'text') displayRange(JSON.parse(r.content[0].text)); }
  catch (e) { console.error(e); }
};
app.onteardown = async () => { await clear(); return {}; };
app.connect();
