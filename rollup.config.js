/*
 * Copyright (C) 2025 TomTom NV
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

// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';

/** @type {import('rollup').RollupOptions} */
export default {
  input: 'src/index.ts',       // adjust if your entry is named differently
  output: [
    {
      file: 'dist/index.esm.js',
      format: 'es',
      sourcemap: true
    },
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      sourcemap: true
    }
  ],
  external: [
    // MCP SDK
    '@modelcontextprotocol/sdk',
    // HTTP client
    'axios',
    // Static imports for dynamic maps
    '@maplibre/maplibre-gl-native',
    'canvas',
    '@turf/turf',
    // Validation
    'zod',
    // Environment
    'dotenv',
    // Node built-ins
    'fs', 'path', 'crypto', 'util', 'url', 'events', 'stream', 'buffer'
  ],
  plugins: [
    resolve({
      preferBuiltins: true,
      exportConditions: ['node']
    }),
    commonjs(),
    json(),
    typescript({
      tsconfig: './tsconfig.json',
      // no declaration generation here
    })
  ]
};