/*
 * Copyright (C) 2025 TomTom Navigation B.V.
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

import { test as base, expect, type Page } from "@playwright/test";

const API_KEY = process.env.TOMTOM_API_KEY;

/**
 * Custom fixture that navigates to the UI and waits for the MCP server
 * connection to be established before running each test.
 *
 * Skips all tests gracefully if TOMTOM_API_KEY is not set.
 */
export const test = base.extend<{ connectedPage: Page }>({
  connectedPage: async ({ page }, use, testInfo) => {
    if (!API_KEY) {
      testInfo.skip(true, "TOMTOM_API_KEY not set — skipping E2E tests");
      return;
    }

    await page.goto("/");

    // Wait for the MCP server connection badge to appear
    await expect(page.getByTestId("server-badge")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tool-count")).toContainText("tools", { timeout: 30_000 });

    await use(page);
  },
});

export { expect };
