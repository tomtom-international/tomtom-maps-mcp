# Smolagents Integration Guide

This guide explains how to configure smolagents to the TomTom MCP Server for location-based queries. Keep in mind the size of the models you're using for inference before running this locally. 

## Prerequisites

- Node.js 22+
- Python 3.10+
- A valid [TomTom API key](https://developer.tomtom.com/)
- Smolagents installed (```pip install smolagents[toolkit]```)
- Hugging Face User Access Token available

## Setup: Option 1 - Using Stdio Mode

1. Personalize the configuration from line 36 to line 41 in smolagents_example.py:
    ```bash
    # Run server with node
    server_parameters = StdioServerParameters(
        command="npx", 
        args=["-y", "@tomtom-org/tomtom-mcp@latest"], 
        env={
            "TOMTOM_API_KEY": "<your_API_KEY>"}, # replace with your TomTom API key
    )
    ```

2. Run ```python3 smolagents_example.py```

## Setup: Option 2 - Using HTTP Mode (Recommended)

This approach allows you to run the TomTom MCP server independently from your smolagents code, offering better stability and flexibility.

1. **Install the required package for HTTP mode**:
   ```bash
   pip install 'smolagents[mcp]'
   ```

2. **Run TomTom MCP in HTTP mode** using Docker:
   ```bash
   # Run using Docker in the background
   docker run -d -p 3000:3000 ghcr.io/tomtom-international/tomtom-mcp:latest
   
   # Or with Docker Compose (after cloning the repository)
   docker compose up -d
   ```

3. **Create a Python script** to connect to the HTTP server:
   ```python
   from smolagents import ToolCollection

   # Connect to the MCP server running on localhost:3000
   with ToolCollection.from_mcp(
       {"url": "http://localhost:3000/mcp", 
        "headers": {"tomtom-api-key": "<your_API_KEY>"}, 
        "transport": "streamable-http"}, 
       trust_remote_code=True
   ) as collection:
       # List all available tools
       for tool in collection.tools:
           print(tool.name)
           
       # Use the tools in your agent
       # Example: Use geocoding
       # result = collection.tools_dict["tomtom-geocode"].call({"query": "Amsterdam Central Station"})
       # print(result)
   ```

4. Run your Python script.

If configured correctly, the MCP server will fetch results from TomTom APIs.

## Troubleshooting

- Ensure `TOMTOM_API_KEY` is valid and active
- Check that the MCP server is accessible locally
- When using HTTP mode, verify your connection URL and port are correct
- When using Docker, make sure the container is running with `docker ps`
- Ensure that you have access to the smolagents (most models require their own key or a huggingface CLI login)

