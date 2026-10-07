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

/**
 * Guards the one failure mode that the build, the type-checker and the unit
 * tests all miss: MapLibre's web worker not starting inside a single-file app.
 *
 * Each MCP App ships as one inlined HTML file served as a `ui://` resource, so
 * nothing can be fetched from next to it. A MapLibre build that loads its
 * worker from a sibling URL still fires `load` — the style is parsed on the
 * main thread — but every source stays unloaded, so the map renders blank while
 * looking healthy. This test fails loudly on that instead.
 *
 * MapLibre and its worker load from a CDN, served here from `node_modules` so
 * the test stays offline, under the CSP the MCP Apps spec tells hosts to build
 * from the domains the apps declare.
 */
import { test, expect, type Page } from "@playwright/test";
import http from "http";
import type { AddressInfo } from "net";
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "vite";
import { MAPLIBRE_CDN_DIST, appViteConfig } from "../scripts/appViteConfig";
import { APP_CSP } from "../src/tools/helpers/appCsp";
import type { ProbeWindow } from "./fixtures/map-worker-app/probe";

// SwiftShader gives headless Chromium the WebGL2 context MapLibre 6 requires.
test.use({ launchOptions: { args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] } });

const APP_DIR = fileURLToPath(new URL("fixtures/map-worker-app", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const MAPLIBRE_DIST_DIR = path.dirname(
  createRequire(import.meta.url).resolve("maplibre-gl/dist/maplibre-gl.mjs")
);

const RESOURCE_DOMAINS = APP_CSP.resourceDomains.join(" ");

/** The policy the MCP Apps spec's host reference builds from `_meta.ui.csp`; it has no `worker-src`. */
const SPEC_HOST_CSP = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' ${RESOURCE_DOMAINS}`,
  `style-src 'self' 'unsafe-inline' ${RESOURCE_DOMAINS}`,
  `connect-src 'self' ${APP_CSP.connectDomains.join(" ")}`,
  `img-src 'self' data: ${RESOURCE_DOMAINS}`,
  `font-src 'self' ${RESOURCE_DOMAINS}`,
  `media-src 'self' data: ${RESOURCE_DOMAINS}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

let server: http.Server | undefined;
let outDir: string | undefined;
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

  // Serve only what the bundle produced, with the real content type for each
  // extension: a sibling worker chunk served as text/html would be rejected by
  // Chromium for the wrong reason and mask what actually regressed.
  const root = outDir;
  server = http.createServer((req, res) => {
    const name = path.basename((req.url ?? "/").split("?")[0]) || "app.html";
    const file = path.join(root, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": SPEC_HOST_CSP,
    });
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/app.html`;
});

test.afterAll(async () => {
  // Guarded: when the build above throws, `server` is never assigned, and an
  // unconditional `server?.close(cb)` would leave this promise pending until
  // Playwright's hook timeout — hiding the build error that actually failed.
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  if (outDir) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

/** Read a probe value until `done` accepts it or the deadline passes. Never throws. */
async function pollProbe<T>(
  page: Page,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await page.waitForTimeout(250);
    value = await read();
  }
  return value;
}

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
    const cspViolations: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      if (/worker/i.test(msg.text())) workerConsoleErrors.push(msg.text());
      if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
    });

    // Module scripts are fetched with CORS, so the stand-in answers like the CDN does.
    await page.context().route(`${MAPLIBRE_CDN_DIST}/*`, (route) => {
      const file = path.join(MAPLIBRE_DIST_DIR, path.basename(new URL(route.request().url()).pathname));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({
        body: fs.readFileSync(file),
        contentType: CONTENT_TYPES[path.extname(file)],
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });

    // The invariant the worker behaviour hangs off: one self-contained file, so
    // there is nothing beside it that MapLibre could load a worker from.
    expect(
      fs.readdirSync(outDir as string),
      "an MCP App must build to exactly one self-contained file"
    ).toEqual(["app.html"]);

    await page.goto(appUrl);

    // Polled without throwing, so every diagnostic below still runs and gets
    // reported when the map comes up blank.
    const mapLoaded = await pollProbe(
      page,
      () => page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.mapLoaded === true),
      (loaded) => loaded,
      30_000
    );
    const rendered = await pollProbe(
      page,
      () => page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.renderedFeatures() ?? -1),
      (count) => count > 0,
      30_000
    );

    // Soft, so a blank map reports the cause alongside the symptom instead of
    // stopping at whichever assertion happens to come first.
    expect
      .soft(workerFetchFailures, "MapLibre tried to fetch a worker the bundle does not ship")
      .toEqual([]);
    expect.soft(workerConsoleErrors, "MapLibre could not construct its worker").toEqual([]);
    expect.soft(cspViolations, "the app needs an origin its CSP does not declare").toEqual([]);
    expect
      .soft(
        await page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.errors),
        "the map reported errors"
      )
      .toEqual([]);
    expect.soft(mapLoaded, "the map never reached its load event").toBe(true);
    expect
      .soft(
        await page.evaluate(() => (window as ProbeWindow).mapWorkerProbe?.sourceLoaded()),
        "MapLibre never finished loading the probe source"
      )
      .toBe(true);

    expect(
      rendered,
      "MapLibre rendered no features, so its worker never parsed the source. " +
        "A single-file app cannot fetch a worker from a sibling URL — the worker " +
        "has to come from the CDN MapLibre is loaded from."
    ).toBeGreaterThan(0);
  });
});
