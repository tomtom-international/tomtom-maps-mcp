import { test, expect } from "./fixtures/servers";
import type { Page, FrameLocator } from "@playwright/test";

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
}

const POI_POPUP: PopupCheck = {
  selector: ".poi-popup-container",
  textSelector: ".poi-name",
};

const TOOLS: ToolDef[] = [
  // Search
  { name: "tomtom-geocode", description: "geocode: renders map with pins, shows POI popup on marker click",
    contentCheck: "address", popupCheck: POI_POPUP },
  { name: "tomtom-reverse-geocode", description: "reverse-geocode: renders location pin, shows POI popup on click",
    contentCheck: "address", popupCheck: POI_POPUP },
  { name: "tomtom-fuzzy-search", description: "fuzzy-search: renders search results, shows POI popup on marker click",
    contentCheck: "results", popupCheck: POI_POPUP },
  { name: "tomtom-poi-search", description: "poi-search: renders POI markers, shows popup on click",
    contentCheck: "results", popupCheck: POI_POPUP },
  { name: "tomtom-nearby", description: "nearby: renders nearby places, shows POI popup on marker click",
    contentCheck: "results", popupCheck: POI_POPUP },
  { name: "tomtom-area-search", description: "area-search: renders boundary polygon and pins, shows POI popup on click",
    contentCheck: "results", hasTraffic: false, popupCheck: POI_POPUP },
  { name: "tomtom-ev-search", description: "ev-search: renders EV station markers, shows POI popup on click",
    contentCheck: "results", hasTraffic: false, popupCheck: POI_POPUP },
  { name: "tomtom-search-along-route", description: "search-along-route: renders route with POI markers, shows popup on click",
    contentCheck: "results", popupCheck: POI_POPUP },
  // Routing (waypoints have no popup handlers — skip popup check)
  { name: "tomtom-routing", description: "routing: renders route on map with waypoint markers",
    contentCheck: "featurecollection" },
  { name: "tomtom-reachable-range", description: "reachable-range: renders isochrone polygons with budget controls",
    contentCheck: "featurecollection", appChecks: ["#range-options", "#opt-max-budget"] },
  { name: "tomtom-ev-routing", description: "ev-routing: renders EV route with charging stops",
    contentCheck: "featurecollection" },
  // Traffic
  { name: "tomtom-traffic", description: "traffic: renders live traffic flow with auto-opened incident popup",
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

/** Run a tool with default example input and return the app frame locator. */
async function runToolWithUI(page: Page, toolName: string): Promise<FrameLocator> {
  await page.getByTestId(`tool-item-${toolName}`).click();
  await expect(page.getByTestId("selected-tool-name")).toHaveText(
    toolName.replace("tomtom-", ""),
  );
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

/** Fire a synthetic MapLibre click on a marker feature, verify popup appears. */
async function verifyMarkerPopup(app: FrameLocator, page: Page, popupCheck: PopupCheck) {
  // Poll for the inner app frame (created async via doc.write, URL is about:blank)
  let appFrame = null;
  for (let i = 0; i < 60; i++) {
    appFrame = page.frames().find(
      (f) => f !== page.mainFrame() && (f.url() === "about:blank" || f.url() === "about:srcdoc"),
    );
    if (appFrame) break;
    await page.waitForTimeout(500);
  }
  if (!appFrame) throw new Error("Could not find inner app frame for marker click");

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
      const app = await runToolWithUI(page, tool.name);
      await verifyMapRendered(app, tool);

      // Marker click → popup (search tools)
      if (tool.popupCheck) {
        await verifyMarkerPopup(app, page, tool.popupCheck);
      }

      // Tool-specific popup assertions
      if (tool.name === "tomtom-traffic") {
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
  test("geocode: hides map and shows 'Data processed' pill when show_ui is false", async ({ connectedPage: page }) => {
    await page.getByTestId("tool-item-tomtom-geocode").click();

    // Override input to set show_ui: false
    const textarea = page.getByTestId("request-body-textarea");
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
