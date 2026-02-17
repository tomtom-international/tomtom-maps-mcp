# Claude Desktop Extensions

Pre-built, self-contained TomTom MCP extensions for Claude Desktop.

Each `.mcpb` file bundles **Node.js 22.x and all native dependencies** (including `canvas` and `maplibre-gl-native` for dynamic maps), so you don't need to install anything.

## Download

Download the extension for your platform from the
[latest GitHub release](https://github.com/tomtom-international/tomtom-mcp/releases/latest):

| Platform              | File                              |
|-----------------------|-----------------------------------|
| macOS (Apple Silicon) | `tomtom-mcp-darwin-arm64.mcpb`    |
| Linux (x64)           | `tomtom-mcp-linux-x64.mcpb`      |
| Windows (x64)         | `tomtom-mcp-win32-x64.mcpb`      |

## Installation

1. Download the `.mcpb` file for your platform from the link above
2. Open **Claude Desktop** → **Settings** → **Extensions**
3. Drag the `.mcpb` file into the window and click **Install**
4. Enter your [TomTom API Key](https://developer.tomtom.com/) when prompted
5. Enable the extension

Dynamic maps are **enabled by default** — no extra setup needed.

## More Info

See [Claude Desktop Setup Guide](../docs/claude-desktop-setup.md) for detailed instructions and troubleshooting.
