/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import {
  TomTomMap,
  TrafficFlowModule,
  TrafficIncidentsModule,
  type TrafficIncidentsModuleFeature,
} from "@tomtom-org/maps-sdk/map";
import type { Geometry } from "geojson";
import { Popup } from "maplibre-gl";
import { trackAppData } from "../../shared/appData";
import { buildIncidentPopupHtml } from "../../shared/incident-popup";
import { createMapControls } from "../../shared/map-controls";
import { injectPoiPopupStyles } from "../../shared/poi-popup";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { hideMapUI, shouldShowUI, showErrorUI, showMapUI } from "../../shared/ui-visibility";
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
let framedFromInput = false;
let mapReady: Promise<void> | null = null;

const app = new App({ name: "TomTom Traffic Incidents", version: "1.0.0" });
const appData = trackAppData(app, { tool: "tomtom-get-traffic" });

async function initializeMap(): Promise<void> {
  if (mapInitialized) return;

  await ensureTomTomConfigured(app);
  injectPoiPopupStyles();

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  // SDK traffic modules — render live data from vector tiles
  trafficFlowModule = await TrafficFlowModule.get(map, { visible: true });
  trafficIncidentsModule = await TrafficIncidentsModule.get(map, {
    visible: true,
    icons: { visible: true },
  });

  setupIncidentEvents();

  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
    externalTrafficModule: trafficFlowModule,
  });

  mapInitialized = true;

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
  feature: TrafficIncidentsModuleFeature,
  lngLat: [number, number]
): void {
  if (!map) return;

  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  const html = buildIncidentPopupHtml(feature.properties);

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
}

/** Where to open an incident's popup: its point, or the middle vertex of its line. */
function anchorOf(geometry: Geometry): [number, number] | undefined {
  if (geometry.type === "Point") return [geometry.coordinates[0], geometry.coordinates[1]];
  if (geometry.type === "LineString" && geometry.coordinates.length > 0) {
    const mid = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
    return [mid[0], mid[1]];
  }
  return undefined;
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
    if (autoPopupShown || !trafficIncidentsModule) return;

    // A random incident with a description, once its tiles have rendered
    const withDesc = trafficIncidentsModule
      .getRenderedFeatures()
      .trafficIncidents.filter((f) => f.properties.description);
    const feat = withDesc[Math.floor(Math.random() * withDesc.length)];
    const lngLat = feat && anchorOf(feat.geometry);
    if (!lngLat) {
      if (retries++ < 5) gl.once("idle", tryOpen);
      return;
    }

    autoPopupShown = true;
    showPopupForFeature(feat, lngLat);
  };

  // The flyTo animation takes ~2.5s, then tiles need to load.
  gl.once("idle", tryOpen);
}

function flyToBbox(bbox: number[] | string): void {
  if (!map) return;

  const parts = Array.isArray(bbox) ? bbox : bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
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
    easing: (t: number) => 1 - (1 - t) ** 3, // ease-out-cubic
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
  const where = args.where as
    | { boundingBox?: number[]; queries?: unknown; geometries?: unknown }
    | undefined;
  // `within` unions all its fields, and `queries`, `geometries` and `nearby` resolve on
  // the server, so only a lone `boundingBox` frames from the input; the rest from the result.
  const bbox = where?.queries || where?.geometries ? undefined : where?.boundingBox;
  const showUI = args.show_ui !== false;

  if (!showUI) return;

  framedFromInput = !!bbox;
  try {
    showMapUI();
    mapReady = initializeMap();
    await mapReady;

    if (bbox) flyToBbox(bbox);

    createLiveTrafficTimer();
    if (framedFromInput) {
      autoOpenFirstIncident();
      appData.drawn("input");
    }
  } catch (error) {
    console.error("Error showing live traffic:", error);
    showErrorUI();
    appData.failed(error);
  }
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

    // SDK modules are already rendering live traffic; only the camera may be left.
    if (!framedFromInput) {
      const { bbox } = await appData.load<{ bbox?: number[] }>(r, agentResponse);
      // The host sends the result right behind the input, before the map exists. A map
      // that failed to start was already reported by `ontoolinput`.
      const mapStarted = await mapReady?.then(
        () => true,
        () => false
      );
      if (mapStarted === false) return;
      if (bbox) {
        flyToBbox(bbox);
        autoOpenFirstIncident();
      }
      appData.drawn();
    }
  } catch (e) {
    console.error("Error processing traffic result:", e);
    appData.failed(e);
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
