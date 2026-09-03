/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import {
  TomTomMap,
  TrafficFlowModule,
  TrafficIncidentsModule,
  StandardStyleID,
} from "@tomtom-org/maps-sdk/map";

interface MapControlsOptions {
  position?: "top-left" | "top-right";
  showTrafficToggle?: boolean;
  showIncidentsToggle?: boolean;
  showThemeToggle?: boolean;
  /** Pass existing TrafficFlowModule to control instead of creating new one */
  externalTrafficModule?: TrafficFlowModule;
  /** Pass existing TrafficIncidentsModule to control instead of creating new one */
  externalIncidentsModule?: TrafficIncidentsModule;
  /** Called after a theme change once the new style has loaded. Use this to re-add custom sources/layers. */
  onThemeChange?: () => void;
}

const THEME_STYLES: Record<"light" | "dark", StandardStyleID> = {
  light: "streetLight",
  dark: "streetDark",
};

/**
 * Adds theme, traffic flow and traffic incidents toggle buttons to the map.
 * Traffic starts hidden and the theme starts light.
 */
export async function createMapControls(
  map: TomTomMap,
  {
    position = "top-right",
    showTrafficToggle = true,
    showIncidentsToggle = false,
    showThemeToggle = true,
    externalTrafficModule,
    externalIncidentsModule,
    onThemeChange,
  }: MapControlsOptions = {}
): Promise<void> {
  // Expose MapLibre map instance for E2E test automation (markers are canvas-rendered, not DOM)
  (window as any).__e2e_ml = map.mapLibreMap;

  const container = document.createElement("div");
  container.className = "map-controls";
  container.setAttribute("data-position", position);

  if (showThemeToggle) {
    let theme: "light" | "dark" = "light";
    const themeBtn = document.createElement("button");
    themeBtn.className = "map-control-btn theme-btn";
    themeBtn.title = "Toggle theme";
    themeBtn.innerHTML = getSunIcon();
    themeBtn.addEventListener("click", () => {
      theme = theme === "light" ? "dark" : "light";
      map.setStyle(THEME_STYLES[theme]);
      themeBtn.innerHTML = theme === "light" ? getSunIcon() : getMoonIcon();
      if (onThemeChange) map.mapLibreMap.once("style.load", () => onThemeChange());
    });
    container.appendChild(themeBtn);
  }

  if (showTrafficToggle) {
    const trafficModule =
      externalTrafficModule ?? (await TrafficFlowModule.get(map, { visible: false }));
    trafficModule.setVisible(false);
    container.appendChild(
      toggleButton("traffic-btn", "Toggle traffic flow", getTrafficIcon(), (visible) =>
        trafficModule.setVisible(visible)
      )
    );
  }

  if (showIncidentsToggle && externalIncidentsModule) {
    const setIncidentsVisible = (visible: boolean) => {
      externalIncidentsModule.setVisible(visible);
      externalIncidentsModule.setIconsVisible(visible);
    };
    setIncidentsVisible(false);
    container.appendChild(
      toggleButton(
        "incidents-btn",
        "Toggle traffic incidents",
        getIncidentsIcon(),
        setIncidentsVisible
      )
    );
  }

  map.mapLibreMap.getContainer().appendChild(container);
  injectStyles();
}

/** A button that starts off and flips `active` and the layer visibility on each click. */
function toggleButton(
  className: string,
  title: string,
  icon: string,
  setVisible: (visible: boolean) => void
): HTMLButtonElement {
  let visible = false;
  const button = document.createElement("button");
  button.className = `map-control-btn ${className}`;
  button.title = title;
  button.innerHTML = icon;
  button.addEventListener("click", () => {
    visible = !visible;
    setVisible(visible);
    button.classList.toggle("active", visible);
  });
  return button;
}

function getSunIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>`;
}

function getMoonIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>`;
}

function getTrafficIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
    <path d="M2 17l10 5 10-5"/>
    <path d="M2 12l10 5 10-5"/>
  </svg>`;
}

function getIncidentsIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`;
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .map-controls {
      position: absolute;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
    }

    .map-controls[data-position="top-right"] {
      top: 10px;
      right: 10px;
    }

    .map-controls[data-position="top-left"] {
      top: 10px;
      left: 10px;
    }

    .map-control-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 8px;
      background: white;
      color: #333;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      transition: all 0.2s ease;
    }

    .map-control-btn:hover {
      background: #f5f5f5;
      transform: scale(1.05);
    }

    .map-control-btn:active {
      transform: scale(0.95);
    }

    .map-control-btn.active {
      background: #2196F3;
      color: white;
    }

    .map-control-btn.active:hover {
      background: #1976D2;
    }

    .map-control-btn svg {
      width: 20px;
      height: 20px;
    }
  `;
  document.head.appendChild(style);
}
