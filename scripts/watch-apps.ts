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

import fs from 'fs';
import path from 'path';
import { build } from 'vite';
import type { RolldownWatcher } from 'rolldown';
import { APPS_DIR, ROOT_DIR, appViteConfig } from './appViteConfig';

const DIST_DIR = path.join(ROOT_DIR, 'dist/apps');

function discoverAppIds(): string[] {
  return fs.readdirSync(APPS_DIR).flatMap((category) => {
    const categoryDir = path.join(APPS_DIR, category);
    if (!fs.statSync(categoryDir).isDirectory()) return [];
    return fs
      .readdirSync(categoryDir)
      .filter((name) => fs.existsSync(path.join(categoryDir, name, 'app.html')))
      .map((name) => `${category}/${name}`);
  });
}

async function watchApp(appId: string): Promise<void> {
  const appDir = path.join(APPS_DIR, appId);
  const config = appViteConfig({
    appDir,
    htmlPath: path.join(appDir, 'app.html'),
    outDir: path.join(DIST_DIR, appId),
  });
  const watcher = (await build({
    ...config,
    build: { ...config.build, watch: {} },
  })) as RolldownWatcher;

  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_END') {
      console.log(`✅ ${appId} built in ${event.duration}ms`);
      event.result.close();
    }
    if (event.code === 'ERROR') {
      console.error(`❌ ${appId}: ${event.error.message}`);
      event.result?.close();
    }
  });
}

const appIds = discoverAppIds();
console.log(`Watching ${appIds.length} MCP Apps: ${appIds.join(', ')}`);
await Promise.all(appIds.map(watchApp));
