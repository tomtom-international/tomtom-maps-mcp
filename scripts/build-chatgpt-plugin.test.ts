import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOSTED_MCP_URL, LOGO_PATH, type PackageMetadata, stageChatGptPlugin, zipDirectory } from './build-chatgpt-plugin';

const pkg: PackageMetadata = {
  version: '1.2.3',
  description: 'Maps for agents',
  homepage: 'https://example.com/home',
  license: 'Apache-2.0',
  repository: { url: 'https://example.com/repo.git' },
};

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plugin-test-'));
  tempDirs.push(dir);
  return dir;
}

function listFiles(dir: string, prefix = ''): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]
    )
    .sort();
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

interface ServerEntry {
  type: string;
  url: string;
  extensions: { 'com.openai': { auth: { type: string } } };
}

function stagedServers(outDir: string): ServerEntry[] {
  return Object.values(readJson<{ mcpServers: Record<string, ServerEntry> }>(path.join(outDir, 'mcp.json')).mcpServers);
}

async function stage(mcpUrl?: string): Promise<string> {
  const outDir = tempDir();
  await stageChatGptPlugin({ pkg, logoPath: LOGO_PATH, outDir, mcpUrl });
  return outDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('stageChatGptPlugin', () => {
  it('stages exactly the manifest, the server config and the logo', async () => {
    expect(listFiles(await stage())).toEqual(['assets/logo.svg', 'mcp.json', 'plugin.json']);
  });

  it('derives the manifest from the package metadata', async () => {
    const manifest = readJson<Record<string, any>>(path.join(await stage(), 'plugin.json'));
    expect(manifest).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'tomtom-maps-mcp',
      version: '1.2.3',
      description: 'Maps for agents',
      homepage: 'https://example.com/home',
      repository: 'https://example.com/repo.git',
      license: 'Apache-2.0',
    });
    expect(manifest.extensions['com.openai'].interface).toEqual({
      displayName: 'TomTom Maps',
      logo: './assets/logo.svg',
    });
  });

  it('copies the square TomTom logo as the icon', async () => {
    const logo = fs.readFileSync(path.join(await stage(), 'assets/logo.svg'), 'utf8');
    expect(logo).toContain('viewBox="0 0 380 380"');
  });

  it('points at the hosted production MCP over OAuth unless told otherwise', async () => {
    const servers = stagedServers(await stage());
    expect(servers).toHaveLength(1);
    expect(servers[0]).toEqual({
      type: 'streamable-http',
      url: HOSTED_MCP_URL,
      extensions: { 'com.openai': { auth: { type: 'oauth' } } },
    });
    expect(HOSTED_MCP_URL).toBe('https://mcp.tomtom.com/maps');
  });

  it('uses the server URL given instead', async () => {
    const servers = stagedServers(await stage('https://mcp-dev.api-system.tomtom.com/maps'));
    expect(servers[0].url).toBe('https://mcp-dev.api-system.tomtom.com/maps');
  });

  it('rejects a server URL that is not https', async () => {
    await expect(stage('http://localhost:3000/mcp')).rejects.toThrow('MCP_URL must be an https URL');
  });
});

describe('zipDirectory', () => {
  it('writes a zip that lists the staged files at its root', async () => {
    const zipPath = path.join(tempDir(), 'plugin.zip');
    await zipDirectory(await stage(), zipPath);
    const zip = fs.readFileSync(zipPath);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    for (const name of ['plugin.json', 'mcp.json', 'assets/logo.svg']) {
      expect(zip.includes(Buffer.from(name)), `${name} listed in the zip`).toBe(true);
    }
  });
});
