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
