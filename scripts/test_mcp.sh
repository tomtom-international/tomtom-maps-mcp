#!/usr/bin/env bash
#
# Fire a sequence of MCP requests against a deployed endpoint.
#
# Usage:
#   ./scripts/test_mcp.sh <api_key> [endpoint]
#
# Example:
#   ./scripts/test_mcp.sh sk_live_abc123
#   ./scripts/test_mcp.sh sk_live_abc123 https://mcp-dev.api-system.tomtom.com/maps

set -euo pipefail

API_KEY="${1:?Usage: $0 <api_key> [endpoint]}"
ENDPOINT="${2:-https://mcp-dev.api-system.tomtom.com/maps}"
BACKEND="${BACKEND:-tomtom-maps}"

call() {
  local label="$1"
  local body="$2"
  echo
  echo "=========================================="
  echo "  $label"
  echo "=========================================="
  curl -sS -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "tomtom-api-key: $API_KEY" \
    -H "tomtom-maps-backend: $BACKEND" \
    -H "mcp-protocol-version: 2025-06-18" \
    -d "$body"
  echo
}

call "initialize" '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "test_mcp.sh", "version": "1.0" }
  }
}'

call "tools/list" '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}'

call "tools/call tomtom-geocode (Amsterdam)" '{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "tomtom-geocode",
    "arguments": { "query": "Amsterdam" }
  }
}'

call "tools/call tomtom-reverse-geocode (52.37, 4.89)" '{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "tomtom-reverse-geocode",
    "arguments": { "lat": 52.3702, "lon": 4.8952 }
  }
}'

call "tools/call tomtom-search-poi (coffee in Amsterdam)" '{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "tomtom-search-poi",
    "arguments": { "query": "coffee", "lat": 52.3702, "lon": 4.8952 }
  }
}'
