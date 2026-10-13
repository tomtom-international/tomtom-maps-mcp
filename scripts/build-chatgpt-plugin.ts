/**
 * Exports the ChatGPT plugin as a zip for upload at chatgpt.com/plugins.
 *
 * The archive holds the plugin manifest, the MCP server entry and the logo;
 * ChatGPT connects to the server URL in `mcp.json`, nothing runs from the
 * archive. The URL defaults to the dev deployment:
 *
 *   pnpm build:chatgpt-plugin
 *   MCP_URL=https://mcp.tomtom.com/maps pnpm build:chatgpt-plugin
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const LOGO_PATH = path.join(ROOT_DIR, 'images/TomTom-logo.svg');
const OUTPUT_ZIP = path.join(ROOT_DIR, 'dist/chatgpt-plugin/tomtom-maps-mcp.zip');
export const DEV_MCP_URL = 'https://mcp-dev.api-system.tomtom.com/maps';
const LOGO_FILE = 'assets/logo.svg';

/** The package.json fields the manifest is derived from. */
export interface PackageMetadata {
  version: string;
  description: string;
  homepage: string;
  license: string;
  repository: { url: string };
}

export interface StageOptions {
  pkg: PackageMetadata;
  logoPath: string;
  outDir: string;
  mcpUrl?: string;
}

export function pluginManifest(pkg: PackageMetadata): Record<string, unknown> {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'tomtom-maps-mcp',
    version: pkg.version,
    description: pkg.description,
    author: { name: 'TomTom', url: 'https://www.tomtom.com/' },
    homepage: pkg.homepage,
    repository: pkg.repository.url,
    license: pkg.license,
    extensions: {
      'com.openai': {
        interface: { displayName: 'TomTom Maps', logo: `./${LOGO_FILE}` },
      },
    },
  };
}

export function serverConfig(mcpUrl: string): Record<string, unknown> {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      'tomtom-maps': {
        type: 'streamable-http',
        url: mcpUrl,
        extensions: { 'com.openai': { auth: { type: 'oauth' } } },
      },
    },
  };
}

function assertHttps(url: string): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {}
  if (parsed?.protocol !== 'https:') {
    throw new Error(`MCP_URL must be an https URL, got "${url}"`);
  }
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function stageChatGptPlugin({ pkg, logoPath, outDir, mcpUrl = DEV_MCP_URL }: StageOptions): Promise<void> {
  assertHttps(mcpUrl);
  fs.mkdirSync(path.join(outDir, path.dirname(LOGO_FILE)), { recursive: true });
  writeJson(path.join(outDir, 'plugin.json'), pluginManifest(pkg));
  writeJson(path.join(outDir, 'mcp.json'), serverConfig(mcpUrl));
  fs.copyFileSync(logoPath, path.join(outDir, LOGO_FILE));
}

export async function zipDirectory(dir: string, zipPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  await new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(dir, false);
    archive.finalize();
  });
}

async function main(): Promise<void> {
  const pkg: PackageMetadata = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const mcpUrl = process.env.MCP_URL ?? DEV_MCP_URL;
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomtom-chatgpt-plugin-'));
  try {
    await stageChatGptPlugin({ pkg, logoPath: LOGO_PATH, outDir: stageDir, mcpUrl });
    await zipDirectory(stageDir, OUTPUT_ZIP);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  console.log(`Created ${path.relative(ROOT_DIR, OUTPUT_ZIP)} (${(fs.statSync(OUTPUT_ZIP).size / 1024).toFixed(0)} KB) → ${mcpUrl}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
