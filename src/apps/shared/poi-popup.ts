/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { TomTomMap, PlacesModule } from "@tomtom-org/maps-sdk/map";
import { type LngLatLike, type PropertyValueSpecification, Popup } from "maplibre-gl";

let activePopup: Popup | null = null;
let hidePaintApplied = false;

const POI_POPUP_STYLES = `
  .poi-popup-container {
    filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.13)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08));
  }
  .poi-popup-container .maplibregl-popup-content {
    padding: 0;
    border-radius: 20px;
    box-shadow: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .poi-popup-container .maplibregl-popup-tip {
    z-index: 1;
  }
  .poi-popup-container.maplibregl-popup-anchor-bottom .maplibregl-popup-tip {
    margin-top: -1px;
  }
  .poi-popup-container.maplibregl-popup-anchor-top .maplibregl-popup-tip {
    margin-bottom: -1px;
  }
  .poi-popup-container.maplibregl-popup-anchor-left .maplibregl-popup-tip {
    margin-right: -1px;
  }
  .poi-popup-container.maplibregl-popup-anchor-right .maplibregl-popup-tip {
    margin-left: -1px;
  }
  .poi-popup-container .maplibregl-popup-close-button {
    position: absolute;
    top: 8px;
    right: 16px;
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #1a1a1a;
    font-weight: 300;
    line-height: 1;
    padding: 4px;
  }
  .poi-popup-container .maplibregl-popup-close-button:hover {
    background-color: transparent;
    color: #666;
  }
  .poi-popup {
    padding: 12px 20px 16px;
    min-width: 320px;
  }
  .poi-category {
    font-size: 13px;
    font-weight: 500;
    color: #504f4f;
    margin-bottom: 10px;
    letter-spacing: 0.2px;
  }
  .poi-name {
    font-size: 24px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0 0 8px 0;
    letter-spacing: -0.3px;
  }
  .poi-address {
    font-size: 15px;
    color: #6b6b6b;
    font-weight: 400;
  }
`;

let stylesInjected = false;

export function injectPoiPopupStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = POI_POPUP_STYLES;
  document.head.appendChild(style);
}

/**
 * Sets up click handlers on PlacesModule to show POI popups
 */
export function setupPoiPopups(map: TomTomMap, placesModule: PlacesModule): void {
  injectPoiPopupStyles();

  const { sourceID, layerIDs } = placesModule.sourceAndLayerIDs.places;

  placesModule.events.on("click", (feature) => {
    const props = (feature.properties || {}) as Record<string, unknown>;
    const coords = feature.geometry?.coordinates;

    if (!coords) return;

    // Close any existing popup
    if (activePopup) {
      activePopup.remove();
    }

    // Apply hide paint expressions once
    if (!hidePaintApplied) {
      hidePaintApplied = true;
      const expr: PropertyValueSpecification<number> = [
        "case",
        ["boolean", ["feature-state", "hidden"], false],
        0,
        1,
      ];
      for (const layerId of layerIDs) {
        map.mapLibreMap.setPaintProperty(layerId, "icon-opacity", expr);
        map.mapLibreMap.setPaintProperty(layerId, "text-opacity", expr);
      }
    }

    // Hide the clicked marker
    const featureId = props.id as string | number | undefined;
    if (featureId) {
      map.mapLibreMap.setFeatureState({ source: sourceID, id: featureId }, { hidden: true });
    }

    // Build and show popup
    const html = buildPopupHtml(props);

    activePopup = new Popup({
      closeButton: true,
      maxWidth: "380px",
      className: "poi-popup-container",
      offset: [0, 2],
    })
      .setLngLat(coords as LngLatLike)
      .setHTML(html)
      .addTo(map.mapLibreMap);

    // Show marker again on popup close
    activePopup.on("close", () => {
      if (featureId) {
        map.mapLibreMap.removeFeatureState({ source: sourceID, id: featureId }, "hidden");
      }
      activePopup = null;
    });
  });

  // Change cursor on hover
  placesModule.events.on("hover", () => {
    map.mapLibreMap.getCanvas().style.cursor = "pointer";
  });

  (placesModule.events as { on: (event: string, callback: () => void) => void }).on(
    "hoverEnd",
    () => {
      map.mapLibreMap.getCanvas().style.cursor = "";
    }
  );
}

/**
 * Builds HTML content for POI popup
 */
function buildPopupHtml(props: Record<string, unknown>): string {
  const poi = (props.poi as Record<string, unknown>) || {};
  const address = (props.address as Record<string, unknown>) || {};

  const name =
    (poi.name as string | undefined) ||
    (address.freeformAddress as string | undefined) ||
    "Unknown Location";
  const categoriesArr = poi.categories as string[] | undefined;
  const categorySetArr = poi.categorySet as Array<{ name?: string }> | undefined;
  const categories = categoriesArr?.join(", ") || categorySetArr?.[0]?.name || "";
  const streetName = address.streetName as string | undefined;
  const streetNumber = address.streetNumber as string | number | undefined;
  const streetAddress = streetName ? `${streetNumber || ""} ${streetName}`.trim() : "";
  const cityLine = [
    address.municipality as string | undefined,
    address.postalCode as string | undefined,
    address.countrySubdivision as string | undefined,
  ]
    .filter(Boolean)
    .join(", ");

  let html = `<div class="poi-popup">`;

  // Category
  if (categories) {
    html += `<div class="poi-category">${escapeHtml(categories)}</div>`;
  }

  // Name
  html += `<h3 class="poi-name">${escapeHtml(name)}</h3>`;

  // Address
  if (streetAddress || cityLine) {
    html += `<div class="poi-address">`;
    if (streetAddress) html += `<div>${escapeHtml(streetAddress)}</div>`;
    if (cityLine) html += `<div>${escapeHtml(cityLine)}</div>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Closes any active popup
 */
export function closePoiPopup(): void {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}
