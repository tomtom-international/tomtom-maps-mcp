/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { TomTomMap, TrafficFlowModule, TrafficIncidentsModule } from '@tomtom-org/maps-sdk/map';
import { Popup } from 'maplibre-gl';
import { createMapControls } from '../../shared/map-controls';
import { shouldShowUI, showMapUI, hideMapUI } from '../../shared/ui-visibility';
import { extractFullData } from '../../shared/decompress';
import { ensureTomTomConfigured } from '../../shared/sdk-config';
import './styles.css';

// GeoJSON source/layer IDs for API-returned incidents
const INCIDENT_SOURCE = 'api-incidents';
const INCIDENT_LINE_LAYER = 'api-incidents-lines';
const INCIDENT_LINE_CASING_LAYER = 'api-incidents-lines-casing';
const INCIDENT_POINT_LAYER = 'api-incidents-points';

// TomTom SDK-aligned colors by iconCategory
// These match the standard TomTom traffic incident styling
const ICON_CATEGORY_COLORS: Record<number, string> = {
  0: '#95A5A6', // Unknown - gray
  1: '#C50606', // Accident - red
  2: '#3498DB', // Fog - blue
  3: '#E67E22', // Dangerous Conditions - orange
  4: '#3498DB', // Rain - blue
  5: '#3498DB', // Ice - blue
  6: '#C50606', // Jam - red
  7: '#E67E22', // Lane Closed - orange
  8: '#C50606', // Road Closed - red
  9: '#F39C12', // Road Works - amber
  10: '#3498DB', // Wind - blue
  11: '#3498DB', // Flooding - blue
  14: '#E67E22', // Broken Down Vehicle - orange
};
const DEFAULT_COLOR = '#95A5A6';

// State tracking - map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let trafficFlowModule: TrafficFlowModule | null = null;
let trafficIncidentsModule: TrafficIncidentsModule | null = null;
let activePopup: Popup | null = null;
let mapReady = false;
let pendingData: any = null;

// App instance created early so we can reference it
const app = new App({ name: 'TomTom Traffic Incidents', version: '1.0.0' });

async function initializeMap() {
  if (map) return; // Already initialized

  // Ensure TomTom SDK is configured with API key from server
  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: 'sdk-map', center: [-74.0, 40.75], zoom: 10 },
  });

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

  // Handle map ready state
  return new Promise<void>((resolve) => {
    const onReady = () => {
      mapReady = true;
      if (pendingData) {
        processIncidentData(pendingData);
        pendingData = null;
      }
      resolve();
    };

    if (map!.mapLibreMap.loaded()) {
      onReady();
    } else {
      map!.mapLibreMap.on('load', onReady);
    }
  });
}

/**
 * Get the display color for an incident based on its iconCategory.
 */
function getIncidentColor(iconCategory: number): string {
  return ICON_CATEGORY_COLORS[iconCategory] || DEFAULT_COLOR;
}

/**
 * Get a human-readable label for an iconCategory.
 */
function getIncidentLabel(iconCategory: number): string {
  const labels: Record<number, string> = {
    0: 'Unknown',
    1: 'Accident',
    2: 'Fog',
    3: 'Dangerous Conditions',
    4: 'Rain',
    5: 'Ice',
    6: 'Traffic Jam',
    7: 'Lane Closed',
    8: 'Road Closed',
    9: 'Road Works',
    10: 'Wind',
    11: 'Flooding',
    14: 'Broken Down Vehicle',
  };
  return labels[iconCategory] || 'Incident';
}

/**
 * Remove existing API incident layers and source before re-adding.
 */
function clearIncidentLayers() {
  if (!map) return;
  const mlMap = map.mapLibreMap;

  // Close any open popup
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  // Remove layers first (order matters)
  for (const layerId of [INCIDENT_POINT_LAYER, INCIDENT_LINE_LAYER, INCIDENT_LINE_CASING_LAYER]) {
    if (mlMap.getLayer(layerId)) {
      mlMap.removeLayer(layerId);
    }
  }

  // Then remove source
  if (mlMap.getSource(INCIDENT_SOURCE)) {
    mlMap.removeSource(INCIDENT_SOURCE);
  }
}

/**
 * Build popup HTML for an incident feature.
 */
function buildIncidentPopupHtml(properties: any): string {
  const category = getIncidentLabel(properties.iconCategory);
  const color = getIncidentColor(properties.iconCategory);
  const events = properties.events || [];
  const from = properties.from || '';
  const to = properties.to || '';
  const road = properties.roadNumbers?.length ? properties.roadNumbers.join(', ') : '';
  const delay = properties.delay ? `${Math.round(properties.delay / 60)} min delay` : '';
  const length = properties.length ? `${(properties.length / 1000).toFixed(1)} km` : '';

  let html = `<div class="incident-popup">`;
  html += `<div class="incident-popup-header" style="border-left: 4px solid ${color}">`;
  html += `<span class="incident-popup-category">${escapeHtml(category)}</span>`;
  if (road) html += `<span class="incident-popup-road">${escapeHtml(road)}</span>`;
  html += `</div>`;

  // Event descriptions
  if (events.length > 0) {
    const descriptions = events.map((e: any) => e.description).filter(Boolean);
    if (descriptions.length > 0) {
      html += `<div class="incident-popup-desc">${escapeHtml(descriptions.join(' · '))}</div>`;
    }
  }

  // Location
  if (from || to) {
    const location = from && to ? `${from} → ${to}` : from || to;
    html += `<div class="incident-popup-location">${escapeHtml(location)}</div>`;
  }

  // Details row
  const details = [length, delay].filter(Boolean);
  if (details.length > 0) {
    html += `<div class="incident-popup-details">${escapeHtml(details.join(' · '))}</div>`;
  }

  html += `</div>`;
  return html;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Add API-returned incidents as GeoJSON layers on the map.
 */
function addIncidentLayers(incidents: any[]) {
  if (!map) return;
  const mlMap = map.mapLibreMap;

  // Separate features by geometry type and add color property
  const lineFeatures: any[] = [];
  const pointFeatures: any[] = [];

  incidents.forEach((inc: any) => {
    const coords = inc.geometry?.coordinates;
    if (!coords) return;

    const color = getIncidentColor(inc.properties?.iconCategory);
    const feature = {
      ...inc,
      properties: {
        ...inc.properties,
        _color: color,
        // Stringify events for MapLibre (can't store arrays in feature properties)
        _events: JSON.stringify(inc.properties?.events || []),
      },
    };

    if (inc.geometry.type === 'LineString') {
      lineFeatures.push(feature);
    } else if (inc.geometry.type === 'Point') {
      pointFeatures.push(feature);
    }
  });

  const allFeatures = [...lineFeatures, ...pointFeatures];
  if (allFeatures.length === 0) return;

  // Add GeoJSON source with all incidents
  mlMap.addSource(INCIDENT_SOURCE, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: allFeatures,
    },
  });

  // Line casing (white border to match TomTom SDK dashed style)
  mlMap.addLayer({
    id: INCIDENT_LINE_CASING_LAYER,
    type: 'line',
    source: INCIDENT_SOURCE,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: {
      'line-cap': 'butt',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 6],
      'line-opacity': 0.9,
    },
  });

  // Line layer for LineString incidents (dashed, colored by iconCategory)
  mlMap.addLayer({
    id: INCIDENT_LINE_LAYER,
    type: 'line',
    source: INCIDENT_SOURCE,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: {
      'line-cap': 'butt',
      'line-join': 'round',
    },
    paint: {
      'line-color': ['get', '_color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 4],
      'line-dasharray': [2, 2],
      'line-opacity': 0.9,
    },
  });

  // Circle layer for Point incidents
  mlMap.addLayer({
    id: INCIDENT_POINT_LAYER,
    type: 'circle',
    source: INCIDENT_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7],
      'circle-color': ['get', '_color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.9,
    },
  });

  // Click handlers for popups
  setupIncidentClickHandlers(mlMap);
}

/**
 * Set up click handlers on incident layers to show popups.
 */
function setupIncidentClickHandlers(mlMap: any) {
  const interactiveLayers = [INCIDENT_LINE_LAYER, INCIDENT_POINT_LAYER];

  for (const layerId of interactiveLayers) {
    mlMap.on('click', layerId, (e: any) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = { ...feature.properties };

      // Parse stringified events back
      if (typeof props._events === 'string') {
        try {
          props.events = JSON.parse(props._events);
        } catch {
          props.events = [];
        }
      }
      // Parse roadNumbers if stringified
      if (typeof props.roadNumbers === 'string') {
        try {
          props.roadNumbers = JSON.parse(props.roadNumbers);
        } catch {
          props.roadNumbers = [];
        }
      }

      // Close existing popup
      if (activePopup) {
        activePopup.remove();
      }

      const html = buildIncidentPopupHtml(props);

      activePopup = new Popup({
        closeButton: true,
        maxWidth: '320px',
        offset: 10,
      })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(mlMap);
    });

    // Cursor styling
    mlMap.on('mouseenter', layerId, () => {
      mlMap.getCanvas().style.cursor = 'pointer';
    });
    mlMap.on('mouseleave', layerId, () => {
      mlMap.getCanvas().style.cursor = '';
    });
  }
}

function processIncidentData(data: any) {
  if (!map) return;

  const incidents = data.incidents || [];

  // Clear previous incident layers
  clearIncidentLayers();

  if (incidents.length === 0) return;

  // Add incidents as GeoJSON layers on the map
  addIncidentLayers(incidents);

  // Fit map bounds to incident area
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

  console.log(`Plotted ${incidents.length} incidents on map`);
}

function fitBounds(coords: number[][]) {
  if (!map || coords.length < 2) return;
  const bbox = coords.reduce(
    (acc, [lng, lat]) => ({
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

app.ontoolresult = async (r) => {
  if (r.isError) return;
  try {
    if (r.content[0].type !== 'text') return;
    const agentResponse = JSON.parse(r.content[0].text);
    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }
    // Only initialize map when we actually need to show UI
    showMapUI();
    await initializeMap();
    displayIncidents(await extractFullData(app, agentResponse));
  } catch (e) {
    console.error('Error parsing incident data:', e);
  }
};

app.onteardown = async () => {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
  clearIncidentLayers();
  if (trafficFlowModule) trafficFlowModule.setVisible(false);
  if (trafficIncidentsModule) trafficIncidentsModule.setVisible(false);
  return {};
};

app.connect();
