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

import fs from "node:fs/promises";

interface CachedApp {
  mtimeMs: number;
  size: number;
  html: string;
}

/** App HTML already read from disk, keyed by absolute file path. */
const cache = new Map<string, CachedApp>();

/**
 * Reads an MCP App bundle, serving it from memory once it has been read.
 *
 * Each app ships as one inlined HTML file, so a read hands over the whole
 * bundle: around 2 MB for a map app, which carries MapLibre's inlined worker.
 * That file only changes when `build:apps` runs, so re-reading and re-decoding
 * it on every render is pure overhead.
 *
 * Validated against mtime and size rather than cached outright, which keeps a
 * rebuild visible to an already-running server: the `pnpm ui` loop rebuilds the
 * apps under a server started from `dist`, and a blind cache would serve the
 * previous bundle until restart. A `stat` costs about a hundredth of what
 * reading the file costs, so the check is close to free.
 *
 * Only successful reads are cached, so a server started before `build:apps` ran
 * picks the apps up once they exist instead of serving the fallback forever.
 *
 * @param htmlPath - Absolute path to the app's `app.html`
 * @returns The bundle's contents
 * @throws If the file cannot be stat'd or read
 */
export async function readAppHtml(htmlPath: string): Promise<string> {
  const { mtimeMs, size } = await fs.stat(htmlPath);

  const cached = cache.get(htmlPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.html;
  }

  const html = await fs.readFile(htmlPath, "utf-8");
  cache.set(htmlPath, { mtimeMs, size, html });
  return html;
}
