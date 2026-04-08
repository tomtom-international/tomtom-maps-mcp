import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config();

export default defineConfig({
  testDir: "./e2e",
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
        MAPS: "tomtom-orbis-maps",
        PORT: "3000",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "cd ui && npx tsx serve.ts",
      port: 8080,
      timeout: 15_000,
      reuseExistingServer: !process.env.CI,
      env: {
        TOMTOM_API_KEY: process.env.TOMTOM_API_KEY ?? "",
        MAPS: "tomtom-orbis-maps",
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
