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

import { expect, type FrameLocator, type Page, test } from "@playwright/test";

const AMSTERDAM = [4.9, 52.37];
const LISBON = [-9.14, 38.72];

test.use({ launchOptions: { args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] } });

test.skip(!process.env.TOMTOM_API_KEY, "TOMTOM_API_KEY not set");

async function openHost(page: Page, profile: string): Promise<void> {
  await page.goto(`/?host=${profile}`);
  await expect(page.getByTestId("server-badge")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tool-count")).toContainText("tools", { timeout: 30_000 });
}

async function runTool(
  page: Page,
  tool: string,
  input?: Record<string, unknown>
): Promise<FrameLocator> {
  await page.getByTestId(`tool-item-${tool}`).click();
  await expect(page.getByTestId("selected-tool-name")).toHaveText(tool.replace("tomtom-", ""));
  if (input) await page.getByTestId("request-body-textarea").fill(JSON.stringify(input));
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("tab-map")).toBeVisible({ timeout: 60_000 });
  return page.frameLocator('[data-testid="app-iframe"]').frameLocator("iframe");
}

async function expectMapDrawn(app: FrameLocator): Promise<void> {
  await expect(app.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
  await expect(app.locator(".maplibregl-canvas")).toBeVisible();
}

test.describe("ChatGPT: workers only from blob: URLs", () => {
  for (const tool of ["tomtom-geocode", "tomtom-routing", "tomtom-traffic", "tomtom-dynamic-map", "tomtom-data-viz"]) {
    test(`${tool} draws its map`, async ({ page }) => {
      const sandbox = page.waitForResponse((response) => response.url().includes("sandbox.html"));
      await openHost(page, "chatgpt");
      const app = await runTool(page, tool);

      expect((await sandbox).headers()["content-security-policy"]).toContain("worker-src blob:;");
      await expectMapDrawn(app);
    });
  }
});

test.describe("A host that drops the result _meta (Cursor; ChatGPT from February to May 2026)", () => {
  test("tomtom-geocode shows its error state, never a blank frame", async ({ page }) => {
    await openHost(page, "drops-result-meta");
    const app = await runTool(page, "tomtom-geocode");

    await expect(app.locator("#ui-error-indicator")).toBeVisible({ timeout: 30_000 });
    await expect(app.locator("#sdk-map")).toBeHidden();
  });

  test("tomtom-data-viz still draws, fetching its data again", async ({ page }) => {
    await openHost(page, "drops-result-meta");
    const app = await runTool(page, "tomtom-data-viz");

    await expectMapDrawn(app);
  });
});

test.describe("Claude: no result over 150,000 characters reaches the app", () => {
  test("a 2,300 km route still reaches its app and draws", async ({ page }) => {
    await openHost(page, "claude");
    const app = await runTool(page, "tomtom-routing", {
      locations: [AMSTERDAM, LISBON],
      show_ui: true,
    });

    await expectMapDrawn(app);
  });
});
