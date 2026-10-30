# TomTom Maps MCP Server

[![NPM Version](https://img.shields.io/npm/v/@tomtom-org/tomtom-mcp.svg)](https://www.npmjs.com/package/@tomtom-org/tomtom-mcp)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The **TomTom Maps MCP Server** simplifies geospatial development by providing seamless access to TomTom’s location services, including search, routing, traffic and interactive maps. It enables easy integration of precise and accurate geolocation data into AI workflows and development environments.

## Demo

![TomTom Maps MCP Demo](./images/claude_demo.gif)

## Table of Contents

- [Demo](#demo)
- [Security Notice](#security-notice)
- [Remote MCP Server (No Installation Required)](#remote-mcp-server-no-installation-required)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Usage](#usage)
- [Integration Guides](#integration-guides)
- [Available Tools](#available-tools)
  - [How dynamic map tool works](#how-dynamic-map-tool-works)
  - [Getting geometry out of a tool response](#getting-geometry-out-of-a-tool-response)
- [Debug UI](#debug-ui)
- [Local Development](#local-development)
  - [Setup](#setup)
  - [Testing](#testing)
  - [Testing Requirements](#testing-requirements)
  - [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
  - [API Key Issues](#api-key-issues)
  - [Test Failures](#test-failures)
  - [Build Issues](#build-issues)
- [Contributing \& Feedback](#contributing--feedback)
- [Security](#security)
- [License](#license)

---

## Remote MCP Server (No Installation Required)

> **Public Preview** — The TomTom Maps Remote MCP Server is currently in public preview.

The easiest way to get started is to connect directly to TomTom's hosted MCP Server — no Node.js, Docker, or local setup needed.

**Endpoint:**
```
https://mcp.tomtom.com/maps
```

**Prerequisites:**
- A valid TomTom API key with MCP Server access enabled (see [API Key Management](https://developer.tomtom.com/platform/documentation/dashboard/api-key-management))

### Generic MCP Client Configuration

Add the following to your MCP client configuration:

```json
{
  "mcpServers": {
    "tomtom-mcp": {
      "type": "http",
      "url": "https://mcp.tomtom.com/maps",
      "headers": {
        "tomtom-api-key": "your_api_key_here"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Create or edit `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "tomtom-mcp": {
      "type": "http",
      "url": "https://mcp.tomtom.com/maps",
      "headers": {
        "tomtom-api-key": "your_api_key_here"
      }
    }
  }
}
```

### Claude Desktop

The quickest option is to install the pre-built extension — see the [Claude Desktop Setup guide](./docs/claude-desktop-setup.md) for details.

Alternatively, configure Claude Desktop to use the remote server directly by editing your configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tomtom-mcp": {
      "type": "http",
      "url": "https://mcp.tomtom.com/maps",
      "headers": {
        "tomtom-api-key": "your_api_key_here"
      }
    }
  }
}
```

> **Note:** If your MCP client does not support remote HTTP connections with custom headers, use the [local setup](#quick-start) instead.

---

## Security Notice

Keeping local deployments of the TomTom Maps MCP Server up-to-date is the responsibility of the MCP client/operator. TomTom publishes updates to address known vulnerabilities, but failing to apply updates, patches, or recommended security configurations to your local instance may expose it to known vulnerabilities.

## Quick Start

### Prerequisites
- Node.js 22.x
- TomTom API key

**How to obtain a TomTom API key**: 
1. Create a developer account on [TomTom Developer Portal](https://my.tomtom.com/) and Sign-in
2. Go to **API & SDK Keys** in the left-hand menu.
3. Click the **red Create Key** button.
4. Select all available APIs to ensure full access, assign a name to your key, and click **Create**.


For more details, visit the [TomTom API Key Management Documentation](https://developer.tomtom.com/platform/documentation/dashboard/api-key-management).


### Installation
```bash
npm install @tomtom-org/tomtom-mcp@latest

# or run directly without installing
npx @tomtom-org/tomtom-mcp@latest
```
---

### Configuration
Set your TomTom API key using one of the following methods:

```bash
# Option 1: Use a .env file (recommended)
echo "TOMTOM_API_KEY=your_api_key" > .env

# Option 2: Environment variable
export TOMTOM_API_KEY=your_api_key

# Option 3: Pass as CLI argument
TOMTOM_API_KEY=your_api_key npx @tomtom-org/tomtom-mcp@latest
```

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TOMTOM_API_KEY` | Your TomTom API key | - |
| `PORT` | Port for the HTTP server | `3000` |
| `LOG_LEVEL` | Logging level: `debug`, `info`, `warn`, or `error`. Use `debug` for local development to see all logs | `info` |
| `MCP_APPS` | Stdio only. `false` gives the client only the data tools, without maps; `true` gives every tool. Unset, the client's `initialize` decides. Over HTTP, use `?apps=` on the MCP URL (see [Clients without MCP apps](#clients-without-mcp-apps)) | - |

---

### Usage

**Stdio Mode (Default - for AI assistants like Claude):**
```bash
# Start MCP server via stdio
npx @tomtom-org/tomtom-mcp@latest
```

**HTTP Mode (for web applications and API integration):**
```bash
pnpm run build            # Build first (required)
pnpm run start:http
# or run the built binary directly
node bin/tomtom-mcp-http.js
```

When running in HTTP mode, you need to include your API key in the `tomtom-api-key` header:

```
tomtom-api-key: <API_KEY>
```

For example, to make a request using curl:
```bash
curl --location 'http://localhost:3000/mcp' \
--header 'Accept: application/json,text/event-stream' \
--header 'tomtom-api-key: <API KEY>' \
--header 'Content-Type: application/json' \
--data '{
  "method": "tools/call",
  "params": {
    "name": "tomtom-locate-place",
    "arguments": {
        "query": "Amsterdam Central Station"
    }
  },
  "jsonrpc": "2.0",
  "id": 24
}'
```

The Docker setup is also configured to use this HTTP mode with the same authentication method.

**Docker Mode (recommended):**
```bash
# Option 1: Using docker run directly
docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-maps-mcp:latest

# Option 2: Using Docker Compose (recommended for development)
# Clone the repository first
git clone https://github.com/tomtom-international/tomtom-maps-mcp.git
cd tomtom-maps-mcp

# Start the service
docker compose up
```

Both Docker options run the server in HTTP mode. Pass your API key via the `tomtom-api-key` header as shown in the [HTTP Mode](#usage) curl example above.

---

## Integration Guides
TomTom Maps MCP Server can be easily integrated into various AI development environments and tools.

These guides help you integrate the MCP server with your tools and environments:
- [Claude Desktop Setup](./docs/claude-desktop-setup.md) - Instructions for configuring Claude Desktop to work with TomTom Maps MCP server
- [VS Code Setup](./docs/vscode-setup.md) - Setting up a development environment in Visual Studio Code
- [Cursor AI Integration](./docs/cursor-setup.md) - Guide for integrating TomTom Maps MCP server with Cursor AI
- [Windsurf Integration](./docs/windsurf-setup.md) - Instructions for configuring Windsurf to use TomTom Maps MCP server
- [Smolagents Integration](./docs/smolagents/smolagents-setup.md) - Example showing how to connect Smolagents AI agents to TomTom Maps MCP server.

---

## Available Tools

| Tool | Description | Documentation |
|------|-------------|---------------|
| `tomtom-discover-places` | Find places anywhere, in an area, or near a point — one tool with a `where` scope (`within` / `nearby` / `maxDetour` / `global`), natural-language category and charger filters, stops along a drive in route order or by detour, and whether each place is open now | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/fuzzy-search |
| `tomtom-locate-place` | Resolve one named place or address to coordinates, optionally with its boundary polygon | https://developer.tomtom.com/geocoding-api/documentation/tomtom-orbis-maps/geocode |
| `tomtom-reverse-geocode` | Reverse geocoding: coordinates → address | https://developer.tomtom.com/reverse-geocoding-api/documentation/tomtom-orbis-maps/v2/reverse-geocode |
| `tomtom-poi-categories` | Browse POI category codes (optional — `tomtom-discover-places` resolves natural language itself) | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/poi-categories |
| `tomtom-plan-route` | Route through an ordered list of locations, each given by name or coordinates, with the roads, countries, speed limits, turns, curves, turn-by-turn directions, the delay against usual traffic, and differences between alternatives | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/calculate-route |
| `tomtom-get-traffic` | Traffic incidents in a named area, a bounding box, a radius around a place, or a corridor along a drive, given in `where`, with counts by category and road | https://developer.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/incident-details |
| `tomtom-dynamic-map` | Interactive map with markers, routes and polygons, rendered by the MCP app | https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/vector-style |
| `tomtom-data-viz` | Visualize a GeoJSON dataset — markers, heatmaps, clusters, choropleths — from a URL or inline data | https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/vector-style |

Every data tool returns the model a trimmed projection and, in the same result's
`_meta`, the data its MCP app draws client-side. The server
keeps none of it. See [docs/tools-architecture.md](./docs/tools-architecture.md)
for the full round trip, and why four tools are hidden from the model.

A removed or replaced tool is no longer listed, but calling it by name still returns an error that names the tool to use instead and how its inputs map, or says why none does. The error's `details` hold the tool, the last release that listed it, and `replacedBy`: the replacements your client is offered.

---

### How dynamic map tool works
The dynamic map tool renders nothing server-side. It resolves the request into map state — the basemap style to load, the viewport to open on, and GeoJSON sources and layers for the markers, routes and polygons requested — calculating any `routePlans` through the Routing API along the way.

The tool hands that state to the MCP app inside its result, with long route lines simplified to fit. When a host drops it, the app shows an error rather than calling TomTom a second time. The app draws the map client-side, so panning, zooming and clicking work on a live map.

Because the map is drawn by the app, the visual requires an MCP client that supports MCP apps. A client the server knows renders no MCP apps, such as Claude Code, Gemini CLI, Cline or Zed, does not get `tomtom-dynamic-map`, `tomtom-data-viz`, the app-only tools or `show_ui` at all (see [Clients without MCP apps](#clients-without-mcp-apps)). Any other client without MCP apps receives a JSON summary of what the map shows: its view, markers, routes (distance, travel time, traffic delay) and areas.

#### Clients without MCP apps

When a client connects, its `initialize` request decides what it gets, over stdio and HTTP alike:

| The client | Gets |
| --- | --- |
| advertises the MCP Apps extension (`io.modelcontextprotocol/ui` with `text/html;profile=mcp-app`): Claude (web, desktop, mobile), ChatGPT, VS Code, Cursor, Goose Desktop | every tool, with maps |
| is known to render no MCP apps, by its `clientInfo.name`: Claude Code, Gemini CLI, Cline, Zed, Goose CLI, Continue, Amazon Q CLI, opencode, Roo Code | the data tools only, without `show_ui`, app resources or the `_meta` the apps read |
| neither | every tool, as before: some clients render apps without advertising the extension |

The HTTP server keeps no state, so its `initialize` response returns an `Mcp-Session-Id` of the form `<apps>.<client>.<uuid>` recording this classification and the client's `clientInfo.name`, base64url-encoded (or `unknown` without one), and the client sends it with every later request. The name is also reported as `client` in the `TomTom-Upstream-Metadata` response header, next to `auth_method`, for the gateway's analytics.

A client can also choose for itself, which is useful for a headless agent or a client in the last row. Over HTTP, add `?apps=false` to the MCP URL (for example `https://mcp.tomtom.com/maps?apps=false`) for the data tools only, or `?apps=true` for every tool. Over stdio, set `MCP_APPS=false` or `MCP_APPS=true` in the server's environment.

The map apps load MapLibre GL JS from `https://cdn.jsdelivr.net` rather than bundling it, so the client must be able to reach jsDelivr as well as `api.tomtom.com`. Both are declared in the apps' content security policy. MapLibre's worker is bundled into each app instead, because ChatGPT's sandbox allows workers only from `blob:` URLs.

References:
- TomTom Orbis Maps style: https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/vector-style

---

### Getting geometry out of a tool response

Every tool that returns TomTom data accepts a `response_detail` parameter (all but `tomtom-poi-categories`, `tomtom-dynamic-map` and `tomtom-data-viz`). The three tools that return geometry (`tomtom-plan-route`, `tomtom-get-traffic` and `tomtom-locate-place`) accept three values; the others accept `compact` and `full`.

| Value | Returns |
| --- | --- |
| `compact` (default) | Essential fields and the point coordinates of a place. No geometry: route lines, traffic incident locations and boundary polygons are omitted. |
| `geometry` | `compact`, plus a `geometry` key holding that geometry as a GeoJSON FeatureCollection. |
| `full` | The raw API response: lossless, in the API's own shape, and many times larger. |

The default is tuned for conversational use, where a route line would consume most of a model's context for no benefit. If you are building on top of the server and need the coordinates themselves, to draw the result on your own map or run your own analysis, request `response_detail: "geometry"`. Use `full` only when you need fields that `compact` drops, or the exact line.

For an Amsterdam-to-Berlin route, `geometry` is about 22 KB: the 8,000-point line is simplified to 1,000 vertices, at most 13 m from the original. `full` is about 210 KB.

#### The `geometry` FeatureCollection

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "summary": { "lengthInMeters": 663425, "travelTimeInSeconds": 24453 } }
    }
  ],
  "geometry": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": { "type": "LineString", "coordinates": [[4.90413, 52.36761], [4.90419, 52.36755]] },
        "properties": {
          "route": 0,
          "simplification": { "original_points": 8151, "points": 1000, "max_error_m": 13 }
        }
      }
    ]
  }
}
```

- **Coordinates** follow [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946): `[longitude, latitude]`, rounded to 5 decimal places (about 1.1 m). Polygon rings are closed.
- **One feature per item.** Its `properties` hold only a join key giving the item's position in the rest of the response. A join key is valid within one response only; don't store it as an identifier.

  | Tool | Features | `properties` |
  | --- | --- | --- |
  | Plan route | One `LineString` per route | `{"route": 0}` |
  | Get traffic | One `Point` or `LineString` per incident, as the API returns it | `{"incident": 12}`, matching `incidents[12]` |
  | Locate place | The place's boundary `Polygon` or `MultiPolygon`, or its `Point` when it has none | `{"place": 0}` |

- **At most 1,000 vertices per feature.** Longer lines are simplified, and the feature then carries `simplification`: the original and returned vertex counts, and `max_error_m`, an upper bound in whole metres on the distance between a dropped vertex and the returned line, including the shift from rounding coordinates to 5 decimals. A long route is accurate at the zoom that shows all of it, but visibly approximate when zoomed in; if `max_error_m` is too large for your use, request `full`. A polygon that would cross itself after simplification keeps more vertices instead, so it can exceed 1,000.
- **No vertex indexes.** Route sections and legs point into the API's original line, which a simplified line no longer matches, so `geometry` responses drop `startPointIndex`, `endPointIndex` and `pointIndex`.

The design is recorded in [docs/adr/](docs/adr/README.md).

> **Note:** Hosts that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) render the interactive map widget from the untrimmed response regardless of this setting, so `compact` loses nothing visually. The `show_ui` parameter requests that widget and is ignored by hosts that cannot render it. It adds no coordinates to the text response: the widget's data, coordinates included, travels in the result's `_meta` for the host to pass to the widget. That field is the result's only `_meta`. The text carries `show_ui`, and the tool name when the result has app data, so a host that drops the result `_meta` can still hide the map. For coordinates in the response itself, use `response_detail: "geometry"`. Clients known to render no MCP apps don't get the parameter.

---
## Debug UI

A built-in debug UI lets you visually test MCP tools and their interactive map widgets without needing an AI client.

### Quick Start
```bash
pnpm run ui
```

This starts both the MCP HTTP server (port 3000) and the debug UI host (port 8080). Open [http://localhost:8080](http://localhost:8080) in your browser.

### Features
- **Tool browser** — searchable sidebar listing all available tools, with icons distinguishing map-enabled tools from plain tools
- **Pre-filled examples** — each tool loads with example parameters (including `show_ui: true` for map widgets)
- **Live map widgets** — tools with UI resources render interactive TomTom maps directly in the browser
- **Response metadata** — latency, payload size, estimated token count, content parts, and timestamps for every call
- **Dark / light mode** — toggle with the theme button or follows system preference
- **Keyboard shortcuts** — `Cmd+Enter` to run, `Cmd+K` to search tools

### Requirements
- The MCP server must be running in HTTP mode (handled automatically by `pnpm run ui`)
- A valid `TOMTOM_API_KEY` in your `.env` file

### Building the UI separately
The UI host is a workspace package (`tomtom-mcp-app-host` in `ui/`), so the root `pnpm install` already installed its dependencies.
```bash
pnpm run ui:build                              # Build the UI
pnpm --filter tomtom-mcp-app-host start        # Start only the UI host (assumes MCP server is already running)
```

---

## Local Development

> This project uses [pnpm](https://pnpm.io) (`>=11`) as its package manager. Install it with `npm install -g pnpm` or `corepack enable`. Linting and formatting are handled by [Biome](https://biomejs.dev).

### Setup
```bash
git clone https://github.com/tomtom-international/tomtom-maps-mcp.git

cd tomtom-maps-mcp

pnpm install

cp .env.example .env      # Add your API key in .env

pnpm run build            # Build TypeScript files

node ./bin/tomtom-mcp.js   # Start the MCP server

```

### Testing
```bash
pnpm run build              # Build TypeScript
pnpm test                   # Run all tests
pnpm run test:all           # All tests (unit + stdio + http)
```
---

### Testing Requirements
⚠️ **Important**: The tests require a valid API key in `.env`: the service and tool tests make real API calls, which consume your API quota.

### OAuth end-to-end test

`pnpm run test:e2e:oauth` connects to the deployed MCP server with the MCP SDK client, the library the connectors are built on, and follows the same path a connector does: the server's 401 names the authorization server, the SDK discovers it and opens the authorize request, a browser picks the sign-in tenant and logs the test user in, the SDK redeems the code, and the session calls a tool with the token. It runs for every account and connector of a target, with the same connectors on both targets, so a change on `dev` is checked the way real users will meet it on `prod`.

| Target | MCP server | Authorization server it must advertise | Connectors | Last step |
| --- | --- | --- | --- | --- |
| `prod` (default) | `mcp.tomtom.com/maps` | `oauth.my.tomtom.com` | ChatGPT, Claude | locate-place returns a result |
| `dev` | `mcp-dev.api-system.tomtom.com/maps` | `staging.oauth.my.tomtom.com` | ChatGPT, Claude | locate-place returns a key rejection |
| `local` | `localhost:3000/mcp`, started by you | `staging.oauth.my.tomtom.com` | the test client dev serves | locate-place returns a key rejection |

The authorization server is discovered from the MCP server, never configured in the test; the test only asserts that the discovered one is the expected one, so a deployment pointing at the wrong ULS instance fails in the first step with that message. The connectors are the registered redirect URIs of ChatGPT and Claude; the sign-in tenant is chosen on the ULS page the way a user does, with no `tenant` shortcut.

On `dev` the last step proves the key exchange and not the tool result: most API services behind ULS staging are not fully functional, so the locate-place call comes back with a key rejection, and that rejection is what the test asserts.

Select the target with `OAUTH_E2E_TARGET`. Accounts come from the environment, `.env` locally. A missing pair skips that account locally and fails the run in CI, so a misconfigured secret can never pass.

- `E2E_B2B_EMAIL`, `E2E_B2B_PASSWORD`: workforce user, `prod` only. The workforce tenant holds no resource app for the dev origin yet, so that login cannot succeed on `dev`.
- `E2E_B2C_PROD_EMAIL`, `E2E_B2C_PROD_PASSWORD`: external user on `prod`.
- `E2E_B2C_DEV_EMAIL`, `E2E_B2C_DEV_PASSWORD`: external user on `dev` and `local`.

On `prod` and `dev` the test needs no server running and starts none. The browser resolves the connectors' redirect hosts to `127.0.0.1`, so a captured authorization code never reaches a third party.

`local` checks the OAuth path of a build on this machine without a dev deployment. Start the server with the `env` block of the dev deployment in `tomtom-mcp-infra` (`.kaap/helm/dev/app.yaml`), leaving out `MCP_BASE_URL` and `MCP_BASE_URL_PATH` so it advertises itself as `localhost`, then run the test against it:

```bash
AUTHORIZATION_SERVER_URL=... ULS_TOKEN_ENDPOINT=... ULS_CLIENT_ID=... CIAM_TENANT_ID=... CIAM_DOMAIN=... WORKFORCE_TENANT_ID=... OAUTH_AUDIENCE=... pnpm run dev:http
OAUTH_E2E_TARGET=local pnpm run test:e2e:oauth
```

`OAUTH_AUDIENCE` is the comma-separated list of application IDs of the Entra resource apps the tokens are issued for. It is required whenever `CIAM_TENANT_ID` and `CIAM_DOMAIN` are set; the server refuses to start without it.

ChatGPT and Claude cannot reach a local server, so `local` logs in through the test client that `dev` serves at `/maps/inspector-client.json`, registered on ULS staging with a loopback redirect. That is why `local` depends on `dev` being up, and why the workforce account is left out: the dev origin has no workforce resource app.

In CI it runs from `tomtom-internal/tomtom-mcp-infra` (workflow `oauth-e2e.yml`) on TomTom's self-hosted runners, because the workforce service account may only sign in from a TomTom IP and `tomtom-international` has no such runners. That private repository holds the account secrets and checks out `main` of this one. It runs on a schedule against `prod`, after every dev or prod image bump in that repository once the rollout serves the new image, and on demand for either target. Scheduled and bump runs post to Slack only when the outcome changes.

### Project Structure
```
src/
├── apps/              # MCP App sources, built to dist/apps/
├── schemas/           # Zod input shapes (the model-facing contract)
├── services/          # TomTom API wrappers, API-key resolution, GeoJSON summaries
├── tools/
│   ├── tool-registry.ts   # one row per tool — start here
│   ├── register.ts        # the only registerAppTool call
│   ├── services/          # per-tool handlers
│   └── shared/            # the data-tool pipeline, trimmers, resources
├── types/             # TypeScript type definitions
├── utils/             # Utilities
├── createServer.ts    # MCP Server creation logic
├── index.ts           # Main entry point (stdio)
└── indexHttp.ts       # HTTP server entry point
```

**Adding or changing a tool?** Read [docs/tools-architecture.md](./docs/tools-architecture.md)
for how the tool layer and the MCP apps fit together, then follow
[Adding_new_tools.md](./Adding_new_tools.md). A tool is one row in
`src/tools/tool-registry.ts`.
---
## Troubleshooting

### API Key Issues
```bash
echo $TOMTOM_API_KEY  # Check if set
```

### Test Failures
```bash
ls -la .env          # Verify .env exists
cat .env             # Check API key
```

### Build Issues
```bash
pnpm run build           # Rebuild
pnpm store prune         # Clear cache
```
### Unauthorized (401) and Forbidden (403) Errors
"TomTom rejected the API key as missing or invalid" is a 401: TomTom does not know the key. Check `TOMTOM_API_KEY`, or the `tomtom-api-key` header your client sends, or reconnect to the hosted server to sign in again.

"TomTom refused this request for the API key" is a 403: the key is valid, but the key or its account may not make the request. Either:
- The account has used up its free requests for that API. See the free allowances on the [pricing page](https://docs.tomtom.com/pricing).
- The account's plan does not include that API. See the plans on the [pricing page](https://docs.tomtom.com/pricing).
- The API is not among the key's products. Log in to the [TomTom Developer Portal](https://my.tomtom.com/) and check that your API key has every product this server uses: Search, Geocoding, Reverse Geocoding, Routing, Traffic and Map Display.

---

## Contributing & Feedback

We welcome contributions to the TomTom Maps MCP Server! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to submit pull requests, report issues, and suggest improvements.

All contributions must adhere to our [Code of Conduct](https://github.com/tomtom-international/.github/blob/main/CODE_OF_CONDUCT.md) and be signed-off according to the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).

Open issues on the [GitHub repo](https://github.com/tomtom-international/tomtom-maps-mcp/issues)

## Security

Please see our [Security Policy](https://github.com/tomtom-international/.github/blob/main/SECURITY.md) for information on reporting security vulnerabilities and our security practices.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE.md](LICENSE.md) file for details.

Copyright (C) 2025 TomTom Navigation B.V.
