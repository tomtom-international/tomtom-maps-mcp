# VS Code Integration Guide

This guide explains how to configure VS Code to use the TomTom MCP Server for location-based queries.

## Prerequisites

- VS Code installed with Copilot
- Node.js 22+ (For STDIO)
- Docker Setup Required (For HTTP)
- A valid [TomTom API key](https://developer.tomtom.com/)

## Setup

1. Add the below config in `.vscode/settings.json`:
    ```json
    {
      "servers": {
         "tomtom-mcp": {
            "command": "npx",
            "args": ["-y", "@tomtom-org/tomtom-mcp@latest"],
            "env": {
              "TOMTOM_API_KEY": "<your_API_KEY>"
            }
         }
      }
   }


## Alternative Setup: HTTP Mode

You can also run TomTom MCP in HTTP mode separately and connect to it from VS Code:

1. **Run TomTom MCP in HTTP mode**:

   **Using Docker**
   ```bash
   # Run using Docker
   docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-mcp:latest
   
   # Or with Docker Compose (after cloning the repository)
   docker compose up
   ```

2. **Configure VS Code to connect to the HTTP server**:
   Add the below configuration in `.vscode/settings.json`:
   ```json
   {
     "servers": {
       "tomtom-mcp": {
         "url": "http://localhost:3000/mcp",
         "headers": {
           "Authorization": "Bearer <your_API_KEY>"
         }
       }
     }
   }
   ```

This approach has several advantages:
- Separates the MCP server from VS Code, allowing you to restart either independently
- Useful when using the Docker image to avoid native dependency issues
- Enables sharing one MCP server instance across multiple tools/applications
   
2. You can see the TomTom MCP tools in Copilot tools menu.

![img.png](../images/vscode_tools.png)


## Troubleshooting

- Ensure **TOMTOM_API_KEY** is valid and active
- Check that the MCP server is running
- Review logs for connection errors
- For HTTP mode, verify your connection URL and port are correct
- When using Docker, make sure the container is running with `docker ps`