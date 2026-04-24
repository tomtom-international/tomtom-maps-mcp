# TomTom Maps MCP Server

[![NPM Version](https://img.shields.io/npm/v/@tomtom-org/tomtom-mcp.svg)](https://www.npmjs.com/package/@tomtom-org/tomtom-mcp)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The **TomTom Maps MCP Server** simplifies geospatial development by providing seamless access to TomTom’s location services, including search, routing, traffic and static maps data. It enables easy integration of precise and accurate geolocation data into AI workflows and development environments.

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
  - [TomTom Orbis Maps (optional backend)](#tomtom-orbis-maps-optional-backend)
  - [How dynamic map tool works](#how-dynamic-map-tool-works)
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

### Selecting a Map Backend

Add the optional `tomtom-maps-backend` header to choose your backend:

**TomTom Maps (default):**
```json
{
  "mcpServers": {
    "tomtom-mcp": {
      "type": "http",
      "url": "https://mcp.tomtom.com/maps",
      "headers": {
        "tomtom-api-key": "your_api_key_here",
        "tomtom-maps-backend": "tomtom-maps"
      }
    }
  }
}
```

**TomTom Orbis Maps:**
```json
{
  "mcpServers": {
    "tomtom-mcp": {
      "type": "http",
      "url": "https://mcp.tomtom.com/maps",
      "headers": {
        "tomtom-api-key": "your_api_key_here",
        "tomtom-maps-backend": "tomtom-orbis-maps"
      }
    }
  }
}
```

If the `tomtom-maps-backend` header is omitted, the server defaults to TomTom Maps.

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
1. Create a developer account on [TomTom Developer Portal](https://developer.tomtom.com/) and Sign-in
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
| `MAPS` | Backend to use: `tomtom-maps` (TomTom Maps) or `tomtom-orbis-maps` (TomTom Orbis Maps) | `tomtom-maps` |
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
npm run build             # Build first (required)
npm run start:http
# or run the built binary directly
node bin/tomtom-mcp-http.js
```

When running in HTTP mode, you need to include your API key in the `tomtom-api-key` header. You can also optionally set the maps backend per-request using the `tomtom-maps-backend` header:

```
tomtom-api-key: <API_KEY>
tomtom-maps-backend: tomtom-maps        # or tomtom-orbis-maps
```

> **Note:** The `tomtom-maps-backend` header is only used when the server is started without the `MAPS` env var (dual-backend mode). If `MAPS` is set at startup, the header is ignored and the server uses the fixed backend.

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
# Note: TomTom Maps is the default backend (same as npm package)
docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-maps-mcp:latest

# To use TomTom Orbis Maps backend instead:
docker run -p 3000:3000 -e MAPS=tomtom-orbis-maps ghcr.io/tomtom-international/tomtom-maps-mcp:latest

# Option 2: Using Docker Compose (recommended for development)
# Clone the repository first
git clone https://github.com/tomtom-international/tomtom-maps-mcp.git
cd tomtom-maps-mcp

# Start the service (uses TomTom Maps backend by default)
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
| `tomtom-geocode` | Convert addresses to coordinates with global coverage | https://developer.tomtom.com/geocoding-api/documentation/geocode |
| `tomtom-reverse-geocode` |  Get addresses from GPS coordinates | https://developer.tomtom.com/reverse-geocoding-api/documentation/reverse-geocode |
| `tomtom-fuzzy-search` | Intelligent search with typo tolerance | https://developer.tomtom.com/search-api/documentation/search-service/fuzzy-search |
| `tomtom-poi-search` | Find specific business categories | https://developer.tomtom.com/search-api/documentation/search-service/points-of-interest-search |
| `tomtom-nearby` | Discover services within a radius | https://developer.tomtom.com/search-api/documentation/search-service/nearby-search |
| `tomtom-routing` | Calculate optimal routes between locations | https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route |
| `tomtom-waypoint-routing` | Multi-stop route planning Routing API | https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route |
| `tomtom-reachable-range` | Determine coverage areas by time/distance | https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-reachable-range |
| `tomtom-traffic` | Real-time incidents data | https://developer.tomtom.com/traffic-api/documentation/traffic-incidents/traffic-incidents-service  |
| `tomtom-static-map` | Generate custom map images | https://developer.tomtom.com/map-display-api/documentation/raster/static-image |
| `tomtom-dynamic-map` | Advanced map rendering with custom markers, routes, and traffic visualization | https://developer.tomtom.com/map-display-api/documentation/raster/map-tile |

---

### TomTom Orbis Maps (optional backend)

By default the MCP tools use TomTom Maps APIs listed above. We also support using TomTom Orbis Maps for the same tools. To enable TomTom Orbis Maps for all tools set the environment variable `MAPS=tomtom-orbis-maps`.

> **Note:** The Orbis Maps backend includes all the tools from TomTom Maps plus additional Orbis-exclusive tools: `tomtom-ev-routing`, `tomtom-search-along-route`, `tomtom-area-search`, `tomtom-ev-search`, and `tomtom-data-viz`. The `tomtom-static-map` tool is only available with the default TomTom Maps backend.


| Tool | Description | TomTom Orbis Maps API (documentation) |
|------|-------------|---------------------------|
| `tomtom-geocode` | Forward geocoding: address → coordinates | https://developer.tomtom.com/geocoding-api/documentation/tomtom-orbis-maps/geocode |
| `tomtom-reverse-geocode` | Reverse geocoding: coordinates → address | https://developer.tomtom.com/reverse-geocoding-api/documentation/tomtom-orbis-maps/reverse-geocode |
| `tomtom-fuzzy-search` | General search with typo tolerance and suggestions | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/fuzzy-search |
| `tomtom-poi-search` | Points of Interest (category-based) search | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/points-of-interest-search |
| `tomtom-nearby` | Find POIs near a coordinate within a radius | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/nearby-search |
| `tomtom-routing` | Calculate optimal route between two points | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/calculate-route |
| `tomtom-waypoint-routing` | Multi-stop / waypoint route planning | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/calculate-route |
| `tomtom-reachable-range` | Compute coverage area by time or distance budget | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/calculate-reachable-range |
| `tomtom-traffic` | Traffic incidents and related details | https://developer.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/incident-details |
| `tomtom-dynamic-map` | Advanced map rendering with custom markers, routes, and traffic visualization | https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/raster-tile |
| `tomtom-ev-routing` | Plan long-distance EV routes with automatic charging stop optimization | https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/long-distance-ev-routing |
| `tomtom-search-along-route` | Find POIs (restaurants, gas stations, hotels, etc.) along a route corridor | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/search-along-route |
| `tomtom-area-search` | Search for places within a geographic area (circle, polygon, or bounding box) | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/geometry-search |
| `tomtom-ev-search` | Find EV charging stations with real-time availability and connector types | https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/search-service/ev-charging-stations-availability |
| `tomtom-data-viz` | Visualize custom GeoJSON data on an interactive TomTom basemap (markers, heatmaps, clusters, choropleths) | https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/raster-tile |



### How dynamic map tool works
The dynamic map tool fetches raster tiles from TomTom (either TomTom Maps or TomTom Orbis Maps), then uses skia-canvas (server-side) to:

- stitch map tiles into a single canvas at the appropriate zoom level;
- add markers, routes, polygons, and other overlays;
- render the final composited image.

The server converts the rendered image to PNG and returns it as a Base64 string.

References:
- TomTom Map Tile API: https://developer.tomtom.com/map-display-api/documentation/raster/map-tile
- TomTom Orbis Maps Tile API: https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/raster-tile

---
## Debug UI

A built-in debug UI lets you visually test MCP tools and their interactive map widgets without needing an AI client.

### Quick Start
```bash
npm run ui
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
- The MCP server must be running in HTTP mode (handled automatically by `npm run ui`)
- A valid `TOMTOM_API_KEY` in your `.env` file
- To see map widgets, use the TomTom Orbis Maps backend (`MAPS=tomtom-orbis-maps` in `.env`)

### Building the UI separately
```bash
npm run ui:build    # Install deps + build the UI
cd ui && npm start  # Start only the UI host (assumes MCP server is already running)
```

---

## Local Development

### Setup
```bash
git clone https://github.com/tomtom-international/tomtom-maps-mcp.git

cd tomtom-maps-mcp

npm install

cp .env.example .env      # Add your API key in .env

npm run build             # Build TypeScript files

node ./bin/tomtom-mcp.js   # Start the MCP server

```

### Testing
```bash
npm run build               # Build TypeScript
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:all            # All tests (unit + stdio + http)
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
npm run build            # Rebuild
npm cache clean --force  # Clear cache
```
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
