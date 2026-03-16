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

function showPopupForFeature(
  feature: { properties?: Record<string, unknown> | null; geometry?: unknown },
  lngLat: [number, number]
): void {
  if (!map) return;

  const props = feature.properties || {};

  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  const html = buildIncidentPopupHtml(props);

  activePopup = new Popup({
    closeButton: true,
    maxWidth: "360px",
    className: "poi-popup-container incident-popup-container",
    offset: [0, -12],
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

  trafficIncidentsModule.events.on("click", (feature, lngLat) => {
    showPopupForFeature(feature, [lngLat.lng, lngLat.lat]);
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
    const incidentLayers = gl
      .getStyle()
      .layers.filter((l) => l.type !== "background" && l.source === "vectorTilesIncidents")
      .map((l) => l.id);

    if (incidentLayers.length === 0) {
      // SDK layers not ready yet, retry
      if (retries++ < 5) gl.once("idle", tryOpen);
      return;
    }

    const features = gl.queryRenderedFeatures(undefined, { layers: incidentLayers });

    // Pick a random incident that has a description
    const withDesc = features.filter(
      (f) => f.properties?.description || f.properties?.description_0
    );
    const feat =
      withDesc.length > 0 ? withDesc[Math.floor(Math.random() * withDesc.length)] : undefined;
    if (!feat) {
      if (retries++ < 5) gl.once("idle", tryOpen);
      return;
    }

    autoPopupShown = true;
    const geom = feat.geometry as { type: string; coordinates: number[] | number[][] };
    let lngLat: [number, number];

    if (geom.type === "Point") {
      const coords = geom.coordinates as number[];
      lngLat = [coords[0], coords[1]];
    } else if (geom.type === "LineString" && (geom.coordinates as number[][]).length > 0) {
      // Use the midpoint of the line
      const coords = geom.coordinates as number[][];
      const mid = coords[Math.floor(coords.length / 2)];
      lngLat = [mid[0], mid[1]];
    } else {
      return;
    }

    showPopupForFeature(feat, lngLat);
  };

  // The flyTo animation takes ~2.5s, then tiles need to load.
  gl.once("idle", tryOpen);
}

// Inline SVG icons for popup rows
const ICON_WARNING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_LOCATION = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const ICON_CLOCK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

// Magnitude string → severity style mapping (SDK uses string values)
const MAGNITUDE_LABEL: Record<string, { label: string; color: string }> = {
  // SDK click events (camelCase string values)
  unknown: { label: "Unknown", color: "#6b7280" },
  minor: { label: "Minor", color: "#ca8a04" },
  moderate: { label: "Moderate", color: "#ea580c" },
  major: { label: "Major", color: "#dc2626" },
  indefinite: { label: "Indefinite", color: "#991b1b" },
  // Vector tile features (numeric values, stringified)
  "0": { label: "Unknown", color: "#6b7280" },
  "1": { label: "Minor", color: "#ca8a04" },
  "2": { label: "Moderate", color: "#ea580c" },
  "3": { label: "Major", color: "#dc2626" },
  "4": { label: "Indefinite", color: "#991b1b" },
};

// Category slug → display name (SDK uses kebab-case strings)
const CATEGORY_LABEL: Record<string, string> = {
  accident: "Accident",
  fog: "Fog",
  "dangerous-conditions": "Dangerous Conditions",
  rain: "Rain",
  ice: "Ice",
  "lane-restrictions": "Lane Restrictions",
  "lane-closure": "Lane Closure",
  "road-closed": "Road Closure",
  "road-works": "Road Works",
  wind: "Wind",
  flooding: "Flooding",
  detour: "Detour",
  cluster: "Cluster",
};

function buildIncidentPopupHtml(props: Record<string, unknown>): string {
  // SDK click events use camelCase; vector tile features (auto-popup) use snake_case.
  // Read both so the same function works for either source.
  const description = (props.description as string) || (props.description_0 as string) || "";
  const category = (props.category as string) || (props.icon_category_0 as string) || "";
  const rawMagnitude = props.magnitudeOfDelay ?? props.magnitude_of_delay ?? "";
  const magnitudeOfDelay = String(rawMagnitude);
  const roadCategory = (props.roadCategory as string) || (props.road_category as string) || "";
  const roadSubcategory =
    (props.roadSubcategory as string) || (props.road_subcategory as string) || "";
  const delay = props.delay ? Number(props.delay) : 0;
  const numberOfReports = props.numberOfReports
    ? Number(props.numberOfReports)
    : props.number_of_reports
      ? Number(props.number_of_reports)
      : 0;
  const timeValidity = (props.timeValidity as string) || (props.time_validity as string) || "";
  const startTime = (props.startTime as string) || (props.start_time as string) || "";
  const endTime = (props.endTime as string) || (props.end_time as string) || "";

  const magnitudeStyle = MAGNITUDE_LABEL[magnitudeOfDelay.toLowerCase()] || null;
  const categoryName = CATEGORY_LABEL[category] || "";

  // Title: prefer description, then category name, then magnitude
  let title = description;
  if (!title) {
    title = categoryName || (magnitudeStyle ? `${magnitudeStyle.label} Congestion` : "Traffic");
  }

  let html = `<div class="incident-popup">`;

  // Title
  html += `<div class="incident-popup-title">${escapeHtml(title)}</div>`;

  // Category badge (if we have a category and description already covers the title)
  if (description && categoryName) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_WARNING}</span>`;
    html += `<span>${escapeHtml(categoryName)}</span>`;
    html += `</div>`;
  }

  // Severity row
  if (magnitudeStyle) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon" style="color:${magnitudeStyle.color}">${ICON_WARNING}</span>`;
    html += `<span style="color:${magnitudeStyle.color};font-weight:600">${magnitudeStyle.label}</span>`;
    html += `</div>`;
  }

  // Road category row
  const road = [roadCategory, roadSubcategory].filter(Boolean).join(" · ");
  if (road) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_LOCATION}</span>`;
    html += `<span>${escapeHtml(road)}</span>`;
    html += `</div>`;
  }

  // Time info row
  const timeDetails: string[] = [];
  if (timeValidity) timeDetails.push(timeValidity);
  if (startTime) {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : null;
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    timeDetails.length = 0; // replace with formatted dates
    timeDetails.push(`${fmt(start)}${end ? ` → ${fmt(end)}` : ""}`);
  }
  if (timeDetails.length > 0) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_CLOCK}</span>`;
    html += `<span>${escapeHtml(timeDetails.join(" · "))}</span>`;
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

  // Reports count
  if (numberOfReports > 0) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_LOCATION}</span>`;
    html += `<span>${numberOfReports} report${numberOfReports > 1 ? "s" : ""}</span>`;
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

function flyToBbox(bbox: number[] | string): void {
  if (!map) return;

  const parts = Array.isArray(bbox) ? bbox : bbox.split(",").map(Number);
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
    pitch: 0,
    bearing: 0,
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
  const bbox = args.bbox as number[] | string | undefined;
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
