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
import { inflateSync } from "node:zlib";

/**
 * Share of sampled pixels that must differ from the canvas corner.
 * A map that never paints is one flat color, so the share is 0. A basemap,
 * or a few markers on a plain background, clears this.
 */
const PAINTED_PIXEL_RATIO = 0.005;

/**
 * The canvas element is in the DOM even when WebGL cleared it. Reading the
 * drawing buffer from the page is blank unless the map kept it, so this
 * samples the screenshot Playwright takes of the composited frame. Overlays
 * on top of the canvas are hidden for that shot, or a blank map would pass
 * on the buttons and logos alone.
 */
export async function assertCanvasPainted(
  canvas: Locator,
  label: string,
  options?: { waitForTiles?: boolean }
): Promise<void> {
  if (options?.waitForTiles) {
    await canvas.evaluate(async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const ml = (window as { __e2e_ml?: MapHandle }).__e2e_ml;
        if (ml?.loaded() && ml.isStyleLoaded() && ml.areTilesLoaded() && !ml.isMoving()) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("map tiles did not finish loading");
    });
  }

  const deadline = Date.now() + (options?.waitForTiles ? 10_000 : 0);
  let painted = 0;
  do {
    const png = await canvas.screenshot({
      animations: "disabled",
      style:
        ".map-controls, .maplibregl-control-container, .viz-title, .viz-legend, .maplibregl-popup, .maplibregl-marker { visibility: hidden }",
    });
    painted = paintedPixelRatio(png);
    if (painted > PAINTED_PIXEL_RATIO) return;
    if (Date.now() >= deadline) break;
    await canvas.page().waitForTimeout(300);
  } while (Date.now() < deadline);

  expect(painted, `${label} map canvas is blank`).toBeGreaterThan(PAINTED_PIXEL_RATIO);
}

interface MapHandle {
  loaded: () => boolean;
  isStyleLoaded: () => boolean;
  areTilesLoaded: () => boolean;
  isMoving: () => boolean;
}

/** Fraction of sampled pixels whose luminance differs from the top-left pixel. */
export function paintedPixelRatio(png: Buffer): number {
  const { width, height, channels, pixels } = decodePng(png);
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  const origin = luminance(pixels, channels, 0);
  let sampled = 0;
  let painted = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      sampled += 1;
      const luma = luminance(pixels, channels, (y * width + x) * channels);
      if (Math.abs(luma - origin) > 18) painted += 1;
    }
  }
  return sampled === 0 ? 0 : painted / sampled;
}

function luminance(pixels: Uint8Array, channels: number, offset: number): number {
  if (channels === 1 || channels === 2) return pixels[offset];
  return pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
}

function decodePng(png: Buffer): { width: number; height: number; channels: number; pixels: Uint8Array } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => png[index] !== byte)) {
    throw new Error("canvas screenshot is not a PNG");
  }

  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0) {
        throw new Error("canvas screenshot PNG is not 8-bit and non-interlaced");
      }
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const channels = channelsFor(colorType);
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height * channels);
  const stride = width * channels;
  let source = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[source];
    source += 1;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      row[i] = (inflated[source] + predictor(filter, left, up, upLeft)) & 255;
      source += 1;
    }
    previous = row;
  }
  return { width, height, channels, pixels };
}

function channelsFor(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`canvas screenshot PNG color type ${colorType} is not supported`);
  }
}

function predictor(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4: {
      const estimate = left + up - upLeft;
      const leftDistance = Math.abs(estimate - left);
      const upDistance = Math.abs(estimate - up);
      const upLeftDistance = Math.abs(estimate - upLeft);
      if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
      return upDistance <= upLeftDistance ? up : upLeft;
    }
    default:
      throw new Error(`canvas screenshot PNG filter ${filter} is not supported`);
  }
}
