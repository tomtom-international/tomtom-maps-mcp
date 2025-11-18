# TomTom MCP Server

[![NPM Version](https://img.shields.io/npm/v/@tomtom-org/tomtom-mcp.svg)](https://www.npmjs.com/package/@tomtom-org/tomtom-mcp)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The **TomTom MCP Server** simplifies geospatial development by providing seamless access to TomTom’s location services, including search, routing, traffic and static maps data. It enables easy integration of precise and accurate geolocation data into AI workflows and development environments.

## Demo

![TomTom MCP Demo](./images/claude_demo.gif)

## Table of Contents

- [Demo](#demo)
- [Security Notice](#security-notice)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Usage](#usage)
- [Integration Guides](#integration-guides)
- [Available Tools](#available-tools)
  - [TomTom Orbis Maps (optional backend)](#tomtom-orbis-maps-optional-backend)
  - [How dynamic map tool works](#how-dynamic-map-tool-works)
- [Contributing \& Local Development](#contributing--local-development)
  - [Setup](#setup)
  - [Testing](#testing)
  - [Testing Requirements](#testing-requirements)
  - [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
  - [Native Dependency Issues](#native-dependency-issues)
  - [Dynamic Map Tool Issues](#dynamic-map-tool-issues)
  - [API Key Issues](#api-key-issues)
  - [Test Failures](#test-failures)
  - [Build Issues](#build-issues)
- [Contributing \& Feedback](#contributing--feedback)
- [Security](#security)
- [License](#license)

---

## Security Notice

Keeping local deployments of the TomTom MCP Server up-to-date is the responsibility of the MCP client/operator. TomTom publishes updates to address known vulnerabilities, but failing to apply updates, patches, or recommended security configurations to your local instance may expose it to known vulnerabilities.

## Quick Start

### Prerequisites
- Node.js 22.x (strict requirement for dynamic map tool, other tools may work with older/newer versions)
- TomTom API key
- OS-level dependencies for MapLibre GL Native:
  - **macOS**: 
    ```bash
    # Install required dependencies via Homebrew
    brew install webp libuv webp icu4c jpeg-turbo glfw
    brew link icu4c --force
    ```
  - **Ubuntu/Debian**: 
    ```bash
    # Install essential dependencies for MapLibre Native rendering
    sudo apt-get install -y libcurl4-openssl-dev libglfw3-dev libuv1-dev \
      libicu-dev libpng-dev libjpeg-turbo8-dev libwebp-dev
    ```
  - **Windows**: Choose one of the two options:
    - **Using Visual Studio**:
      - Install [Visual Studio 2022](https://visualstudio.microsoft.com/) with "Desktop Development with C++"
    - **Using MSYS2**:
      - Install [MSYS2](https://www.msys2.org/), then run:
        ```bash
        pacman -S --needed mingw-w64-x86_64-angleproject mingw-w64-x86_64-curl-winssl \
          mingw-w64-x86_64-glfw mingw-w64-x86_64-icu mingw-w64-x86_64-libjpeg-turbo \
          mingw-w64-x86_64-libpng mingw-w64-x86_64-libwebp mingw-w64-x86_64-libuv
        ```

> 💡 **Note**: For any issues with native dependencies or the dynamic map tool, please refer to the [Troubleshooting](#troubleshooting) section.

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

# option 3: Pass as CLI argument
npx @tomtom-org/tomtom-mcp@latest
```

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TOMTOM_API_KEY` | Your TomTom API key | - |
| `MAPS` | Backend to use: `GENESIS` (TomTom Maps) or `ORBIS` (TomTom Orbis Maps) | `GENESIS` |
| `ENABLE_DYNAMIC_MAPS` | Enable or disable the dynamic maps feature | `false` |

**Note about `ENABLE_DYNAMIC_MAPS`**: 
- By default, the dynamic map tool is **disabled** (`false`) to avoid dependency issues
- Set to `true` to enable dynamic maps after installing required dependencies
- In Docker containers, this is set to `true` by default as all dependencies are pre-installed
---

### Usage

**Stdio Mode (Default - for AI assistants like Claude):**
```bash
# Start MCP server via stdio
npx @tomtom-org/tomtom-mcp@latest
```

**HTTP Mode (for web applications and API integration):**
```bash
npm run start:http
# or after building the project
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
# Note: TomTom Maps is the default backend (same as npm package)
docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-mcp:latest

# To use TomTom Orbis Maps backend instead:
docker run -p 3000:3000 -e MAPS=orbis ghcr.io/tomtom-international/tomtom-mcp:latest

# Option 2: Using Docker Compose (recommended for development)
# Clone the repository first
git clone https://github.com/tomtom-international/tomtom-mcp.git
cd tomtom-mcp

# Start the service (uses TomTom Maps backend by default)
docker compose up
```

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

---

## Integration Guides
2. **Connect via HTTP client**: Send requests to `http://localhost:3000/mcp` with your API key in the `tomtom-api-key` header.
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
| `tomtom-dynamic-map` | Advanced map rendering with custom markers, routes, and traffic visualization | https://developer.tomtom.com/map-display-api/documentation/mapstyles/map-styles-v2 |

---

### TomTom Orbis Maps (optional backend)

By default the MCP tools use TomTom Maps APIs listed above. We also support using TomTom Orbis Maps for the same tools. To enable TomTom Orbis Maps for all tools set the environment variable `MAPS=orbis` 


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
| `tomtom-dynamic-map` | Advanced map rendering with custom markers, routes, and traffic visualization | https://developer.tomtom.com/assets-api/documentation/tomtom-orbis-maps/styles-assets/fetch-style |


Important: TomTom Orbis Maps tools are currently in Public Preview and require explicit enablement for developer accounts. To request access, contact TomTom Sales:

- Public Preview details: https://developer.tomtom.com/public-preview
- Contact Sales to enable TomTom Orbis Maps for your developer account

### How dynamic map tool works
We fetch a Map Style JSON (either from TomTom Maps or TomTom Orbis Maps), then use MapLibre (server-side) to:

- add markers, routes, polygons and other layers defined by the style and request;
- render all layers into an image using that style.

The server converts the rendered image to PNG and returns as Base64 string.

References:
- TomTom Maps Styles v2: https://developer.tomtom.com/map-display-api/documentation/mapstyles/map-styles-v2
- TomTom Orbis Maps style fetch: https://developer.tomtom.com/assets-api/documentation/tomtom-orbis-maps/styles-assets/fetch-style

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

### Native Dependency Issues

If you encounter issues with native dependencies (especially for the dynamic map tool):

1. **Use Docker instead**: Our Docker image includes all required dependencies pre-configured:
   ```bash
   docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-mcp:latest
   
   # or with Docker Compose (recommended for development)
   docker compose up
   ```

2. **Connect via HTTP client**: Send requests to `http://localhost:3000/mcp` with your API key in the `tomtom-api-key` header.

This approach isolates all native dependencies inside the container while providing the same functionality.

### Dynamic Map Tool Issues

By default, the dynamic map tool is **disabled** to avoid native dependency issues. To enable it:

1. **Ensure Node.js 22.x**: The dynamic map tool specifically requires Node.js version 22.x
2. **Install required dependencies**: Follow the platform-specific instructions in the Prerequisites section
3. **Enable dynamic maps**: Set `ENABLE_DYNAMIC_MAPS=true` in your environment or .env file

For detailed build instructions, see the official MapLibre Native documentation:
- [macOS Build Guide](https://maplibre.org/maplibre-native/docs/book/platforms/macos/index.html)
- [Linux Build Guide](https://maplibre.org/maplibre-native/docs/book/platforms/linux/index.html)
- [Windows Build Guide (MSVC)](https://maplibre.org/maplibre-native/docs/book/platforms/windows/build-msvc.html)
- [Windows Build Guide (MSYS2)](https://maplibre.org/maplibre-native/docs/book/platforms/windows/build-msys2.html)

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

Please see our [Security Policy](https://github.com/tomtom-international/.github/blob/main/SECURITY.md) for information on reporting security vulnerabilities and our security practices.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE.md](LICENSE.md) file for details.

Copyright (C) 2025 TomTom NV
