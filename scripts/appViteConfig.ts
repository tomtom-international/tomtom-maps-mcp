/**
 * Vite options shared by every MCP App build.
 *
 * The apps ship as a single inlined HTML file (one `ui://` resource each), so
 * this config is what decides that no sibling assets are emitted. The e2e
 * worker test builds through it too, so a change here cannot silently diverge
 * from what that test exercises.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import type { InlineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const APPS_DIR = path.join(ROOT_DIR, 'src/apps');

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
    plugins: [viteSingleFile()],
    build: {
      outDir,
      emptyOutDir: true,
      rolldownOptions: { input: htmlPath },
      minify: 'oxc',
    },
  };
}
