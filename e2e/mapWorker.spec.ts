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
import { test, expect, type Page } from "@playwright/test";
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

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

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
    page.on("console", (msg) => {
      if (msg.type() === "error" && /worker/i.test(msg.text())) {
        workerConsoleErrors.push(msg.text());
      }
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
        "has to be inlined into the bundle."
    ).toBeGreaterThan(0);
  });
});
