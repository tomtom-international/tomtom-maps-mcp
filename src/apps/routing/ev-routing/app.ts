/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * EV Routing App
 * Displays EV routes with charging stops on an interactive map.
 * Data comes from SDK (already in GeoJSON Routes format) — no parseRoutingResponse() needed.
 * Charging stops are rendered as custom interactive markers with popups.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, RoutingModule } from "@tomtom-org/maps-sdk/map";
import { Popup } from "maplibre-gl";
import { createMapControls } from "../../shared/map-controls";
import { injectPoiPopupStyles, escapeHtml } from "../../shared/poi-popup";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

let map: TomTomMap | null = null;
let routingModule: RoutingModule | null = null;
let mapReady = false;
let pendingData: any = null;
let chargingPopup: Popup | null = null;

const CHARGING_SOURCE = "ev-charging-stops";
const CHARGING_CIRCLE_LAYER = "ev-charging-circles";
const CHARGING_NUMBER_LAYER = "ev-charging-numbers";
const CHARGING_LABEL_LAYER = "ev-charging-labels";

const app = new App({ name: "TomTom EV Route Planner", version: "1.0.0" });

async function initializeMap() {
  if (map) return;

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [-0.5, 51.5], zoom: 6 },
  });

  routingModule = await RoutingModule.get(map);

  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  return new Promise<void>((resolve) => {
    const onReady = () => {
      mapReady = true;
      if (pendingData) {
        processRouteData(pendingData);
        pendingData = null;
      }
      resolve();
    };

    if (map!.mapLibreMap.loaded()) {
      onReady();
    } else {
      map!.mapLibreMap.on("load", onReady);
    }
  });
}

/**
 * Extract only start/end waypoints for RoutingModule display.
 * Charging stops are rendered separately with custom markers.
 */
function extractStartEndWaypoints(routes: any) {
  if (!routes.features?.length) {
    return { type: "FeatureCollection" as const, features: [] };
  }

  const route = routes.features[0];
  const coordinates = route.geometry.coordinates as [number, number][];

  if (coordinates.length < 2) {
    return { type: "FeatureCollection" as const, features: [] };
  }

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coordinates[0] },
        properties: {
          type: "Geography",
          address: { freeformAddress: "Start" },
          index: 0,
          indexType: "start",
        },
      },
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coordinates[coordinates.length - 1] },
        properties: {
          type: "Geography",
          address: { freeformAddress: "End" },
          index: 1,
          indexType: "finish",
        },
      },
    ],
  };
}

/**
 * Extract charging stop features from route leg sections.
 * Each charging stop has position, name, power, charge time for markers/popups.
 */
function extractChargingStops(routes: any) {
  const features: any[] = [];
  if (!routes.features?.length) return { type: "FeatureCollection", features };

  const route = routes.features[0];
  const legs = route.properties?.sections?.leg || [];

  for (let i = 0; i < legs.length; i++) {
    const ci = legs[i].summary?.chargingInformationAtEndOfLeg;
    if (!ci?.geometry) continue;

    const p = ci.properties || {};
    const powerKW = p.chargingParkPowerInkW;
    const chargeTimeSec = p.chargingTimeInSeconds;
    const chargeTimeMin = chargeTimeSec ? Math.round(chargeTimeSec / 60) : null;
    const address = typeof p.address === "string" ? p.address : p.address?.freeformAddress || "";

    features.push({
      type: "Feature",
      geometry: ci.geometry,
      properties: {
        stopIndex: i + 1,
        name: p.chargingParkName || `Charging Stop ${i + 1}`,
        powerKW: powerKW || null,
        chargeTimeMin,
        targetChargeKWh: p.targetChargeInkWh ? Math.round(p.targetChargeInkWh * 10) / 10 : null,
        address,
        label: [
          p.chargingParkName || `Stop ${i + 1}`,
          [powerKW ? `${powerKW} kW` : null, chargeTimeMin ? `${chargeTimeMin} min` : null]
            .filter(Boolean)
            .join(" \u00b7 "),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Add GeoJSON source and layers for charging stop markers.
 * Creates circle markers with stop numbers, text labels, and click-to-popup.
 */
function addChargingStopLayers() {
  if (!map) return;
  const mlMap = map.mapLibreMap;

  if (mlMap.getSource(CHARGING_SOURCE)) return;

  mlMap.addSource(CHARGING_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  mlMap.addLayer({
    id: CHARGING_CIRCLE_LAYER,
    type: "circle",
    source: CHARGING_SOURCE,
    paint: {
      "circle-radius": 14,
      "circle-color": "#1a73e8",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });

  mlMap.addLayer({
    id: CHARGING_NUMBER_LAYER,
    type: "symbol",
    source: CHARGING_SOURCE,
    layout: {
      "text-field": ["to-string", ["get", "stopIndex"]],
      "text-size": 13,
      "text-font": ["Noto Sans Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  mlMap.addLayer({
    id: CHARGING_LABEL_LAYER,
    type: "symbol",
    source: CHARGING_SOURCE,
    layout: {
      "text-field": ["get", "label"],
      "text-size": 12,
      "text-font": ["Noto Sans SemiBold"],
      "text-anchor": "left",
      "text-offset": [1.8, 0],
      "text-max-width": 15,
      "text-justify": "left",
    },
    paint: {
      "text-color": "#1a1a1a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });

  injectPoiPopupStyles();

  mlMap.on("click", CHARGING_CIRCLE_LAYER, (e: any) => {
    if (!e.features?.length) return;
    const feature = e.features[0];
    const coords = feature.geometry.coordinates.slice();

    if (chargingPopup) chargingPopup.remove();

    chargingPopup = new Popup({
      closeButton: true,
      maxWidth: "380px",
      className: "poi-popup-container",
      offset: [0, -18],
    })
      .setLngLat(coords as [number, number])
      .setHTML(buildChargingPopupHtml(feature.properties))
      .addTo(mlMap);
  });

  mlMap.on("mouseenter", CHARGING_CIRCLE_LAYER, () => {
    mlMap.getCanvas().style.cursor = "pointer";
  });
  mlMap.on("mouseleave", CHARGING_CIRCLE_LAYER, () => {
    mlMap.getCanvas().style.cursor = "";
  });
}

function buildChargingPopupHtml(props: any): string {
  const name = escapeHtml(props.name || "Charging Stop");
  const powerKW = props.powerKW;
  const chargeTimeMin = props.chargeTimeMin;
  const targetChargeKWh = props.targetChargeKWh;
  const address = props.address ? escapeHtml(props.address) : "";

  // Build detail summary line: "150 kW · 17 min"
  const detailParts = [
    powerKW ? `${powerKW} kW` : null,
    chargeTimeMin ? `${chargeTimeMin} min` : null,
    targetChargeKWh ? `${targetChargeKWh} kWh target` : null,
  ].filter(Boolean);

  let html = `<div class="poi-popup">`;
  html += `<div class="poi-category">Charging Stop ${props.stopIndex}</div>`;
  html += `<h3 class="poi-name">${name}</h3>`;
  if (address) html += `<div class="poi-address">${address}</div>`;
  if (detailParts.length) html += `<div class="poi-address" style="margin-top:6px;font-weight:500;color:#1a1a1a">${detailParts.join(" &middot; ")}</div>`;
  html += `</div>`;
  return html;
}

function processRouteData(routes: any) {
  if (!routingModule || !map) return;

  if (!routes.features?.length) {
    clear();
    return;
  }

  // Show route line via RoutingModule
  routingModule.showRoutes(routes);

  // Show only start/end waypoints — charging stops get custom markers
  const waypoints = extractStartEndWaypoints(routes);
  routingModule.showWaypoints(waypoints as any);

  // Add interactive charging stop markers with labels and popups
  addChargingStopLayers();
  const chargingStops = extractChargingStops(routes);
  const source = map.mapLibreMap.getSource(CHARGING_SOURCE) as any;
  if (source) source.setData(chargingStops);

  const bbox = bboxFromGeoJSON(routes);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
      padding: 80,
      maxZoom: 15,
    });
  }
}

async function clear() {
  if (chargingPopup) {
    chargingPopup.remove();
    chargingPopup = null;
  }
  if (map) {
    const source = map.mapLibreMap.getSource(CHARGING_SOURCE) as any;
    if (source) source.setData({ type: "FeatureCollection", features: [] });
  }
  if (!routingModule) return;
  await routingModule.clearRoutes();
  await routingModule.clearWaypoints();
}

async function displayRoute(data: any) {
  if (!mapReady || !routingModule) {
    pendingData = data;
    return;
  }
  processRouteData(data);
}

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }
  try {
    if (r.content[0].type !== "text") return;
    const agentResponse = JSON.parse(r.content[0].text);
    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }
    showMapUI();
    await initializeMap();
    displayRoute(await extractFullData(app, agentResponse));
  } catch (e) {
    console.error("Error displaying EV route:", e);
  }
};

app.onteardown = async () => {
  await clear();
  return {};
};

app.connect();
