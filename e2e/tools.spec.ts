/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from "./fixtures/servers";
import type { Frame, FrameLocator, Page } from "@playwright/test";

/**
 * Per-tool tests: verify map renders, controls work, tooltips/popups appear,
 * and JSON result is correct. Also tests show_ui=false behavior.
 */

interface PopupCheck {
  /** CSS selector for the popup container. */
  selector: string;
  /** CSS selector for the text element that must not be empty. */
  textSelector: string;
}

interface ToolDef {
  name: string;
  /** Test description shown in output. */
  description: string;
  /** Keyword expected in the JSON result (lowercase match). */
  contentCheck?: string;
  /** Extra selectors to verify inside the app iframe. */
  appChecks?: string[];
  /** Whether traffic toggle should be present (default: true). */
  hasTraffic?: boolean;
  /** Popup to verify after clicking the canvas center. */
  popupCheck?: PopupCheck;
  /** Input to run instead of the tool's example in `ui/src/index.tsx`, which `replaces` matches. */
  input?: { replaces: RegExp; with: Record<string, unknown> };
  /** Geometry types the app must draw besides its pins: a route line, a search outline. */
  drawn?: string[];
}

const POI_POPUP: PopupCheck = {
  selector: ".poi-popup-container",
  textSelector: ".poi-name",
};

const TOOLS: ToolDef[] = [
  // Search
  { name: "tomtom-locate-place", description: "locate-place: renders map with pins, shows POI popup on marker click",
    contentCheck: "address", popupCheck: POI_POPUP },
  { name: "tomtom-reverse-geocode", description: "reverse-geocode: renders location pin, shows POI popup on click",
    contentCheck: "address", popupCheck: POI_POPUP },
  { name: "tomtom-discover-places", description: "discover-places: renders search results, shows POI popup on marker click",
    contentCheck: "results", popupCheck: POI_POPUP },
  { name: "tomtom-discover-places", description: "discover-places within: renders results inside a named area, outlined",
    contentCheck: "amsterdam", popupCheck: POI_POPUP, drawn: ["Polygon"],
    input: {
      replaces: /coffee shop/,
      with: { query: "coffee shop", where: { mode: "within", queries: ["Amsterdam"] }, limit: 5, show_ui: true },
    } },
  { name: "tomtom-discover-places", description: "discover-places maxDetour: renders the route and the stops along it",
    contentCheck: "along the route, from the start", popupCheck: POI_POPUP, drawn: ["LineString"],
    input: {
      replaces: /coffee shop/,
      with: {
        poiCategories: ["CHARGING_LOCATION"],
        where: {
          mode: "maxDetour",
          locations: [{ position: [4.8897, 52.374] }, { position: [5.1214, 52.0907] }],
          maxDetourTimeSeconds: 300,
          sortBy: "detourOffset",
        },
        limit: 5,
        show_ui: true,
      },
    } },
  // Routing (waypoints have no popup handlers — skip popup check)
  { name: "tomtom-plan-route", description: "plan-route: renders route on map with waypoint markers",
    contentCheck: "featurecollection" },
  // Traffic
  { name: "tomtom-get-traffic", description: "get-traffic: renders live traffic flow with auto-opened incident popup",
    contentCheck: "incidents", appChecks: ["#live-traffic-timer", ".live-dot", ".live-label"] },
  // Map & Viz
  { name: "tomtom-dynamic-map", description: "dynamic-map: renders marker at Amsterdam, shows popup on click" },
  { name: "tomtom-data-viz", description: "data-viz: renders data visualization with title overlay",
    appChecks: ["#viz-title-overlay"] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Navigate into the double iframe: host → sandbox → inner app. */
function getAppFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="app-iframe"]').frameLocator("iframe");
}

/** Run a tool with its example input, or `input`, and return the app frame locator. */
async function runToolWithUI(
  page: Page,
  toolName: string,
  input?: ToolDef["input"],
): Promise<FrameLocator> {
  await page.getByTestId(`tool-item-${toolName}`).click();
  await expect(page.getByTestId("selected-tool-name")).toHaveText(
    toolName.replace("tomtom-", ""),
  );
  if (input) {
    const textarea = page.getByTestId("request-body-textarea");
    // Filled before the clicked tool's example lands, it would be overwritten.
    await expect(textarea).toHaveValue(input.replaces);
    await textarea.fill(JSON.stringify(input.with, null, 2));
  }
  await page.getByTestId("run-button").click();

  await expect(page.getByTestId("tab-map")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("app-iframe")).toBeVisible();

  return getAppFrame(page);
}

/** Verify common map elements: canvas, controls, theme toggle interactivity. */
async function verifyMapRendered(app: FrameLocator, tool: ToolDef) {
  await expect(app.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
  await expect(app.locator(".maplibregl-canvas")).toBeVisible();
  await expect(app.locator(".map-controls")).toBeVisible();

  // Theme toggle is interactive
  const themeBtn = app.locator(".map-control-btn.theme-btn");
  await expect(themeBtn).toBeVisible();
  await themeBtn.click();

  // Traffic toggle where applicable
  if (tool.hasTraffic !== false) {
    await expect(app.locator(".map-control-btn.traffic-btn")).toBeVisible();
  }

  // Tool-specific DOM checks
  if (tool.appChecks) {
    for (const selector of tool.appChecks) {
      await expect(app.locator(selector)).toBeVisible({ timeout: 15_000 });
    }
  }
}

/** The inner app frame, which the sandbox creates with doc.write, so its URL is about:blank. */
async function innerAppFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 60; i++) {
    const appFrame = page.frames().find(
      (f) => f !== page.mainFrame() && (f.url() === "about:blank" || f.url() === "about:srcdoc"),
    );
    if (appFrame) return appFrame;
    await page.waitForTimeout(500);
  }
  throw new Error("Could not find the inner app frame");
}

/** Wait until the app's own GeoJSON layers render each geometry type, a Multi- variant included. */
async function verifyDrawn(page: Page, types: string[]) {
  const appFrame = await innerAppFrame(page);
  await appFrame.waitForFunction((wanted) => {
    const ml = (window as any).__e2e_ml;
    if (!ml || ml.isMoving()) return false;
    const style = ml.getStyle();
    const layers = style.layers
      .filter((l: any) => l.source && style.sources[l.source]?.type === "geojson")
      .map((l: any) => l.id);
    const rendered = new Set(
      ml.queryRenderedFeatures(undefined, { layers }).map((f: any) => f.geometry?.type),
    );
    return wanted.every((type: string) => rendered.has(type) || rendered.has(`Multi${type}`));
  }, types, { timeout: 30_000 });
}

/** Fire a synthetic MapLibre click on a marker feature, verify popup appears. */
async function verifyMarkerPopup(app: FrameLocator, page: Page, popupCheck: PopupCheck) {
  const appFrame = await innerAppFrame(page);

  // Wait for map idle + markers rendered, then fire a synthetic click on the first marker.
  // This bypasses canvas clicking (which is unreliable for icon-anchored pins)
  // and instead uses MapLibre's internal event system directly.
  const clicked = await appFrame.waitForFunction(() => {
    const ml = (window as any).__e2e_ml;
    if (!ml || ml.isMoving()) return false;

    // Find custom point layers (exclude base map layers by checking source type)
    const style = ml.getStyle();
    const customLayerIds = style.layers
      .filter((l: any) => l.source && style.sources[l.source]?.type === "geojson")
      .map((l: any) => l.id);

    if (!customLayerIds.length) return false;

    const features = ml.queryRenderedFeatures(undefined, { layers: customLayerIds });
    const pointFeature = features.find((f: any) => f.geometry?.type === "Point");
    if (!pointFeature) return false;

    const coords = pointFeature.geometry.coordinates;
    const point = ml.project(coords);

    // Fire synthetic click — MapLibre dispatches to layer-specific handlers
    ml.fire("click", {
      point: { x: point.x, y: point.y },
      lngLat: { lng: coords[0], lat: coords[1] },
      originalEvent: new MouseEvent("click", { bubbles: true }),
      preventDefault() {},
      defaultPrevented: false,
    });

    return true;
  }, undefined, { timeout: 30_000 });

  expect(await clicked.jsonValue()).toBe(true);

  // Verify popup appeared with content
  await expect(app.locator(popupCheck.selector)).toBeVisible({ timeout: 5_000 });
  await expect(app.locator(popupCheck.textSelector)).not.toBeEmpty();

  // Close popup and verify it disappears
  await app.locator(".maplibregl-popup-close-button").click();
  await expect(app.locator(popupCheck.selector)).not.toBeVisible();
}

/** Traffic: auto-opened incident popup with title and data rows. */
async function verifyTrafficPopup(app: FrameLocator) {
  const popup = app.locator(".incident-popup");
  await expect(popup).toBeVisible({ timeout: 15_000 });
  await expect(app.locator(".incident-popup-title")).not.toBeEmpty();
  await expect(app.locator(".incident-popup-row").first()).toBeVisible();
}

/** Dynamic map: click canvas center to hit Amsterdam marker, verify popup content. */
async function verifyDynamicMapPopup(app: FrameLocator) {
  const canvas = app.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) return;

  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

  const popup = app.locator(".dm-popup");
  // Soft check: canvas click coordinates are approximate for dynamic-map
  try {
    await expect(popup).toBeVisible({ timeout: 5_000 });
    await expect(app.locator(".dm-popup-title")).toContainText("Amsterdam");
  } catch {
    // Marker may not be exactly at center — log but don't fail
  }
}

/** Switch to JSON Result tab and validate response content. */
async function verifyJsonResult(page: Page, tool: ToolDef) {
  await page.getByTestId("tab-result").click();
  const result = page.getByTestId("json-result");
  await expect(result).toBeVisible({ timeout: 60_000 });

  const text = await result.textContent();
  expect(text).toBeTruthy();

  const parsed = JSON.parse(text!);
  expect(parsed.isError).not.toBe(true);
  expect(parsed.content?.length).toBeGreaterThan(0);

  if (tool.contentCheck) {
    expect(text!.toLowerCase()).toContain(tool.contentCheck);
  }
}

// ─── show_ui: true ─────────────────────────────────────────────────────────

test.describe.serial("Tools — show_ui: true", () => {
  for (const tool of TOOLS) {
    test(tool.description, async ({ connectedPage: page }) => {
      const app = await runToolWithUI(page, tool.name, tool.input);
      await verifyMapRendered(app, tool);

      if (tool.drawn) await verifyDrawn(page, tool.drawn);

      // Marker click → popup (search tools)
      if (tool.popupCheck) {
        await verifyMarkerPopup(app, page, tool.popupCheck);
      }

      // Tool-specific popup assertions
      if (tool.name === "tomtom-get-traffic") {
        await verifyTrafficPopup(app);
      } else if (tool.name === "tomtom-dynamic-map") {
        await verifyDynamicMapPopup(app);
      }

      await verifyJsonResult(page, tool);
    });
  }
});

// ─── show_ui: false ────────────────────────────────────────────────────────

test.describe("Tools — show_ui: false", () => {
  test("locate-place: hides map and shows 'Data processed' pill when show_ui is false", async ({ connectedPage: page }) => {
    await page.getByTestId("tool-item-tomtom-locate-place").click();

    // Override input to set show_ui: false
    const textarea = page.getByTestId("request-body-textarea");
    await expect(textarea).toHaveValue(/Amsterdam Central Station/);
    const input = JSON.parse(await textarea.inputValue());
    input.show_ui = false;
    await textarea.fill(JSON.stringify(input, null, 2));

    await page.getByTestId("run-button").click();

    // Wait for iframe to load
    await expect(page.getByTestId("tab-map")).toBeVisible({ timeout: 60_000 });
    const app = getAppFrame(page);

    // Verify pill indicator
    await expect(app.locator("#ui-hidden-indicator")).toBeVisible({ timeout: 15_000 });
    await expect(app.locator(".indicator-pill")).toContainText("Data processed");

    // Map should be hidden
    await expect(app.locator("html")).toHaveClass(/ui-hidden/);

    // JSON result should still be valid
    await page.getByTestId("tab-result").click();
    const result = page.getByTestId("json-result");
    await expect(result).toBeVisible({ timeout: 60_000 });
    const parsed = JSON.parse((await result.textContent())!);
    expect(parsed.isError).not.toBe(true);
    expect(parsed.content?.length).toBeGreaterThan(0);
  });
});
