# Cursor Integration Guide

This guide explains how to configure Cursor to use the TomTom MCP Server for location-based queries.

## Prerequisites

- Cursor installed
- Node.js 22+
- A valid [TomTom API key](https://developer.tomtom.com/)

## Setup

1. Navigate to Cursor `Settings` > `Tools & Integrations`, then click `Add Custom MCP` and add the following configuration::
    ```json
    {
        "mcpServers": {
            "tomtom-mcp": {
                "command": "npx",
                "args": ["-y", "@tomtom-org/tomtom-mcp@latest"],
                "env": {
                 "TOMTOM_API_KEY": "<your_API_KEY>"
                }
            }
        }
    }
    ```
    
## Alternative Setup: HTTP Mode

You can also run TomTom MCP in HTTP mode separately and connect to it from Cursor:

1. **Run TomTom MCP in HTTP mode**:

   **Using Docker**
   ```bash
   # Run using Docker
   docker run -p 3000:3000 ghcr.io/tomtom-international/tomtom-mcp:latest
   
   # Or with Docker Compose (after cloning the repository)
   docker compose up
   ```

2. **Configure Cursor to connect to the HTTP server**:
   Navigate to Cursor `Settings` > `Tools & Integrations`, then click `Add Custom MCP` and add the following configuration:
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

2. You can see the TomTom MCP tools in Cursor tools menu.

![img.png](../images/cursor.png)

## Troubleshooting

- Ensure **TOMTOM_API_KEY** is valid and active
- Check that the MCP server is running
- Review logs for connection errors
- For HTTP mode, verify your connection URL and port are correct
- When using Docker, make sure the container is running with `docker ps`