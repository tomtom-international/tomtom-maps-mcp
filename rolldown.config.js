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

// Bundles the two server entry points. Rolldown resolves node modules, mixed
// ESM/CJS graphs, JSON and TypeScript natively, so no resolver or transform
// plugins are configured; `platform: 'node'` keeps the node built-ins external.
// Type declarations come from `tsc --emitDeclarationOnly` (the `build:ts`
// script) — this config only transpiles and bundles.
import { defineConfig } from 'rolldown';

/** Dependencies that must stay external in every bundle. */
const sharedExternal = [
  // MCP SDK
  '@modelcontextprotocol/sdk',
  // HTTP client
  'axios',
  'node-fetch',
  // Static imports for maps
  'skia-canvas',
  // Validation
  'zod',
  // Environment
  'dotenv',
  // TypeScript runtime
  'tslib'
];

/** Input options shared by both entry points. */
const sharedInput = {
  platform: 'node',
  tsconfig: './tsconfig.json'
};

/** @param {string} name @returns {import('rolldown').OutputOptions[]} */
const outputsFor = (name) => [
  {
    file: `dist/${name}.esm.js`,
    format: 'es',
    sourcemap: true
  },
  {
    file: `dist/${name}.cjs.js`,
    format: 'cjs',
    sourcemap: true
  }
];

export default defineConfig([
  // Stdio MCP server entry point
  {
    input: 'src/index.ts',
    ...sharedInput,
    external: sharedExternal,
    output: outputsFor('index')
  },
  // HTTP MCP server entry point
  {
    input: 'src/indexHttp.ts',
    ...sharedInput,
    external: [
      ...sharedExternal,
      // HTTP framework
      'express',
      'cors'
    ],
    output: outputsFor('indexHttp')
  }
]);
