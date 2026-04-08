#!/usr/bin/env node

/**
 * Retrieves a JWT access token from TomTom's authorization server
 * using the OAuth 2.0 authorization code flow with PKCE.
 *
 * Usage:
 *   CLIENT_ID=your-client-id node scripts/get-token.mjs
 *
 * Optional environment variables:
 *   AUTHORIZATION_SERVER  - defaults to https://access.my.tomtom.com
 *   SCOPES                - defaults to "mcp:tools mcp:resources"
 *   PORT                  - local redirect server port, defaults to 8976
 */

import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { URL, URLSearchParams } from "node:url";

const AUTHORIZATION_SERVER =
  process.env.AUTHORIZATION_SERVER_URL || "https://ulsv2.cx-test.tomtom.com";
const CLIENT_ID = process.env.CLIENT_ID;
const SCOPES = process.env.SCOPES || "openid";
const PORT = parseInt(process.env.PORT || "8976", 10);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID) {
  console.error(
    "Error: CLIENT_ID environment variable is required.\n\n" +
      "Usage:\n  CLIENT_ID=your-client-id node scripts/get-token.mjs\n",
  );
  process.exit(1);
}

// --- PKCE helpers ---

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateCodeVerifier() {
  return base64url(crypto.randomBytes(32));
}

async function generateCodeChallenge(verifier) {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  return base64url(digest);
}

// --- Discovery ---

async function discover() {
  // Try OpenID Connect discovery first, then OAuth authorization server metadata
  const paths = [
    "/.well-known/openid-configuration",
    "/.well-known/oauth-authorization-server",
  ];

  for (const path of paths) {
    try {
      const res = await fetch(`${AUTHORIZATION_SERVER}${path}`);
      if (res.ok) {
        const metadata = await res.json();
        console.log(`Discovered endpoints via ${path}`);
        return metadata;
      }
    } catch {
      // try next
    }
  }

  // Fall back to common defaults
  console.log(
    "Discovery failed — using conventional endpoint paths as fallback.",
  );
  return {
    authorization_endpoint: `${AUTHORIZATION_SERVER}/authorize`,
    token_endpoint: `${AUTHORIZATION_SERVER}/token`,
  };
}

// --- Open browser ---

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      execSync(`open "${url}"`);
    } else if (platform === "win32") {
      execSync(`start "" "${url}"`);
    } else {
      execSync(`xdg-open "${url}"`);
    }
  } catch {
    console.log(`\nCould not open browser automatically. Open this URL:\n`);
    console.log(`  ${url}\n`);
  }
}

// --- Main flow ---

async function main() {
  const metadata = await discover();
  const authEndpoint = metadata.authorization_endpoint;
  const tokenEndpoint = metadata.token_endpoint;

  if (!authEndpoint || !tokenEndpoint) {
    console.error(
      "Could not determine authorization and token endpoints from discovery.",
    );
    process.exit(1);
  }

  console.log(`Authorization endpoint: ${authEndpoint}`);
  console.log(`Token endpoint:         ${tokenEndpoint}`);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("hex");

  // Build authorization URL
  const authUrl = new URL(authEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Start local server to receive the callback
  const tokenPromise = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") || error;
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          `<h2>Authorization failed</h2><p>${desc}</p><p>You can close this tab.</p>`,
        );
        server.close();
        reject(new Error(desc));
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          "<h2>State mismatch</h2><p>Possible CSRF attack. You can close this tab.</p>",
        );
        server.close();
        reject(new Error("State mismatch"));
        return;
      }

      // Exchange code for tokens
      try {
        const tokenRes = await fetch(tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
            client_id: CLIENT_ID,
            code_verifier: codeVerifier,
          }).toString(),
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            `<h2>Token exchange failed</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre><p>You can close this tab.</p>`,
          );
          server.close();
          reject(
            new Error(
              tokenData.error_description || tokenData.error || "Token exchange failed",
            ),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h2>Success!</h2><p>Token retrieved. You can close this tab and return to the terminal.</p>",
        );
        server.close();
        resolve(tokenData);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(
          `<h2>Error</h2><pre>${err.message}</pre><p>You can close this tab.</p>`,
        );
        server.close();
        reject(err);
      }
    });

    server.listen(PORT, () => {
      console.log(`\nListening on http://localhost:${PORT}/callback`);
      console.log("Opening browser for authentication...\n");
      openBrowser(authUrl.toString());
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authorization callback (2 min)"));
    }, 120_000);
  });

  try {
    const tokenData = await tokenPromise;

    console.log("\n--- Token Response ---\n");
    console.log(JSON.stringify(tokenData, null, 2));
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
  }
}

main();
