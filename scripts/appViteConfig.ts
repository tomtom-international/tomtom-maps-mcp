/**
 * Vite options shared by every MCP App build.
 *
 * The apps ship as a single inlined HTML file (one `ui://` resource each), so
 * this config is what decides that no sibling assets are emitted. The e2e
 * worker test builds through it too, so a change here cannot silently diverge
 * from what that test exercises.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import type { InlineConfig, Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { MAPLIBRE_CDN_ORIGIN } from '../src/tools/helpers/appCsp';

export const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const APPS_DIR = path.join(ROOT_DIR, 'src/apps');

/** Module whose contents are replaced with the URL of MapLibre's CDN worker. */
const WORKER_URL_MODULE = path.join(APPS_DIR, 'shared/maplibre-worker-url.ts');

const require = createRequire(import.meta.url);

/** MapLibre's `dist/` on the CDN, pinned to the installed version the SDK was resolved against. */
export const MAPLIBRE_CDN_DIST = `${MAPLIBRE_CDN_ORIGIN}/npm/maplibre-gl@${require('maplibre-gl/package.json').version}/dist`;

/** The maps-sdk's own MapLibre worker, which Vite emits beside the bundle. */
const SDK_WORKER_ASSET = /^maplibre-gl-worker-[\w-]+\.js$/;

/**
 * Imports MapLibre from the CDN instead of inlining it, which would make up
 * most of every app. The SDK's import resolves to the same module, so both
 * share one MapLibre.
 *
 * MapLibre's worker is pinned to the same CDN by `useCdnMaplibreWorker()`, so
 * the worker the SDK would register is never loaded and is dropped from the
 * output, keeping the bundle a single file.
 */
function loadMaplibreFromCdn(): Plugin {
  return {
    name: 'load-maplibre-from-cdn',
    enforce: 'pre',
    resolveId(source) {
      if (source !== 'maplibre-gl') return null;
      return { id: `${MAPLIBRE_CDN_DIST}/maplibre-gl.mjs`, external: true };
    },
    load(id) {
      const [filePath] = id.split('?');
      if (path.resolve(filePath) !== WORKER_URL_MODULE) return null;
      return `export default ${JSON.stringify(`${MAPLIBRE_CDN_DIST}/maplibre-gl-worker.mjs`)};`;
    },
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (SDK_WORKER_ASSET.test(fileName)) delete bundle[fileName];
      }
    },
  };
}

export interface AppBuildTarget {
  /** Directory Vite treats as the app root. */
  appDir: string;
  /** Entry HTML file. */
  htmlPath: string;
  /** Where the single-file bundle is written. */
  outDir: string;
  logLevel?: InlineConfig['logLevel'];
}

export function appViteConfig({
  appDir,
  htmlPath,
  outDir,
  logLevel = 'error',
}: AppBuildTarget): InlineConfig {
  return {
    root: appDir,
    logLevel,
    resolve: { alias: { '@shared': path.join(APPS_DIR, 'shared') } },
    plugins: [loadMaplibreFromCdn(), viteSingleFile()],
    build: {
      outDir,
      emptyOutDir: true,
      rolldownOptions: { input: htmlPath },
      minify: 'oxc',
    },
  };
}
