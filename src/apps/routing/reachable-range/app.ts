/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type Place } from "@tomtom-org/maps-sdk/core";
import {
  type ColorPaletteOptions,
  colorPaletteIDs,
  GeometriesModule,
  type GeometryBeforeLayerConfig,
  type GeometryTheme,
  geometryThemes,
  PlacesModule,
  reachableRangeGeometryConfig,
  type StandardStyleID,
  standardStyleIDs,
  TomTomMap,
} from "@tomtom-org/maps-sdk/map";
import type { BudgetType, ReachableRangeBudget } from "@tomtom-org/maps-sdk/services";
import type { FindReachableAreasParams } from "../../../schemas/routing/planRouteSchema";
import { extractFullData } from "../../shared/decompress";
import { createMapControls } from "../../shared/map-controls";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { hideMapUI, shouldShowUI, showErrorUI, showMapUI } from "../../shared/ui-visibility";
import { type BudgetStep, budgetSteps, roundBudget } from "./budgetSteps";
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

// Data: the tool call's arguments, the budgets the user can switch to, and the
// ranges fetched so far keyed by their budget value (one per origin)
let toolArgs: Partial<FindReachableAreasParams> = {};
let budgetType: BudgetType = "timeMinutes";
let requestedBudget = 0; // in the budget type's unit, e.g. 30 (minutes)
let steps: BudgetStep[] = [];
let ranges = new Map<number, RangeFeature[]>();
let currentStep: BudgetStep | undefined;
// Bumped by every switch and every new result, so a fetch that resolves late is dropped
let switchRequest = 0;
let shownFeatures: RangeFeature[] = [];

const app = new App({ name: "TomTom Reachable Range", version: "1.0.0" });

// ── Helpers ──

function addOption(select: HTMLSelectElement, label: string, value: string, selected = false) {
  select.add(new Option(label, value, selected, selected));
}

function prettifyId(id: string): string {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Build FeatureCollection for GeometriesModule.show() */
function buildFC(features: RangeFeature[]): Parameters<GeometriesModule["show"]>[0] {
  return {
    type: "FeatureCollection" as const,
    features,
  } as Parameters<GeometriesModule["show"]>[0];
}

// ── Display ──

function showRanges(features: RangeFeature[], fitBounds = true) {
  if (!map || !geometriesModule) return;

  shownFeatures = features;
  const fc = buildFC(features);
  void geometriesModule.show(fc);
  showOriginPins(features);

  if (fitBounds) {
    const bbox = bboxFromGeoJSON(fc);
    if (bbox) {
      map.mapLibreMap.fitBounds(bbox, { padding: 50 });
    }
  }
}

function originOf(feature: RangeFeature): [number, number] | undefined {
  const origin = feature.properties?.origin as
    | [number, number]
    | { lon?: number; lng?: number; lat: number }
    | undefined;
  if (!origin) return undefined;
  return Array.isArray(origin)
    ? [origin[0], origin[1]]
    : [(origin.lon ?? origin.lng) as number, origin.lat];
}

/** One pin per origin: every budget's ring around an origin shares its pin. */
function showOriginPins(features: RangeFeature[]) {
  if (!placesModule) return;
  const origins = new Map<string, [number, number]>();
  for (const feature of features) {
    const coords = originOf(feature);
    if (coords) origins.set(coords.join(","), coords);
  }

  void placesModule.show(
    [...origins.values()].map(
      (coords) =>
        ({
          type: "Feature",
          geometry: { type: "Point", coordinates: coords },
          properties: {},
        }) as unknown as Place
    )
  );
}

function refreshDisplay() {
  if (!geometriesModule) return;
  geometriesModule.applyConfig(
    reachableRangeGeometryConfig(currentPalette, currentTheme, currentBeforeLayer)
  );
  if (shownFeatures.length) showRanges(shownFeatures, false);
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

  // Range (interactive: switches to another budget, fetched on first use)
  const rangeSelect = document.getElementById("opt-range") as HTMLSelectElement | null;
  if (rangeSelect) {
    rangeSelect.addEventListener("change", () => {
      const step = steps.find((s) => String(s.budget.value) === rangeSelect.value);
      if (step) void switchToStep(step, rangeSelect);
    });
  }
  populateRangeSelect();
}

function populateRangeSelect() {
  const rangeSelect = document.getElementById("opt-range") as HTMLSelectElement | null;
  if (!rangeSelect) return;

  rangeSelect.innerHTML = "";
  const unit = BUDGET_UNITS[budgetType] || "";
  steps.forEach((step) => {
    const value = roundBudget(requestedBudget * step.multiplier, false);
    const label = `${value} ${unit}${step.multiplier === 1 ? " (requested)" : ""}`;
    addOption(rangeSelect, label, String(step.budget.value), step === currentStep);
  });

  // New options replace whatever switch was loading
  setStatus("idle", rangeSelect);

  // Without the call's arguments, or with rings the call chose itself, there is
  // nothing to switch to.
  const field = rangeSelect.closest("label") as HTMLElement | null;
  if (field) field.style.display = steps.length > 1 ? "" : "none";
}

function setStatus(status: "loading" | "failed" | "idle", rangeSelect: HTMLSelectElement) {
  rangeSelect.disabled = status === "loading";
  const spinner = document.getElementById("range-status");
  if (spinner) spinner.style.display = status === "loading" ? "" : "none";
  const error = document.getElementById("range-error");
  if (error) error.style.display = status === "failed" ? "" : "none";
}

/** False for a trimmed range, which is what extractFullData returns when the dataset is gone. */
function hasCoordinates(feature: RangeFeature | undefined): feature is RangeFeature {
  return Boolean(feature?.geometry?.coordinates);
}

/** Asks the server for the ranges at another budget, with the call's other arguments unchanged. */
async function fetchRanges(step: BudgetStep): Promise<RangeFeature[] | undefined> {
  const result = await app.callServerTool({
    name: "tomtom-find-reachable-areas",
    arguments: { ...toolArgs, budgets: [step.budget], response_detail: "compact" },
  });
  const content = result.content?.[0];
  if (result.isError || content?.type !== "text") return undefined;
  const fullData = await extractFullData<RangeFeatureCollection>(app, JSON.parse(content.text));
  const features = fullData?.features ?? [];
  return features.length && features.every(hasCoordinates) ? features : undefined;
}

async function switchToStep(step: BudgetStep, rangeSelect: HTMLSelectElement) {
  const request = ++switchRequest;
  let features = ranges.get(step.budget.value);
  if (!features) {
    setStatus("loading", rangeSelect);
    try {
      features = await fetchRanges(step);
    } catch (e) {
      console.error("[ReachableRange] Failed to fetch range:", e);
    }
    if (request !== switchRequest) return;
    if (!features) {
      setStatus("failed", rangeSelect);
      rangeSelect.value = String(currentStep?.budget.value ?? "");
      return;
    }
    ranges.set(step.budget.value, features);
  }
  setStatus("idle", rangeSelect);
  currentStep = step;
  showRanges(features, true);
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

  // The SDK stores the request's budget in the range's properties
  const budget = fc.features[0].properties?.budget as ReachableRangeBudget | undefined;
  if (budget) {
    budgetType = budget.type;
    requestedBudget = budget.value;
  }

  switchRequest++;
  steps = budgetSteps(toolArgs);
  currentStep = steps.find((s) => s.multiplier === 1);
  ranges = new Map(currentStep ? [[currentStep.budget.value, fc.features]] : []);

  // Update the budget type display
  const budgetTypeSelect = document.getElementById("opt-budget-type") as HTMLSelectElement | null;
  if (budgetTypeSelect) budgetTypeSelect.value = budgetType;

  populateRangeSelect();
  showRanges(fc.features, true);
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
  switchRequest++;
  ranges = new Map();
  shownFeatures = [];
  if (geometriesModule) await geometriesModule.clear();
  if (placesModule) await placesModule.clear();
}

// ── MCP lifecycle ──

app.ontoolinput = (params) => {
  toolArgs = (params.arguments ?? {}) as Partial<FindReachableAreasParams>;
};

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
      const fc = await extractFullData<RangeFeatureCollection>(app, apiResponse);
      if (fc?.features?.length && !hasCoordinates(fc.features[0])) {
        console.warn("[ReachableRange] Range has no coordinates: the dataset fetch likely failed");
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
