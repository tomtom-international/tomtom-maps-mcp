# Windsurf Integration Guide

This guide explains how to configure Windsurf to use the TomTom Maps MCP Server for location-based queries.

## Prerequisites

- Windsurf installed
- Node.js 22+ (For STDIO)
- Docker Setup Required (For HTTP)
- A valid [TomTom API key](https://developer.tomtom.com/)

## Setup

1. Add the below configuration to your `~/.codeium/windsurf/mcp_config.json` file:

    ```json
    {
      "mcpServers": {
         "tomtom-mcp": {
            "command": "npx",
            "args": ["-y","@tomtom-org/tomtom-mcp@latest"],
            "env": {
             "TOMTOM_API_KEY": "<your_API_KEY>"
            }
         }
      }
    }
    ```

> **Tip:** To use the TomTom Orbis Maps backend (which includes additional tools like EV routing, search along route, and data visualization), add `"MAPS": "tomtom-orbis-maps"` to the `env` block above. See [Available Tools](../README.md#tomtom-orbis-maps-optional-backend) for details.

## Alternative Setup: HTTP Mode

You can also run TomTom Maps MCP in HTTP mode separately and connect to it from Windsurf:

1. **Run TomTom Maps MCP in HTTP mode**:

   **Using Docker**
   ```bash
   # Run using Docker
   docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-maps-mcp:latest

   # To use TomTom Orbis Maps backend instead:
   docker run -p 3000:3000 -e MAPS=tomtom-orbis-maps ghcr.io/tomtom-international/tomtom-maps-mcp:latest

   # Or with Docker Compose (after cloning the repository)
   docker compose up
   ```

2. **Configure Windsurf to connect to the HTTP server**:
   Update your `~/.codeium/windsurf/mcp_config.json` file with the following:
   ```json
   {
     "mcpServers": {
       "tomtom-mcp": {
         "url": "http://localhost:3000/mcp",
         "headers": {
           "tomtom-api-key": "<your_API_KEY>",
           "tomtom-maps-backend": "tomtom-maps"
         }
       }
     }
   }
   ```

   > **Tip:** Set the `tomtom-maps-backend` header to `tomtom-orbis-maps` to use the Orbis Maps backend (which includes additional tools like EV routing, search along route, and data visualization). This header is only used when the server is started without the `MAPS` env var (dual-backend mode).

![img.png](../images/windsurf_tools.png)

## Test It

Use Windsurf's integration features to query the MCP server for map, routing, or search data.

## Troubleshooting

- Ensure `TOMTOM_API_KEY` is valid and active
- Check that the MCP server is running
- Review Windsurf logs for connection issues
- For HTTP mode, verify your connection URL and port are correct
- When using Docker, make sure the container is running with `docker ps`
