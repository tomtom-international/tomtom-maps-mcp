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

function setupIncidentEvents(): void {
  if (!trafficIncidentsModule || !map) return;

  trafficIncidentsModule.events.on("click", (feature: any, lngLat: any) => {
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
      .addTo(map!.mapLibreMap);
  });

  trafficIncidentsModule.events.on("hover", () => {
    if (map) map.mapLibreMap.getCanvas().style.cursor = "pointer";
  });
}

// Severity badge colors by magnitude_of_delay
const MAGNITUDE_STYLES: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: "Unknown", color: "#6b7280", bg: "#f3f4f6" },
  1: { label: "Minor", color: "#ca8a04", bg: "#fef9c3" },
  2: { label: "Moderate", color: "#ea580c", bg: "#fff7ed" },
  3: { label: "Major", color: "#dc2626", bg: "#fef2f2" },
  4: { label: "Indefinite", color: "#991b1b", bg: "#fef2f2" },
};

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
  const subtitle = descriptions.length > 1 ? descriptions.slice(1).join(" \u00b7 ") : "";

  let html = `<div class="incident-popup">`;

  // Header row: title + severity badge
  html += `<div class="incident-popup-header">`;
  html += `<span class="incident-popup-title">${escapeHtml(title)}</span>`;
  if (magnitudeStyle) {
    html += `<span class="incident-popup-badge" style="color:${magnitudeStyle.color};background:${magnitudeStyle.bg}">${magnitudeStyle.label}</span>`;
  }
  html += `</div>`;

  // Subtitle (secondary descriptions like "Roadworks")
  if (subtitle) {
    html += `<div class="incident-popup-subtitle">${escapeHtml(subtitle)}</div>`;
  }

  // Details row: delay + road info
  const details: string[] = [];
  if (delay > 0) {
    const mins = Math.round(delay / 60);
    details.push(mins > 0 ? `${mins} min delay` : `${delay}s delay`);
  }
  const road = [roadCategory, roadSubcategory].filter(Boolean).join(" \u00b7 ");
  if (road) details.push(road);

  if (details.length > 0) {
    html += `<div class="incident-popup-details">${escapeHtml(details.join(" \u00b7 "))}</div>`;
  }

  html += `</div>`;
  return html;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
