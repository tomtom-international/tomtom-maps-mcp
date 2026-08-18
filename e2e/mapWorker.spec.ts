/**
 * Guards the one failure mode that the build, the type-checker and the unit
 * tests all miss: MapLibre's web worker not starting inside a single-file app.
 *
 * Each MCP App ships as one inlined HTML file served as a `ui://` resource, so
 * nothing can be fetched from next to it. A MapLibre build that loads its
 * worker from a sibling URL still fires `load` — the style is parsed on the
 * main thread — but every source stays unloaded, so the map renders blank while
 * looking healthy. This test fails loudly on that instead.
 */
import { test, expect } from "@playwright/test";
import http from "http";
import type { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "vite";
import { appViteConfig } from "../scripts/appViteConfig";
import type { ProbeWindow } from "./fixtures/map-worker-app/probe";

// SwiftShader gives headless Chromium the WebGL2 context MapLibre 6 requires.
test.use({ launchOptions: { args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] } });

const APP_DIR = fileURLToPath(new URL("fixtures/map-worker-app", import.meta.url));

let server: http.Server;
let outDir: string;
let appUrl: string;

test.beforeAll(async () => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tomtom-mcp-map-worker-"));
  await build(
    appViteConfig({
      appDir: APP_DIR,
      htmlPath: path.join(APP_DIR, "app.html"),
      outDir,
      logLevel: "silent",
    })
  );

  // Serve only what the bundle produced. A request for anything else 404s, the
  // same as an MCP host that can hand over a single HTML resource and nothing
  // more.
  server = http.createServer((req, res) => {
    const name = path.basename((req.url ?? "/").split("?")[0]) || "app.html";
    const file = path.join(outDir, name);
    if (!file.startsWith(outDir) || !fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/app.html`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  fs.rmSync(outDir, { recursive: true, force: true });
});

test.describe("MCP App map rendering", () => {
  test("MapLibre's worker parses source data inside the single-file bundle", async ({ page }) => {
    const workerFetchFailures: string[] = [];
    const workerConsoleErrors: string[] = [];

    const isWorkerAsset = (url: string) => /worker/i.test(url);
    page.on("requestfailed", (req) => {
      if (isWorkerAsset(req.url())) {
        workerFetchFailures.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 400 && isWorkerAsset(res.url())) {
        workerFetchFailures.push(`${res.url()} (HTTP ${res.status()})`);
      }
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && /worker/i.test(msg.text())) {
        workerConsoleErrors.push(msg.text());
      }
    });

    await page.goto(appUrl);

    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.mapLoaded === true), {
        timeout: 30_000,
        message: "the map never reached its load event",
      })
      .toBe(true);

    // The real assertion: data went to the worker and came back as geometry.
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.renderedFeatures() ?? -1), {
        timeout: 30_000,
        message:
          "MapLibre rendered no features, so its worker never parsed the source. " +
          "A single-file app cannot fetch a worker from a sibling URL — the worker " +
          "has to be inlined into the bundle.",
      })
      .toBeGreaterThan(0);

    expect(await page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.sourceLoaded())).toBe(true);

    // Diagnostics that name the cause when the assertion above fails.
    expect(workerFetchFailures, "MapLibre tried to fetch a worker that the bundle does not ship").toEqual([]);
    expect(workerConsoleErrors, "MapLibre could not construct its worker").toEqual([]);
    expect(await page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.errors)).toEqual([]);
  });
});
