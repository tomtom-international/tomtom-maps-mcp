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
 * Build MCPB Package Script
 *
 * Creates a self-contained tomtom-maps-mcp-{platform}-{arch}.mcpb in
 * dist/mcpb/ with full dynamic map support. Bundles Node.js 24.x
 * (ABI 137) so users need zero external dependencies.
 *
 * Usage:
 *   node scripts/build-mcpb.cjs
 *   npm run build:mcpb
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

// Node.js version to bundle (ABI 137)
const NODE_VERSION = '24.13.1';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules');
const PLATFORM = process.platform;
const ARCH = process.arch;
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'dist', 'mcpb');
const OUTPUT_MCPB = path.join(OUTPUT_DIR, `tomtom-maps-mcp-${PLATFORM}-${ARCH}.mcpb`);

// Use OS temp directory
const TEMP_DIR = path.join(os.tmpdir(), `tomtom-maps-mcp-build-${Date.now()}`);

console.log(`Building tomtom-maps-mcp-${PLATFORM}-${ARCH}.mcpb...`);
console.log(`  Target: Node.js ${NODE_VERSION} (ABI 137) for ${PLATFORM}-${ARCH}`);

// Get Node.js download URL
function getNodeDownloadUrl() {
  const platform = PLATFORM === 'win32' ? 'win' : PLATFORM;
  const arch = ARCH === 'arm64' ? 'arm64' : 'x64';
  const ext = PLATFORM === 'win32' ? 'zip' : 'tar.gz';
  return `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platform}-${arch}.${ext}`;
}

// Download file with redirect support
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const follow = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          return follow(response.headers.location);
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    follow(url);
  });
}

// Extract Node.js distribution and return { nodeBinary, distDir }
async function extractNodeDist(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  if (PLATFORM === 'win32') {
    execSync(`tar -xf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
    const extracted = fs.readdirSync(destDir).find(f => f.startsWith('node-'));
    return {
      nodeBinary: path.join(destDir, extracted, 'node.exe'),
      distDir: path.join(destDir, extracted),
    };
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
    const extracted = fs.readdirSync(destDir).find(f => f.startsWith('node-'));
    return {
      nodeBinary: path.join(destDir, extracted, 'bin', 'node'),
      distDir: path.join(destDir, extracted),
    };
  }
}

// Copy directory recursively (preserves symlinks for node_modules/.bin compatibility)
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      try {
        fs.symlinkSync(target, destPath);
      } catch {
        // Fallback: copy as regular file if symlink creation fails
        fs.copyFileSync(srcPath, destPath);
      }
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      const stats = fs.statSync(srcPath);
      fs.chmodSync(destPath, stats.mode);
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const startTime = Date.now();

  // Check prerequisites
  if (!fs.existsSync(path.join(DIST_DIR, 'index.cjs.js'))) {
    console.error('Error: Run "npm run build" first.');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'manifest-binary.json'))) {
    console.error('Error: manifest-binary.json not found.');
    process.exit(1);
  }

  try {
    fs.mkdirSync(path.join(TEMP_DIR, 'bin', 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(TEMP_DIR, 'bin', 'app'), { recursive: true });
    fs.mkdirSync(path.join(TEMP_DIR, 'download'), { recursive: true });

    // 1. Download Node.js 24.x
    const nodeUrl = getNodeDownloadUrl();
    const archiveExt = PLATFORM === 'win32' ? 'zip' : 'tar.gz';
    const archivePath = path.join(TEMP_DIR, 'download', `node.${archiveExt}`);

    console.log(`  ↓ Downloading Node.js ${NODE_VERSION}...`);
    await download(nodeUrl, archivePath);

    // 2. Extract Node.js distribution and copy binary
    const { nodeBinary, distDir: nodeDistDir } = await extractNodeDist(archivePath, path.join(TEMP_DIR, 'download'));
    const nodeDest = path.join(TEMP_DIR, 'bin', 'runtime', PLATFORM === 'win32' ? 'node.exe' : 'node');
    fs.copyFileSync(nodeBinary, nodeDest);
    if (PLATFORM !== 'win32') fs.chmodSync(nodeDest, 0o755);

    // Verify ABI
    const abi = execSync(`"${nodeDest}" -e "process.stdout.write(process.versions.modules)"`)
      .toString()
      .trim();
    console.log(`  ✓ Node.js ${NODE_VERSION} (ABI ${abi})`);

    // 3. Copy app files
    const appDir = path.join(TEMP_DIR, 'bin', 'app');
    fs.copyFileSync(path.join(DIST_DIR, 'index.cjs.js'), path.join(appDir, 'index.cjs.js'));
    if (fs.existsSync(path.join(DIST_DIR, 'index.cjs.js.map'))) {
      fs.copyFileSync(path.join(DIST_DIR, 'index.cjs.js.map'), path.join(appDir, 'index.cjs.js.map'));
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
      name: pkg.name, version: pkg.version, main: 'index.cjs.js', type: 'commonjs'
    }, null, 2));
    console.log('  ✓ Application files');

    // 3b. Copy MCP apps (UI visualizations) if they exist
    const appsDir = path.join(DIST_DIR, 'apps');
    if (fs.existsSync(appsDir)) {
      copyDir(appsDir, path.join(appDir, 'apps'));
      console.log('  ✓ MCP Apps');
    }

    // 4. Copy node_modules
    copyDir(NODE_MODULES, path.join(appDir, 'node_modules'));
    console.log('  ✓ Dependencies');

    // 4b. Rebuild native modules for ABI 137 using downloaded Node 24
    const nativeModules = ['skia-canvas'];
    const npmCli = PLATFORM === 'win32'
      ? path.join(nodeDistDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(nodeDistDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

    if (fs.existsSync(npmCli)) {
      const modulesToRebuild = nativeModules.filter(mod =>
        fs.existsSync(path.join(appDir, 'node_modules', mod))
      );

      if (modulesToRebuild.length > 0) {
        console.log(`  ⟳ Rebuilding native modules for ABI ${abi}: ${modulesToRebuild.join(', ')}...`);
        try {
          // Prepend Node 24 binary dir to PATH so child processes
          // also use Node 24, ensuring correct ABI version for native module downloads
          const rebuildEnv = {
            ...process.env,
            PATH: path.dirname(nodeDest) + path.delimiter + process.env.PATH,
          };
          execSync(
            `"${nodeDest}" "${npmCli}" rebuild ${modulesToRebuild.join(' ')} --prefix "${appDir}"`,
            { stdio: 'inherit', timeout: 300000, env: rebuildEnv }
          );
          console.log(`  ✓ Native modules rebuilt for ABI ${abi}`);
        } catch (rebuildErr) {
          console.warn('  ⚠ Native module rebuild failed:', rebuildErr.message);
          console.warn('    Dynamic maps may not work in the binary. Other features will work fine.');
        }
      }
    } else {
      console.warn('  ⚠ npm not found in downloaded Node distribution, skipping native rebuild');
    }

    // 5. Create launcher
    const binDir = path.join(TEMP_DIR, 'bin');
    if (PLATFORM === 'win32') {
      fs.writeFileSync(path.join(binDir, 'tomtom-mcp.cmd'),
        '@echo off\nsetlocal\nset "SCRIPT_DIR=%~dp0"\nset "NODE_PATH=%SCRIPT_DIR%app\\node_modules"\n"%SCRIPT_DIR%runtime\\node.exe" "%SCRIPT_DIR%app\\index.cjs.js" %*\n');
    } else {
      const launcher = path.join(binDir, 'tomtom-mcp');
      fs.writeFileSync(launcher,
        '#!/bin/bash\nSCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\nexport NODE_PATH="$SCRIPT_DIR/app/node_modules"\nexec "$SCRIPT_DIR/runtime/node" "$SCRIPT_DIR/app/index.cjs.js" "$@"\n');
      fs.chmodSync(launcher, 0o755);
    }
    console.log('  ✓ Launcher');

    // 6. Copy manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'manifest-binary.json'), 'utf8'));
    const binaryPath = PLATFORM === 'win32' ? 'bin/tomtom-mcp.cmd' : 'bin/tomtom-mcp';
    manifest.server.entry_point = binaryPath;
    manifest.server.mcp_config.command = '${__dirname}/' + binaryPath;
    fs.writeFileSync(path.join(TEMP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('  ✓ Manifest');

    // 7. Copy images
    const imagesSrc = path.join(PROJECT_ROOT, 'images');
    if (fs.existsSync(imagesSrc)) {
      copyDir(imagesSrc, path.join(TEMP_DIR, 'images'));
    }

    // 8. Clean up download folder before archiving
    const downloadDir = path.join(TEMP_DIR, 'download');
    if (fs.existsSync(downloadDir)) {
      fs.rmSync(downloadDir, { recursive: true });
    }

    // 9. Create mcpb (zip archive)
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (fs.existsSync(OUTPUT_MCPB)) fs.unlinkSync(OUTPUT_MCPB);

    const archiver = require('archiver');
    const output = fs.createWriteStream(OUTPUT_MCPB);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(TEMP_DIR, false);
      archive.finalize();
    });

    const mcpbSize = fs.statSync(OUTPUT_MCPB).size;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  ✓ Created tomtom-maps-mcp-${PLATFORM}-${ARCH}.mcpb (${formatSize(mcpbSize)}) in ${elapsed}s`);

  } finally {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true });
    }
  }
}

main().catch(err => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
