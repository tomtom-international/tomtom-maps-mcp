/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap, TrafficFlowModule, TrafficIncidentsModule } from "@tomtom-org/maps-sdk/map";
import { Popup } from "maplibre-gl";
import { createMapControls } from "../../shared/map-controls";
import { shouldShowUI, showMapUI, hideMapUI } from "../../shared/ui-visibility";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { injectPoiPopupStyles } from "../../shared/poi-popup";
import "./styles.css";

// State tracking — map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let trafficFlowModule: TrafficFlowModule | null = null;
let trafficIncidentsModule: TrafficIncidentsModule | null = null;
let activePopup: Popup | null = null;
let mapInitialized = false;
let timerIntervalId: ReturnType<typeof setInterval> | null = null;
let lastUpdatedTimestamp: number | null = null;
let autoPopupShown = false;

const app = new App({ name: "TomTom Traffic Incidents", version: "1.0.0" });

// ---------------------------------------------------------------------------
// Map initialization
// ---------------------------------------------------------------------------

async function initializeMap(): Promise<void> {
  if (mapInitialized) return;

  await ensureTomTomConfigured(app);
  injectPoiPopupStyles();

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  // SDK traffic modules — render live data from vector tiles
  trafficFlowModule = await TrafficFlowModule.get(map);
  trafficIncidentsModule = await TrafficIncidentsModule.get(map, { visible: true });
  trafficIncidentsModule.setVisible(true);
  trafficIncidentsModule.setIconsVisible(true);
  trafficFlowModule.setVisible(true);

  // SDK incident click events for popups
  setupIncidentEvents();

  // Theme & traffic toggle controls
  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
    externalTrafficModule: trafficFlowModule,
  });

  mapInitialized = true;

  // Wait for map to finish loading
  await new Promise<void>((resolve) => {
    if (map!.mapLibreMap.loaded()) {
      resolve();
    } else {
      map!.mapLibreMap.on("load", () => resolve());
    }
  });

  // Reset the live timer when the map viewport changes (pan/zoom = new tiles loaded)
  map!.mapLibreMap.on("moveend", () => {
    resetLiveTimer();
  });
}

// ---------------------------------------------------------------------------
// SDK incident event handlers
// ---------------------------------------------------------------------------

function showPopupForFeature(feature: any, lngLat: [number, number]): void {
  if (!map) return;

  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  const props = feature.properties || {};
  const html = buildIncidentPopupHtml(props);

  activePopup = new Popup({
    closeButton: true,
    maxWidth: "360px",
    className: "poi-popup-container incident-popup-container",
    offset: [0, -10],
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map.mapLibreMap);

  activePopup.on("close", () => {
    activePopup = null;
  });
}

function setupIncidentEvents(): void {
  if (!trafficIncidentsModule || !map) return;

  trafficIncidentsModule.events.on("click", (feature: any, lngLat: any) => {
    showPopupForFeature(feature, lngLat);
  });

  trafficIncidentsModule.events.on("hover", () => {
    if (map) map.mapLibreMap.getCanvas().style.cursor = "pointer";
  });
}

/**
 * Auto-open a popup on the first visible incident after map settles,
 * so users discover that incident markers are clickable.
 */
function autoOpenFirstIncident(): void {
  if (!map || !trafficIncidentsModule || autoPopupShown) return;

  const gl = map.mapLibreMap;
  let retries = 0;

  const tryOpen = () => {
    if (autoPopupShown) return;

    // Find incident layers by source name (SDK uses "vectorTilesIncidents")
    const incidentLayers = gl.getStyle().layers
      .filter((l: any) => l.source === "vectorTilesIncidents")
      .map((l: any) => l.id);

    if (incidentLayers.length === 0) {
      // SDK layers not ready yet, retry
      if (retries++ < 5) gl.once("idle", tryOpen);
      return;
    }

    const features = gl.queryRenderedFeatures(undefined, { layers: incidentLayers });

    // Pick a random incident that has a description
    const withDesc = features.filter((f: any) => f.properties?.description_0);
    const feat = withDesc.length > 0 ? withDesc[Math.floor(Math.random() * withDesc.length)] : undefined;
    if (!feat) {
      if (retries++ < 5) gl.once("idle", tryOpen);
      return;
    }

    autoPopupShown = true;
    const geom = feat.geometry as any;
    let lngLat: [number, number];

    if (geom.type === "Point") {
      lngLat = [geom.coordinates[0], geom.coordinates[1]];
    } else if (geom.type === "LineString" && geom.coordinates.length > 0) {
      // Use the midpoint of the line
      const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
      lngLat = [mid[0], mid[1]];
    } else {
      return;
    }

    showPopupForFeature(feat, lngLat);
  };

  // The flyTo animation takes ~2.5s, then tiles need to load.
  gl.once("idle", tryOpen);
}

// Severity styles by magnitude_of_delay
const MAGNITUDE_STYLES: Record<number, { label: string; color: string }> = {
  0: { label: "Unknown", color: "#6b7280" },
  1: { label: "Minor", color: "#ca8a04" },
  2: { label: "Moderate", color: "#ea580c" },
  3: { label: "Major", color: "#dc2626" },
  4: { label: "Indefinite", color: "#991b1b" },
};

// Inline SVG icons for popup rows
const ICON_WARNING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_LOCATION = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const ICON_CLOCK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

function buildIncidentPopupHtml(props: Record<string, unknown>): string {
  // Collect all description_N fields (compound incidents can have multiple)
  const descriptions: string[] = [];
  for (let i = 0; ; i++) {
    const desc = props[`description_${i}`] as string | undefined;
    if (!desc) break;
    descriptions.push(desc);
  }

  const magnitude = Number(props.magnitude_of_delay ?? -1);
  const magnitudeStyle = MAGNITUDE_STYLES[magnitude];
  const delay = props.delay ? Number(props.delay) : 0;
  const roadCategory = (props.road_category as string) || "";
  const roadSubcategory = (props.road_subcategory as string) || "";

  const title = descriptions[0] || "Traffic Incident";
  const subtitle = descriptions.length > 1 ? descriptions.slice(1).join(", ") : "";

  let html = `<div class="incident-popup">`;

  // Title
  html += `<div class="incident-popup-title">${escapeHtml(title)}</div>`;

  // Severity row
  if (magnitudeStyle) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon" style="color:${magnitudeStyle.color}">${ICON_WARNING}</span>`;
    html += `<span style="color:${magnitudeStyle.color};font-weight:600">${magnitudeStyle.label}</span>`;
    html += `</div>`;
  }

  // Location row — road category info
  const road = [roadCategory, roadSubcategory].filter(Boolean).join(" \u00b7 ");
  if (road) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_LOCATION}</span>`;
    html += `<span>${escapeHtml(subtitle ? `${subtitle} \u00b7 ${road}` : road)}</span>`;
    html += `</div>`;
  } else if (subtitle) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_LOCATION}</span>`;
    html += `<span>${escapeHtml(subtitle)}</span>`;
    html += `</div>`;
  }

  // Delay row
  if (delay > 0) {
    const mins = Math.round(delay / 60);
    const delayText = mins > 0 ? `${mins} min delay` : `${delay}s delay`;
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_CLOCK}</span>`;
    html += `<span>${escapeHtml(delayText)}</span>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

const _escapeDiv = document.createElement("div");
function escapeHtml(text: string): string {
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

// ---------------------------------------------------------------------------
// Cinematic camera — fly to bbox
// ---------------------------------------------------------------------------

function flyToBbox(bbox: string): void {
  if (!map) return;

  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    console.warn("Invalid bbox format:", bbox);
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = parts;
  const centerLng = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // Derive zoom from bbox span — smaller area → higher zoom
  const maxSpan = Math.max(maxLon - minLon, maxLat - minLat);
  const zoom = Math.min(14, Math.max(8, Math.round(9 - Math.log2(maxSpan))));

  map.mapLibreMap.flyTo({
    center: [centerLng, centerLat],
    zoom,
    pitch: 45,
    bearing: -15,
    duration: 2500,
    essential: true,
    easing: (t: number) => 1 - Math.pow(1 - t, 3), // ease-out-cubic
  });
}

// ---------------------------------------------------------------------------
// Live traffic timer
// ---------------------------------------------------------------------------

function createLiveTrafficTimer(): void {
  let timerEl = document.getElementById("live-traffic-timer");
  if (!timerEl) {
    timerEl = document.createElement("div");
    timerEl.id = "live-traffic-timer";
    timerEl.innerHTML = `
      <div class="live-indicator">
        <span class="live-dot"></span>
        <span class="live-label">Live Traffic</span>
        <span class="live-separator">\u00b7</span>
        <span class="live-time">Updated just now</span>
      </div>
    `;
    const mapContainer = document.getElementById("sdk-map");
    if (mapContainer) mapContainer.appendChild(timerEl);
  }

  lastUpdatedTimestamp = Date.now();

  if (timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(updateTimerText, 10_000);
}

function updateTimerText(): void {
  if (!lastUpdatedTimestamp) return;
  const timeEl = document.querySelector(".live-time");
  if (!timeEl) return;

  const elapsed = Math.floor((Date.now() - lastUpdatedTimestamp) / 1000);

  if (elapsed < 10) {
    timeEl.textContent = "Updated just now";
  } else if (elapsed < 60) {
    timeEl.textContent = `Updated ${elapsed}s ago`;
  } else {
    timeEl.textContent = `Updated ${Math.floor(elapsed / 60)}m ago`;
  }
}

function resetLiveTimer(): void {
  lastUpdatedTimestamp = Date.now();
  updateTimerText();
}

function destroyTimer(): void {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
  const timerEl = document.getElementById("live-traffic-timer");
  if (timerEl) timerEl.remove();
  lastUpdatedTimestamp = null;
}

// ---------------------------------------------------------------------------
// MCP App lifecycle
// ---------------------------------------------------------------------------

app.ontoolinput = async (params) => {
  const args = (params.arguments || {}) as Record<string, unknown>;
  const bbox = args.bbox as string | undefined;
  const showUI = args.show_ui !== false;

  if (!showUI) return;

  showMapUI();
  await initializeMap();

  if (bbox) flyToBbox(bbox);

  createLiveTrafficTimer();
  autoOpenFirstIncident();
};

app.ontoolresult = async (r) => {
  if (r.isError) {
    // Live traffic is independent — keep map visible, just log the error
    console.warn("Traffic tool returned error, but live traffic is still displayed.");
    return;
  }

  try {
    if (r.content[0]?.type !== "text") return;
    const agentResponse = JSON.parse(r.content[0].text);

    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      destroyTimer();
      return;
    }

    // Map already initialized and positioned in ontoolinput.
    // SDK modules are already rendering live traffic — nothing else to do.
  } catch (e) {
    console.error("Error processing traffic result:", e);
  }
};

app.onteardown = async () => {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
  destroyTimer();
  if (trafficIncidentsModule) {
    trafficIncidentsModule.events.off("click");
    trafficIncidentsModule.events.off("hover");
    trafficIncidentsModule.setVisible(false);
  }
  if (trafficFlowModule) trafficFlowModule.setVisible(false);
  return {};
};

app.connect();
