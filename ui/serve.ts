#!/usr/bin/env npx tsx
/**
 * Simple host for TomTom MCP Apps.
 *
 * - Host server (port 8080): serves the UI
 * - Sandbox server (port 8081): serves sandbox.html with CSP headers
 *
 * Reads TOMTOM_API_KEY from parent .env automatically.
 */

import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from parent directory (project root)
config({ path: join(__dirname, "..", ".env") });

const HOST_PORT = parseInt(process.env.HOST_PORT || "8080", 10);
const SANDBOX_PORT = parseInt(process.env.SANDBOX_PORT || "8081", 10);
const DIRECTORY = join(__dirname, "dist");

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";
const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || "";
const TOMTOM_BACKEND = process.env.MAPS || "tomtom-orbis-maps";

// ============ Host Server (port 8080) ============
const hostApp = express();
hostApp.use(cors());

hostApp.use((req, res, next) => {
  if (req.path === "/sandbox.html") {
    res.status(404).send("Sandbox is served on a different port");
    return;
  }
  next();
});

hostApp.use(express.static(DIRECTORY));

hostApp.get("/api/servers", (_req, res) => {
  res.json([MCP_SERVER_URL]);
});

// Expose config so the UI can auto-configure without URL params
hostApp.get("/api/config", (_req, res) => {
  res.json({
    apiKey: TOMTOM_API_KEY,
    backend: TOMTOM_BACKEND,
  });
});

hostApp.get("/", (_req, res) => {
  res.redirect("/index.html");
});

// ============ Sandbox Server (port 8081) ============
const sandboxApp = express();
sandboxApp.use(cors());

function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ") || null;
  const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains).join(" ") || null;

  const directives = [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ];

  return directives.join("; ");
}

sandboxApp.get(["/", "/sandbox.html"], (req, res) => {
  let cspConfig: McpUiResourceCsp | undefined;
  if (typeof req.query.csp === "string") {
    try {
      cspConfig = JSON.parse(req.query.csp);
    } catch (e) {
      console.warn("[Sandbox] Invalid CSP query param:", e);
    }
  }

  const cspHeader = buildCspHeader(cspConfig);
  res.setHeader("Content-Security-Policy", cspHeader);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(join(DIRECTORY, "sandbox.html"));
});

sandboxApp.use((_req, res) => {
  res.status(404).send("Only sandbox.html is served on this port");
});

// ============ Start ============
hostApp.listen(HOST_PORT, () => {
  console.log(`\n  TomTom MCP App Host`);
  console.log(`  ────────────────────────────────────`);
  console.log(`  Host UI:       http://localhost:${HOST_PORT}`);
  console.log(`  Sandbox:       http://localhost:${SANDBOX_PORT}`);
  console.log(`  MCP Server:    ${MCP_SERVER_URL}`);
  console.log(`  Backend:       ${TOMTOM_BACKEND}`);
  console.log(`  API Key:       ${TOMTOM_API_KEY ? TOMTOM_API_KEY.slice(0, 6) + "..." : "NOT SET"}`);
  console.log(`  ────────────────────────────────────\n`);
});

sandboxApp.listen(SANDBOX_PORT, () => {});
