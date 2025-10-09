# WinSurf Integration Guide

This guide explains how to configure WinSurf to use the TomTom MCP Server for location-based queries.

## Prerequisites

- WinSurf installed
- Node.js 22+ (For STDIO)
- Docker Setup Required (For HTTP)
- A valid [TomTom API key](https://developer.tomtom.com/)

## Setup

1. Add the below configuration to your` ~/.codeium/windsurf/mcp_config.json` file in the WindSurf directory:
   
    ```JSON
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


## Alternative Setup: HTTP Mode

You can also run TomTom MCP in HTTP mode separately and connect to it from WinSurf:

1. **Run TomTom MCP in HTTP mode**:

   **Using Docker**
   ```bash
   # Run using Docker
   docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-mcp:latest
   
   # Or with Docker Compose (after cloning the repository)
   docker compose up
   ```

2. **Configure WinSurf to connect to the HTTP server**:
   Update your `~/.codeium/windsurf/mcp_config.json` file with the following:
   ```json
   {
     "mcpServers": {
       "tomtom-mcp": {
         "url": "http://localhost:3000/mcp",
         "headers": {
           "Authorization": "Bearer <your_API_KEY>"
         }
       }
     }
   }
   ```

![img.png](../images/windsurf_tools.png)

## Test It

Use WinSurf's integration features to query the MCP server for map, routing, or search data.

## Troubleshooting

- Ensure `TOMTOM_API_KEY` is valid and active
- Check that the MCP server is running
- Review WinSurf logs for connection issues
- For HTTP mode, verify your connection URL and port are correct
- When using Docker, make sure the container is running with `docker ps`