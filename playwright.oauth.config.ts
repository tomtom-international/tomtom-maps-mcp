import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { environmentFromEnv } from "./e2e/oauth/environments";

config();

// Redirect hosts resolve to localhost so a captured authorization code never leaves the machine.
const redirectHostsToLocalhost = environmentFromEnv()
  .connectors.map((connector) => `MAP ${new URL(connector.redirectUri).hostname} 127.0.0.1`)
  .join(",");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "oauth.spec.ts",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["html", { open: "never" }], ["list"], ...(process.env.CI ? [["github"] as const] : [])],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: [`--host-resolver-rules=${redirectHostsToLocalhost}`] },
  },
});
