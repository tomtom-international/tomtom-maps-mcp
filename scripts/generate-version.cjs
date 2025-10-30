const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const pkgPath = resolve(__dirname, '../package.json');
const outPath = resolve(__dirname, '../src/version.ts');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '0.0.0';

const content = `// This file is generated. Do not edit manually.\nexport const VERSION = ${JSON.stringify(version)};\n`;
writeFileSync(outPath, content, 'utf8');
console.log(`Wrote ${outPath} with VERSION=${version}`);
