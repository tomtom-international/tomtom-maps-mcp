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

import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config();

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["oauth.spec.ts", "protocol.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  webServer: [
    {
      command: "node dist/indexHttp.esm.js",
      port: 3000,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: {
        TOMTOM_API_KEY: process.env.TOMTOM_API_KEY ?? "",
        PORT: "3000",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "pnpm --filter tomtom-mcp-app-host serve",
      port: 8080,
      timeout: 15_000,
      reuseExistingServer: !process.env.CI,
      env: {
        TOMTOM_API_KEY: process.env.TOMTOM_API_KEY ?? "",
        HOST_PORT: "8080",
        SANDBOX_PORT: "8081",
      },
    },
  ],

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
