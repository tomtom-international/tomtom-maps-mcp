/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import {
  TomTomMap,
  TrafficFlowModule,
  StandardStyleID,
  standardStyleIDs,
} from "@tomtom-org/maps-sdk/map";

export interface MapControlsOptions {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  showTrafficToggle?: boolean;
  showThemeToggle?: boolean;
  initialTrafficEnabled?: boolean;
  initialTheme?: "light" | "dark";
  /** Pass existing TrafficFlowModule to control instead of creating new one */
  externalTrafficModule?: TrafficFlowModule;
  /** Called after a theme change once the new style has loaded. Use this to re-add custom sources/layers. */
  onThemeChange?: () => void;
}

const DEFAULT_OPTIONS: Required<MapControlsOptions> = {
  position: "top-right",
  showTrafficToggle: true,
  showThemeToggle: true,
  initialTrafficEnabled: false,
  initialTheme: "light",
  externalTrafficModule: undefined as any,
};

// Map theme names to StandardStyleID (correct SDK style names)
const THEME_STYLES: Record<"light" | "dark", StandardStyleID> = {
  light: "standardLight" as StandardStyleID,
  dark: "standardDark" as StandardStyleID,
};

/**
 * Creates map control buttons for theme switching and traffic toggle
 */
export async function createMapControls(
  map: TomTomMap,
  options: MapControlsOptions = {}
): Promise<{
  trafficModule: TrafficFlowModule | null;
  setTheme: (theme: "light" | "dark") => void;
  setTrafficVisible: (visible: boolean) => void;
  destroy: () => void;
}> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let trafficModule: TrafficFlowModule | null = null;
  let currentTheme = opts.initialTheme;
  let trafficEnabled = opts.initialTrafficEnabled;

  // Create container
  const container = document.createElement("div");
  container.className = "map-controls";
  container.setAttribute("data-position", opts.position);

  // Initialize traffic module if needed (use external if provided)
  if (opts.showTrafficToggle) {
    if (options.externalTrafficModule) {
      trafficModule = options.externalTrafficModule;
      // Always start with traffic off by default, regardless of external module's current state
      trafficModule.setVisible(opts.initialTrafficEnabled);
    } else {
      trafficModule = await TrafficFlowModule.get(map, { visible: opts.initialTrafficEnabled });
    }
  }

  // Theme toggle button
  let themeBtn: HTMLButtonElement | null = null;
  if (opts.showThemeToggle) {
    themeBtn = document.createElement("button");
    themeBtn.className = "map-control-btn theme-btn";
    themeBtn.title = "Toggle theme";
    themeBtn.innerHTML = currentTheme === "light" ? getSunIcon() : getMoonIcon();
    themeBtn.addEventListener("click", () => {
      currentTheme = currentTheme === "light" ? "dark" : "light";
      map.setStyle(THEME_STYLES[currentTheme]);
      themeBtn!.innerHTML = currentTheme === "light" ? getSunIcon() : getMoonIcon();
      if (opts.onThemeChange) {
        map.mapLibreMap.once("style.load", () => opts.onThemeChange!());
      }
    });
    container.appendChild(themeBtn);
  }

  // Traffic toggle button
  let trafficBtn: HTMLButtonElement | null = null;
  if (opts.showTrafficToggle && trafficModule) {
    trafficBtn = document.createElement("button");
    trafficBtn.className = `map-control-btn traffic-btn ${trafficEnabled ? "active" : ""}`;
    trafficBtn.title = "Toggle traffic flow";
    trafficBtn.innerHTML = getTrafficIcon();
    trafficBtn.addEventListener("click", () => {
      trafficEnabled = !trafficEnabled;
      trafficModule!.setVisible(trafficEnabled);
      trafficBtn!.classList.toggle("active", trafficEnabled);
    });
    container.appendChild(trafficBtn);
  }

  // Add to map container
  const mapContainer = map.mapLibreMap.getContainer();
  mapContainer.appendChild(container);

  // Add styles
  injectStyles();

  return {
    trafficModule,
    setTheme: (theme: "light" | "dark") => {
      currentTheme = theme;
      map.setStyle(THEME_STYLES[theme]);
      if (themeBtn) {
        themeBtn.innerHTML = theme === "light" ? getSunIcon() : getMoonIcon();
      }
      if (opts.onThemeChange) {
        map.mapLibreMap.once("style.load", () => opts.onThemeChange!());
      }
    },
    setTrafficVisible: (visible: boolean) => {
      trafficEnabled = visible;
      if (trafficModule) {
        trafficModule.setVisible(visible);
      }
      if (trafficBtn) {
        trafficBtn.classList.toggle("active", visible);
      }
    },
    destroy: () => {
      container.remove();
    },
  };
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

    .map-controls[data-position="bottom-right"] {
      bottom: 30px;
      right: 10px;
    }

    .map-controls[data-position="bottom-left"] {
      bottom: 30px;
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
