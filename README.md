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
    "name": "tomtom-geocode",
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
| `tomtom-geocode` | Forward geocoding: address → coordinates | https://developer.tomtom.com/geocoding-api/documentation/tomtom-orbis-maps/geocode |
| `tomtom-reverse-geocode` | Reverse geocoding: coordinates → address | https://developer.tomtom.com/reverse-geocoding-api/documentation/tomtom-orbis-maps/v2/reverse-geocode |
| `tomtom-fuzzy-search` | General search with typo tolerance and suggestions | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/fuzzy-search |
| `tomtom-poi-search` | Points of Interest (category-based) search | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/points-of-interest-search |
| `tomtom-nearby` | Find POIs near a coordinate within a radius | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/nearby-search |
| `tomtom-poi-categories` | List the POI categories available for search | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/poi-categories |
| `tomtom-routing` | Calculate optimal route between two points | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/calculate-route |
| `tomtom-reachable-range` | Compute coverage area by time or distance budget | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/calculate-reachable-range |
| `tomtom-traffic` | Traffic incidents and related details | https://developer.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/incident-details |
| `tomtom-dynamic-map` | Interactive map with custom markers, routes and polygons, rendered by the MCP app | https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/vector-style |
| `tomtom-ev-routing` | Plan long-distance EV routes with automatic charging stop optimization | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/long-distance-ev-routing |
| `tomtom-search-along-route` | Find POIs (restaurants, gas stations, hotels, etc.) along a route corridor | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/search-along-route |
| `tomtom-area-search` | Search for places within a geographic area (circle, polygon, or bounding box) | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/geometry-search |
| `tomtom-ev-search` | Find EV charging stations with real-time availability and connector types | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/ev-charging-stations-availability |
| `tomtom-data-viz` | Visualize custom GeoJSON data on an interactive TomTom basemap (markers, heatmaps, clusters, choropleths) | https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/vector-style |

---

### How dynamic map tool works
The dynamic map tool renders nothing server-side. It resolves the request into map state — the basemap style to load, the viewport to open on, and GeoJSON sources and layers for the markers, routes and polygons requested — calculating any `routePlans` through the Routing API along the way.

That state is cached and the tool returns its `viz_id`. The MCP app fetches it with the app-only `tomtom-get-viz-data` tool and draws the map client-side, so panning, zooming and clicking work on a live map.

Because the map is drawn by the app, the visual requires an MCP client that supports MCP apps. Other clients receive a JSON summary of what the map shows: its view, markers, routes (distance, travel time, traffic delay) and areas.

References:
- TomTom Orbis Maps style: https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/vector-style

---

### Getting geometry out of a tool response

Every tool that returns TomTom data accepts a `response_detail` parameter (all but `tomtom-poi-categories`, `tomtom-dynamic-map` and `tomtom-data-viz`). The six tools that return geometry (`tomtom-routing`, `tomtom-ev-routing`, `tomtom-reachable-range`, `tomtom-traffic`, `tomtom-area-search` and `tomtom-search-along-route`) accept three values; the others accept `compact` and `full`.

| Value | Returns |
| --- | --- |
| `compact` (default) | Essential fields and the point coordinates of a place. No geometry: route lines, reachable-range polygons and traffic incident locations are omitted. |
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
  | Routing | One `LineString` per route | `{"route": 0}` |
  | EV routing | One `LineString` per route, then one `Point` per charging stop | `{"route": 0}`, `{"route": 0, "leg": 1}` (the stop at the end of leg 1) |
  | Reachable range | The range `Polygon` for the requested budget | `{"budget_min": 30}`; also `budget_km`, `budget_fuel_l`, `budget_charge_pct`, `budget_remaining_charge_pct` |
  | Traffic | One `Point` or `LineString` per incident, as the API returns it | `{"incident": 12}`, matching `incidents[12]` |
  | Area search | The search boundary `Polygon` | `{"boundary": "circle"}`, `"polygon"` or `"boundingBox"` |
  | Search along route | The route `LineString` | `{"route": 0}` |

- **At most 1,000 vertices per feature.** Longer lines are simplified, and the feature then carries `simplification`: the original and returned vertex counts, and `max_error_m`, an upper bound in whole metres on the distance between a dropped vertex and the returned line, including the shift from rounding coordinates to 5 decimals. A long route is accurate at the zoom that shows all of it, but visibly approximate when zoomed in; if `max_error_m` is too large for your use, request `full`. A polygon that would cross itself after simplification keeps more vertices instead, so it can exceed 1,000.
- **No vertex indexes.** Route sections and legs point into the API's original line, which a simplified line no longer matches, so `geometry` responses drop `startPointIndex`, `endPointIndex` and `pointIndex`.

The design is recorded in [docs/adr/](docs/adr/README.md).

> **Note:** Hosts that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) render the interactive map widget from the untrimmed response regardless of this setting, so `compact` loses nothing visually. The `show_ui` parameter requests that widget and is ignored by hosts that cannot render it; it is not a way to obtain coordinates.

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
⚠️ **Important**: All tests require a valid API key in `.env` as they make real API calls (not mocked). This will consume your API quota.

### Project Structure
```
src/
├── apps/              # MCP App UI resources
├── handlers/          # Request handlers
├── schemas/           # Validation schemas
├── services/          # TomTom API wrappers
├── tools/             # MCP tool definitions
├── types/             # TypeScript type definitions
├── utils/             # Utilities
├── createServer.ts    # MCP Server creation logic
├── index.ts           # Main entry point (stdio)
└── indexHttp.ts       # HTTP server entry point
```
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
### Forbidden (403) Errors
If you see an error stating "missing permissions", it means your API key does not have access to the **TomTom Orbis Maps** or **EV** services, which back all of this server's tools.

**Note:** TomTom Orbis Maps and certain EV routing features are currently in **Public Preview**. They may not be available on all developer accounts by default.

**How to troubleshoot:**
1. Log in to the [TomTom Developer Portal](https://my.tomtom.com/).
2. Ensure **all available products** are selected for your API key.
3. If you still see 403 errors, your account may not yet have access to the Orbis preview — request access via the developer portal.

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
