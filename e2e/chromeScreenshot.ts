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

import { expect, type Locator } from "@playwright/test";

/**
 * Share of pixels a chrome shot may differ by. Antialiasing of text and
 * icons accounts for it. The map is not in these shots: tiles, labels and
 * traffic move by more than any ratio that would still catch a missing control.
 */
const CHROME_DIFF_RATIO = 0.02;

/**
 * The title and legend blur the map behind them, and the control row and its
 * shadow are translucent, so a shot would include live tiles. Playwright's
 * screenshot stylesheet lands on the host page. These elements sit in the app
 * iframe, so the override is injected there.
 */
const SCREENSHOT_STYLE = `
  .viz-title, .viz-legend, .map-controls, .maplibregl-popup-content {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background: #fff !important;
    box-shadow: none !important;
    border-radius: 0 !important;
  }
  .map-control-btn, .map-control-btn:hover {
    background: #fff !important;
    box-shadow: none !important;
    transform: none !important;
  }
`;

/** Compare one chrome element with its committed baseline. */
export async function expectChrome(locator: Locator, name: string): Promise<void> {
  await locator.evaluate(async (element, css: string) => {
    const document = element.ownerDocument;
    let style = document.querySelector("style[data-e2e-chrome]");
    if (!style) {
      style = document.createElement("style");
      style.setAttribute("data-e2e-chrome", "");
      document.head.appendChild(style);
    }
    style.textContent = css;
    // Rounded corners leave the map in the bounding box, and a translucent
    // fill composites the tiles. The element itself has to be opaque.
    for (const property of ["background", "background-color"]) {
      element.style.setProperty(property, "#fff", "important");
    }
    for (const property of ["backdrop-filter", "-webkit-backdrop-filter", "box-shadow"]) {
      element.style.setProperty(property, "none", "important");
    }
    element.style.setProperty("border-radius", "0", "important");
    // The screenshot otherwise catches the frame from before this override.
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
    });
  }, SCREENSHOT_STYLE);

  await expect(locator).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: CHROME_DIFF_RATIO,
  });
}
