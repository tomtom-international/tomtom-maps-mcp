# TomTom MCP Server

[![NPM Version](https://img.shields.io/npm/v/@tomtom-org/tomtom-mcp.svg)](https://www.npmjs.com/package/@tomtom-org/tomtom-mcp)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The **TomTom MCP Server** simplifies geospatial development by providing seamless access to TomTom’s location services, including search, routing, traffic and static maps data. It enables easy integration of precise and accurate geolocation data into AI workflows and development environments.

## Demo

![TomTom MCP Demo](./images/claude_demo.gif)

## Table of Contents

- [TomTom MCP Server](#tomtom-mcp-server)
  - [Demo](#demo)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
    - [Configuration](#configuration)
    - [Usage](#usage)
  - [Integration Guides](#integration-guides)
  - [Available Tools](#available-tools)
    - [Orbis equivalents (optional backend)](#orbis-equivalents-optional-backend)
    - [How dynamic map tool works](#how-dynamic-map-tool-works)
  - [Contributing \& Local Development](#contributing--local-development)
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

## Quick Start

### Prerequisites
- Node.js 22+
- TomTom API key

**How to obtain a TomTom API key**: 
1. Create a developer account on [TomTom Developer Portal](https://developer.tomtom.com/) 
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

# option 3: Pass as CLI argument
npx @tomtom-org/tomtom-mcp@latest --key your_api_key
```
---

### Usage
```bash
# Start MCP server
npx @tomtom-org/tomtom-mcp@latest
# Get help
npx @tomtom-org/tomtom-mcp@latest --help
```

---

## Integration Guides

TomTom MCP Server can be easily integrated into various AI development environments and tools.

These guides help you integrate the MCP server with your tools and environments:
- [Claude Desktop Setup](./docs/claude-desktop-setup.md) - Instructions for configuring Claude Desktop to work with TomTom MCP server
- [VS Code Setup](./docs/vscode-setup.md) - Setting up a development environment in Visual Studio Code
- [Cursor AI Integration](./docs/cursor-setup.md) - Guide for integrating TomTom MCP server with Cursor AI
- [WinSurf Integration](./docs/windsurf-setup.md) - Instructions for configuring WindSurf to use TomTom MCP server
- [Smolagents Integration](./docs/smolagents/smolagents-setup.md) - Example showing how to connect Smolagents AI agents to TomTom MCP server.

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
| `tomtom-dynamic-map` | **Advanced map rendering with custom markers, routes, and traffic visualization** | https://developer.tomtom.com/map-display-api/documentation/mapstyles/map-styles-v2 |

---

### Orbis equivalents (optional backend)

By default the MCP tools use the Genesis TomTom APIs listed above. We also support using the "Orbis" backend for the same tools. To enable Orbis for all tools set the environment variable `MAPS=ORBIS` 


| Tool | Description | Orbis API (documentation) |
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
| `tomtom-dynamic-map` | **Advanced map rendering with custom markers, routes, and traffic visualization** | https://developer.tomtom.com/assets-api/documentation/tomtom-orbis-maps/styles-assets/fetch-style |


Important: Orbis tools are currently in Public Preview and require explicit enablement for developer accounts. To request access, contact TomTom Sales:

- Public Preview details: https://developer.tomtom.com/public-preview
- Contact Sales to enable Orbis for your developer account

### How dynamic map tool works
We fetch a Map Style JSON (either Genesis or Orbis), then use MapLibre (server-side) to:

- add markers, routes, polygons and other layers defined by the style and request;
- render all layers into an image using that style.

The server converts the rendered image to PNG and returns as Base64 string.

References:
- Genesis Map Styles v2: https://developer.tomtom.com/map-display-api/documentation/mapstyles/map-styles-v2
- Orbis style fetch: https://developer.tomtom.com/assets-api/documentation/tomtom-orbis-maps/styles-assets/fetch-style

---
## Contributing & Local Development

### Setup
```bash
git clone <repository>

cd tomtom-mcp

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
npm run test:comprehensive  # Integration tests
```
---

### Testing Requirements
⚠️ **Important**: All tests require a valid API key in `.env` as they make real API calls (not mocked). This will consume your API quota.

### Project Structure
```
src/
├── tools/             # MCP tool definitions
├── services/          # TomTom API wrappers
├── schemas/           # Validation schemas
├── utils/             # Utilities
└── createServer.ts    # MCP Server creation logic
└── index.ts           # Main entry point
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

We welcome contributions to the TomTom MCP Server! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to submit pull requests, report issues, and suggest improvements.

All contributions must adhere to our [Code of Conduct](https://github.com/tomtom-international/.github/blob/main/CODE_OF_CONDUCT.md) and be signed-off according to the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).

Open issues on the [GitHub repo](https://github.com/tomtom-internal/tomtom-mcp/issues)

## Security

Please see our [Security Policy](SECURITY.md) for information on reporting security vulnerabilities and our security practices.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE.md](LICENSE.md) file for details.

Copyright (C) 2025 TomTom NV