/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import "./ui-visibility.css";

/**
 * Utility to check if the UI should be displayed based on the tool response.
 *
 * When show_ui is false, the App should minimize its footprint - showing only
 * a small indicator that data was received but no interactive map visualization.
 * This is useful for intermediate operations (e.g., geocoding as part of routing).
 *
 * @param apiResponse - The parsed API response from the tool
 * @returns true if UI should be displayed, false otherwise
 */
export function shouldShowUI(apiResponse: any): boolean {
  // Default to true if _meta or show_ui is not present
  if (!apiResponse?._meta) return true;
  if (typeof apiResponse._meta.show_ui !== "boolean") return true;
  return apiResponse._meta.show_ui;
}

/**
 * Hides the map container and shows a compact status indicator.
 * Call this when show_ui is false.
 */
export function hideMapUI(): void {
  // Add class to collapse the widget height
  document.documentElement.classList.add("ui-hidden");

  const mapContainer = document.getElementById("sdk-map");
  if (mapContainer) {
    mapContainer.classList.remove("visible");
    mapContainer.style.display = "none";
  }

  // Create compact status indicator if it doesn't exist
  let indicator = document.getElementById("ui-hidden-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "ui-hidden-indicator";
    indicator.innerHTML = `
      <div class="indicator-pill">
        <div class="indicator-icon">
          <svg viewBox="0 0 380 380" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M236.711 284.542L189.998 364.17L143.261 284.542H236.711ZM189.999 15.833C257.226 15.8331 311.915 69.6382 311.915 135.778C311.915 201.918 257.226 255.724 189.999 255.724C122.772 255.724 68.082 201.919 68.082 135.778C68.082 69.6381 122.772 15.833 189.999 15.833ZM189.999 73.0469C154.852 73.0469 126.261 101.176 126.261 135.754C126.261 170.332 154.852 198.461 189.999 198.461C225.146 198.461 253.736 170.332 253.736 135.754C253.736 101.176 225.146 73.047 189.999 73.0469Z" fill="#DF1B12"/>
          </svg>
        </div>
        <span>Data processed</span>
      </div>
    `;
    document.body.appendChild(indicator);
  }
  indicator.style.display = "block";
}

/**
 * Shows a user-friendly error indicator when the tool call fails.
 * The actual error details are already visible to the agent in the tool response
 * for retry decisions — this is purely for the user's UI.
 */
export function showErrorUI(): void {
  // Collapse the widget like hideMapUI
  document.documentElement.classList.add("ui-hidden");

  const mapContainer = document.getElementById("sdk-map");
  if (mapContainer) {
    mapContainer.classList.remove("visible");
    mapContainer.style.display = "none";
  }

  // Hide the data-processed indicator if visible
  const hiddenIndicator = document.getElementById("ui-hidden-indicator");
  if (hiddenIndicator) {
    hiddenIndicator.style.display = "none";
  }

  // Create error indicator if it doesn't exist
  let indicator = document.getElementById("ui-error-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "ui-error-indicator";
    indicator.innerHTML = `
      <div class="indicator-pill">
        <div class="indicator-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="#dc2626" stroke-width="2"/>
            <line x1="12" y1="8" x2="12" y2="13" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="16.5" r="1" fill="#dc2626"/>
          </svg>
        </div>
        <span class="error-message">Something went wrong</span>
      </div>
    `;
    document.body.appendChild(indicator);
  }
  indicator.style.display = "block";
}

/**
 * Shows the map container and hides the minimal indicator.
 * Call this when show_ui is true (default behavior).
 */
export function showMapUI(): void {
  // Remove compact mode class
  document.documentElement.classList.remove("ui-hidden");

  const mapContainer = document.getElementById("sdk-map");
  if (mapContainer) {
    mapContainer.style.display = "block";
    // Use requestAnimationFrame to ensure display:block is applied before adding visible class
    requestAnimationFrame(() => {
      mapContainer.classList.add("visible");
    });
  }

  const indicator = document.getElementById("ui-hidden-indicator");
  if (indicator) {
    indicator.style.display = "none";
  }
}
