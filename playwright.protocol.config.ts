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

import { defineConfig } from "@playwright/test";
import { config } from "dotenv";

config();

const probesLocalBuild = (process.env.PROTOCOL_TARGET ?? "local") === "local";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "protocol.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ...(process.env.CI ? [["github"] as const] : [])],
  webServer: probesLocalBuild
    ? {
        command: "node dist/indexHttp.esm.js",
        port: 3000,
        timeout: 30_000,
        reuseExistingServer: !process.env.CI,
        env: { PORT: "3000", LOG_LEVEL: "warn" },
      }
    : undefined,
});
