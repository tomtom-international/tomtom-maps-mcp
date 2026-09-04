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
import { build } from 'rolldown';
import type { InlineConfig, Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const APPS_DIR = path.join(ROOT_DIR, 'src/apps');

/** Module whose contents are replaced with the bundled MapLibre worker. */
const WORKER_SOURCE_MODULE = path.join(APPS_DIR, 'shared/maplibre-worker-source.ts');

const require = createRequire(import.meta.url);

let workerSource: Promise<string> | undefined;

/**
 * Bundles MapLibre's worker chunk and the shared chunk it imports into one
 * self-contained module, so it can run from a blob with nothing to fetch.
 * Bundled once and reused across every app build.
 */
function bundleMaplibreWorker(): Promise<string> {
  workerSource ??= build({
    input: require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'),
    platform: 'browser',
    write: false,
    output: { format: 'es', minify: true },
  }).then(({ output }) =>
    output
      .filter((chunk) => chunk.type === 'chunk')
      .map((chunk) => chunk.code)
      .join('\n'),
  );
  return workerSource;
}

/**
 * Hands the bundled worker source to `maplibre-worker-source.ts`, which
 * `useInlinedMaplibreWorker()` turns into the blob MapLibre loads its worker
 * from. Nothing is emitted next to the app, so the bundle stays a single file.
 */
function inlineMaplibreWorker(): Plugin {
  return {
    name: 'inline-maplibre-worker',
    async load(id) {
      const [filePath] = id.split('?');
      if (path.resolve(filePath) !== WORKER_SOURCE_MODULE) return null;
      return `export default ${JSON.stringify(await bundleMaplibreWorker())};`;
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
    plugins: [inlineMaplibreWorker(), viteSingleFile()],
    build: {
      outDir,
      emptyOutDir: true,
      rolldownOptions: { input: htmlPath },
      minify: 'oxc',
    },
  };
}
