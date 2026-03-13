/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type Place } from "@tomtom-org/maps-sdk/core";
import {
  TomTomMap,
  PlacesModule,
  GeometriesModule,
  reachableRangeGeometryConfig,
  colorPaletteIDs,
  geometryThemes,
  standardStyleIDs,
  type ColorPaletteOptions,
  type GeometryTheme,
  type GeometryBeforeLayerConfig,
  type StandardStyleID,
} from "@tomtom-org/maps-sdk/map";
import { type BudgetType } from "@tomtom-org/maps-sdk/services";
import { createMapControls } from "../../shared/map-controls";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

// ── Budget config (matches SDK example controls.ts) ──
const BUDGET_UNITS: Record<string, string> = {
  timeMinutes: "min",
  distanceKM: "km",
  remainingChargeCPT: "% remaining",
  spentChargePCT: "% spent",
  spentFuelLiters: "L",
};

const BUDGET_TYPE_LABELS: Record<string, string> = {
  timeMinutes: "Time (min)",
  distanceKM: "Distance (km)",
  remainingChargeCPT: "EV — remaining charge (%)",
  spentChargePCT: "EV — charge spent (%)",
  spentFuelLiters: "Fuel spent (L)",
};

const BEFORE_LAYER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "top", label: "Top" },
  { value: "country", label: "Below countries" },
  { value: "lowestPlaceLabel", label: "Below place labels" },
  { value: "poi", label: "Below Map POIs" },
  { value: "lowestLabel", label: "Below all labels" },
  { value: "lowestRoadLine", label: "Below roads" },
  { value: "lowestBuilding", label: "Below buildings" },
];

// ── Types ──
interface RangeFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

interface RangeFeatureCollection {
  type: "FeatureCollection";
  features: RangeFeature[];
  bbox?: number[];
}

// ── State ──
let map: TomTomMap | null = null;
let placesModule: PlacesModule | null = null;
let geometriesModule: GeometriesModule | null = null;
let isReady = false;
let pendingData: RangeFeatureCollection | null = null;

// Visual options
let currentPalette: ColorPaletteOptions = "fadedRainbow";
let currentTheme: GeometryTheme = "inverted";
let currentBeforeLayer: GeometryBeforeLayerConfig = "lowestLabel";

// Data: all features from server, and the currently displayed max budget
let allFeatures: RangeFeature[] = [];
let budgetType: BudgetType = "timeMinutes";
let budgetSteps: number[] = []; // sorted descending (largest first)
let currentMaxBudget = 0;

const app = new App({ name: "TomTom Reachable Range", version: "1.0.0" });

// ── Helpers ──

function addOption(select: HTMLSelectElement, label: string, value: string, selected = false) {
  select.add(new Option(label, value, selected, selected));
}

function prettifyId(id: string): string {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Extract budget info from a feature's properties (SDK stores input params there) */
function extractBudgetInfo(features: RangeFeature[]): { type: BudgetType; steps: number[] } {
  const steps: number[] = [];
  let type: BudgetType = "timeMinutes";

  for (const f of features) {
    const props = f.properties;
    const budget = props?.budget as { type?: string; value?: number } | undefined;
    if (budget?.type) type = budget.type as BudgetType;
    if (budget?.value !== undefined) steps.push(budget.value);
  }

  // Sort descending (largest ring first)
  steps.sort((a, b) => b - a);
  return { type, steps: [...new Set(steps)] };
}

/** Get features up to the selected max budget value */
function getFeaturesForBudget(maxValue: number): RangeFeature[] {
  return allFeatures.filter((f) => {
    const budget = (f.properties?.budget as { value?: number })?.value;
    return budget !== undefined && budget <= maxValue;
  });
}

/** Build FeatureCollection for GeometriesModule.show() */
function buildFC(features: RangeFeature[]): Parameters<GeometriesModule["show"]>[0] {
  return {
    type: "FeatureCollection" as const,
    features,
  } as Parameters<GeometriesModule["show"]>[0];
}

// ── Display ──

function showRanges(fitBounds = true) {
  if (!map || !geometriesModule) return;

  const features = getFeaturesForBudget(currentMaxBudget);
  if (features.length === 0) return;

  const fc = buildFC(features);
  void geometriesModule.show(fc);

  // Show origin pin from first feature
  showOriginPin(features[0]);

  if (fitBounds) {
    // Fit to the largest polygon (first feature, since sorted desc)
    const bbox = bboxFromGeoJSON(features[0] as Parameters<typeof bboxFromGeoJSON>[0]);
    if (bbox) {
      map.mapLibreMap.fitBounds(bbox, { padding: 50 });
    }
  }
}

function showOriginPin(feature: RangeFeature) {
  if (!placesModule) return;
  const origin = feature.properties?.origin as
    | [number, number]
    | { lon?: number; lng?: number; lat: number }
    | undefined;
  if (!origin) return;

  const coords: [number, number] = Array.isArray(origin)
    ? [origin[0], origin[1]]
    : [(origin.lon ?? origin.lng) as number, origin.lat];

  void placesModule.show([
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: {},
    } as unknown as Place,
  ]);
}

function refreshDisplay() {
  if (!geometriesModule) return;
  geometriesModule.applyConfig(
    reachableRangeGeometryConfig(currentPalette, currentTheme, currentBeforeLayer)
  );
  showRanges(false);
}

// ── Controls ──

function initControls() {
  const panel = document.getElementById("range-options");
  const toggle = document.getElementById("range-options-toggle");
  const body = document.getElementById("range-options-body");

  // Collapsible header
  if (toggle && body) {
    toggle.addEventListener("click", () => {
      const collapsed = body.style.display === "none";
      body.style.display = collapsed ? "" : "none";
      toggle.classList.toggle("collapsed", !collapsed);
    });
  }
  if (panel) panel.style.display = "";

  // Map Style
  const styleSelect = document.getElementById("opt-style") as HTMLSelectElement | null;
  if (styleSelect && map) {
    const m = map;
    standardStyleIDs.forEach((id) => addOption(styleSelect, id, id, id === "standardLight"));
    styleSelect.addEventListener("change", () => m.setStyle(styleSelect.value as StandardStyleID));
  }

  // Color Palette
  const paletteSelect = document.getElementById("opt-palette") as HTMLSelectElement | null;
  if (paletteSelect) {
    colorPaletteIDs.forEach((id) =>
      addOption(paletteSelect, prettifyId(id), id, id === currentPalette)
    );
    paletteSelect.addEventListener("change", () => {
      currentPalette = paletteSelect.value as ColorPaletteOptions;
      refreshDisplay();
    });
  }

  // Layer Position
  const layerSelect = document.getElementById("opt-layer") as HTMLSelectElement | null;
  if (layerSelect) {
    BEFORE_LAYER_OPTIONS.forEach(({ value, label }) =>
      addOption(layerSelect, label, value, value === (currentBeforeLayer as string))
    );
    layerSelect.addEventListener("change", () => {
      currentBeforeLayer = layerSelect.value as GeometryBeforeLayerConfig;
      if (geometriesModule) geometriesModule.moveBeforeLayer(currentBeforeLayer);
    });
  }

  // Theme
  const themeSelect = document.getElementById("opt-theme") as HTMLSelectElement | null;
  if (themeSelect) {
    geometryThemes.forEach((id) =>
      addOption(themeSelect, id.charAt(0).toUpperCase() + id.slice(1), id, id === currentTheme)
    );
    themeSelect.addEventListener("change", () => {
      currentTheme = themeSelect.value as GeometryTheme;
      refreshDisplay();
    });
  }

  // Budget Type (read-only, shows what the server used)
  const budgetTypeSelect = document.getElementById("opt-budget-type") as HTMLSelectElement | null;
  if (budgetTypeSelect) {
    Object.entries(BUDGET_TYPE_LABELS).forEach(([value, label]) =>
      addOption(budgetTypeSelect, label, value, value === budgetType)
    );
    budgetTypeSelect.disabled = true; // Read-only: determined by server request
  }

  // Max Budget (interactive: filters which rings to show)
  populateMaxBudgetDropdown();
}

function populateMaxBudgetDropdown() {
  const maxBudgetSelect = document.getElementById("opt-max-budget") as HTMLSelectElement | null;
  if (!maxBudgetSelect) return;

  maxBudgetSelect.innerHTML = "";
  const unit = BUDGET_UNITS[budgetType] || "";

  budgetSteps.forEach((step) =>
    addOption(maxBudgetSelect, `Up to ${step} ${unit}`, String(step), step === currentMaxBudget)
  );

  maxBudgetSelect.addEventListener("change", () => {
    currentMaxBudget = Number(maxBudgetSelect.value);
    showRanges(true);
  });
}

// ── Map init ──

async function initializeMap() {
  if (map) return;

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  placesModule = await PlacesModule.get(map, {
    text: { title: () => "Center" },
    theme: "pin",
  });

  geometriesModule = await GeometriesModule.get(
    map,
    reachableRangeGeometryConfig(currentPalette, currentTheme, currentBeforeLayer)
  );

  // Theme/traffic toggle on the left (options panel is on the right)
  await createMapControls(map, {
    position: "top-left",
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  initControls();

  isReady = true;
  if (pendingData) {
    processData(pendingData);
    pendingData = null;
  }
}

// ── Data processing ──

function processData(fc: RangeFeatureCollection) {
  if (!map || !geometriesModule) return;

  if (!fc?.features?.length) {
    void clear();
    return;
  }

  // Store all features and extract budget info
  allFeatures = fc.features;
  const info = extractBudgetInfo(allFeatures);
  budgetType = info.type;
  budgetSteps = info.steps;
  // Default to the originally requested budget value (1x step), fall back to largest
  const requested = (fc as unknown as Record<string, unknown>).requestedBudgetValue as number | undefined;
  currentMaxBudget = (requested && budgetSteps.includes(requested)) ? requested : budgetSteps[0] || 0;

  // Update the budget type display
  const budgetTypeSelect = document.getElementById("opt-budget-type") as HTMLSelectElement | null;
  if (budgetTypeSelect) budgetTypeSelect.value = budgetType;

  // Populate max budget dropdown with the generated steps
  populateMaxBudgetDropdown();

  // Show all ranges
  showRanges(true);
}

async function displayRange(apiResponse: RangeFeatureCollection) {
  if (!isReady) {
    pendingData = apiResponse;
    return;
  }
  processData(apiResponse);
}

async function clear() {
  if (!map) return;
  allFeatures = [];
  if (geometriesModule) await geometriesModule.clear();
  if (placesModule) await placesModule.clear();
}

// ── MCP lifecycle ──

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }
  try {
    if (r.content[0].type === "text") {
      const apiResponse = JSON.parse(r.content[0].text) as unknown;
      if (!shouldShowUI(apiResponse)) {
        hideMapUI();
        return;
      }
      showMapUI();
      await initializeMap();
      console.log("[ReachableRange] Extracting full data...");
      const fullData = await extractFullData(app, apiResponse);
      console.log("[ReachableRange] Full data extracted, features:", (fullData as RangeFeatureCollection)?.features?.length ?? 0);

      // Validate that full data has polygon coordinates (not trimmed fallback)
      const fc = fullData as RangeFeatureCollection;
      if (fc?.features?.length) {
        const firstGeom = fc.features[0]?.geometry as { coordinates?: unknown } | undefined;
        if (!firstGeom?.coordinates) {
          console.warn("[ReachableRange] Full data missing coordinates — viz cache fetch likely failed, using bbox fallback");
        }
      }

      await displayRange(fc);
    }
  } catch (e) {
    console.error("[ReachableRange] Error in ontoolresult:", e);
    showErrorUI();
  }
};

app.onteardown = async () => {
  await clear();
  return {};
};

app.connect();
