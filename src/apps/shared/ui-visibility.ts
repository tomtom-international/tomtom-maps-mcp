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
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
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
