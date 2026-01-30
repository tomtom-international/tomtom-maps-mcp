/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { TomTomMap, PlacesModule } from '@tomtom-org/maps-sdk/map';
import { Popup } from 'maplibre-gl';

let activePopup: Popup | null = null;

/**
 * Sets up click handlers on PlacesModule to show POI popups
 */
export function setupPoiPopups(map: TomTomMap, placesModule: PlacesModule): void {
  // Handle click events on places
  placesModule.events.on('click', (feature: any) => {
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates;

    if (!coords) return;

    // Close any existing popup
    if (activePopup) {
      activePopup.remove();
    }

    // Build popup content
    const html = buildPopupHtml(props);

    // Show popup
    activePopup = new Popup({
      closeButton: true,
      maxWidth: '320px',
      offset: 25,
    })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map.mapLibreMap);
  });

  // Change cursor on hover
  placesModule.events.on('hover', () => {
    map.mapLibreMap.getCanvas().style.cursor = 'pointer';
  });

  placesModule.events.on('hoverEnd', () => {
    map.mapLibreMap.getCanvas().style.cursor = '';
  });
}

/**
 * Builds HTML content for POI popup
 */
function buildPopupHtml(props: any): string {
  const poi = props.poi || {};
  const address = props.address || {};

  const name = poi.name || address.freeformAddress || 'Unknown Location';
  const categories = poi.categories?.join(', ') || poi.categorySet?.[0]?.name || '';
  const phone = poi.phone || '';
  const url = poi.url || '';
  const streetAddress = address.streetName
    ? `${address.streetNumber || ''} ${address.streetName}`.trim()
    : '';
  const cityLine = [address.municipality, address.postalCode, address.countrySubdivision]
    .filter(Boolean)
    .join(', ');

  let html = `<div class="poi-popup">`;

  // Name
  html += `<h3 class="poi-name">${escapeHtml(name)}</h3>`;

  // Categories
  if (categories) {
    html += `<div class="poi-categories">${escapeHtml(categories)}</div>`;
  }

  // Address
  if (streetAddress || cityLine) {
    html += `<div class="poi-address">`;
    if (streetAddress) html += `<div>${escapeHtml(streetAddress)}</div>`;
    if (cityLine) html += `<div>${escapeHtml(cityLine)}</div>`;
    html += `</div>`;
  }

  // Phone
  if (phone) {
    html += `<div class="poi-phone"><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></div>`;
  }

  // Website
  if (url) {
    const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    html += `<div class="poi-url"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(displayUrl)}</a></div>`;
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
 * Closes any active popup
 */
export function closePoiPopup(): void {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}
