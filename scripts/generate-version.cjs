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

const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const pkgPath = resolve(__dirname, '../package.json');
const versionPath = resolve(__dirname, '../src/version.ts');
const manifestPath = resolve(__dirname, '../manifest-binary.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '0.0.0';

// Generate src/version.ts
const versionContent = `// This file is generated. Do not edit manually.
export const VERSION = ${JSON.stringify(version)};
`;
writeFileSync(versionPath, versionContent, 'utf8');
console.log(`Generated ${versionPath} with VERSION=${version}`);

// Sync manifest-binary.json
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version) {
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Updated ${manifestPath} version to ${version}`);
} else {
  console.log(`${manifestPath} version already matches (${version})`);
}
