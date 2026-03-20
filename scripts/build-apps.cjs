/**
 * Build script for MCP Apps - parallel builds with vite-plugin-singlefile
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const ALL_CATEGORIES = ['search', 'routing', 'traffic', 'map', 'data-viz'];
const ROOT_DIR = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT_DIR, 'src/apps');
const DIST_DIR = path.join(ROOT_DIR, 'dist/apps');

// Parse --category=<name> flag to build only a specific category
const categoryArg = process.argv.find(a => a.startsWith('--category='));
const APP_CATEGORIES = categoryArg
  ? [categoryArg.split('=')[1]]
  : ALL_CATEGORIES;

/**
 * Discover all apps and their entry points
 */
function discoverApps() {
  const apps = [];

  for (const category of APP_CATEGORIES) {
    const categoryDir = path.join(APPS_DIR, category);
    if (!fs.existsSync(categoryDir)) continue;

    const appNames = fs.readdirSync(categoryDir).filter(item =>
      fs.statSync(path.join(categoryDir, item)).isDirectory()
    );

    for (const appName of appNames) {
      const appDir = path.join(categoryDir, appName);
      const htmlPath = path.join(appDir, 'app.html');

      if (fs.existsSync(htmlPath)) {
        apps.push({
          category,
          name: appName,
          id: `${category}/${appName}`,
          htmlPath,
          appDir,
        });
      }
    }
  }

  return apps;
}

/**
 * Build a single app
 */
async function buildApp(app) {
  const { build } = await import('vite');
  const { viteSingleFile } = await import('vite-plugin-singlefile');

  try {
    await build({
      root: app.appDir,
      logLevel: 'error',
      resolve: {
        alias: {
          '@shared': path.join(APPS_DIR, 'shared'),
        },
      },
      plugins: [viteSingleFile()],
      build: {
        outDir: path.join(DIST_DIR, app.id),
        emptyOutDir: true,
        rollupOptions: {
          input: app.htmlPath,
        },
        minify: 'esbuild',  // Much faster than terser (~100x)
      },
    });
    return { app, success: true };
  } catch (error) {
    return { app, success: false, error: error.message };
  }
}

async function main() {
  console.log('Building MCP Apps...\n');
  const startTime = Date.now();

  const apps = discoverApps();
  if (apps.length === 0) {
    console.log('No apps found to build.');
    return;
  }

  // Build all apps in parallel
  const results = await Promise.all(apps.map(buildApp));

  // Report results
  let success = 0, failed = 0;
  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.app.id}`);
      success++;
    } else {
      console.error(`❌ ${result.app.id}: ${result.error}`);
      failed++;
    }
  }

  console.log(`\nBuilt ${success} apps in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
