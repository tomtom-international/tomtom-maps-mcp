#!/usr/bin/env bash
# Test queries simulating AI using MCP tools — verifies TomTom-Upstream-Metadata header is sent to gateway.
# Usage: ./scripts/test-metadata-header.sh <API_KEY> [BASE_URL]

set -euo pipefail

API_KEY="${1:?Usage: $0 <API_KEY> [BASE_URL]}"
BASE_URL="${2:-http://localhost:3000}"

run_query() {
  local id="$1" label="$2" tool="$3" args="$4"
  echo "=== [$id] $label ==="
  curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "tomtom-api-key: $API_KEY" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": $id,
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"$tool\",
        \"arguments\": $args
      }
    }"
  echo ""
}

run_query_orbis() {
  local id="$1" label="$2" tool="$3" args="$4"
  echo "=== [$id] $label (orbis backend) ==="
  curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "tomtom-api-key: $API_KEY" \
    -H "tomtom-maps-backend: tomtom-orbis-maps" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": $id,
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"$tool\",
        \"arguments\": $args
      }
    }"
  echo ""
}

# 1. Geocode
run_query 1 "Geocode: Eiffel Tower" \
  "tomtom-geocode" \
  '{"query": "Eiffel Tower, Paris"}'

# 2. Fuzzy search
run_query 2 "Fuzzy search: coffee shops in Amsterdam" \
  "tomtom-fuzzy-search" \
  '{"query": "coffee shop", "lat": 52.3676, "lon": 4.9041}'

# 3. Reverse geocode
run_query 3 "Reverse geocode: coordinate in Paris" \
  "tomtom-reverse-geocode" \
  '{"lat": 48.8584, "lon": 2.2945}'

# 4. Routing
run_query 4 "Routing: Berlin to Munich" \
  "tomtom-routing" \
  '{"originLat": 52.52, "originLon": 13.405, "destLat": 48.1351, "destLon": 11.582}'

# 5. Traffic
run_query 5 "Traffic: London" \
  "tomtom-traffic" \
  '{"lat": 51.5074, "lon": -0.1278, "zoom": 12}'

# 6. POI search
run_query 6 "POI search: EV charging in Oslo" \
  "tomtom-poi-search" \
  '{"query": "EV charging station", "lat": 59.9139, "lon": 10.7522}'

# 7. Nearby
run_query 7 "Nearby: New York" \
  "tomtom-nearby" \
  '{"lat": 40.7128, "lon": -74.006}'

# 8. Orbis backend — fuzzy search in Rome
run_query_orbis 8 "Fuzzy search: restaurants in Rome" \
  "tomtom-fuzzy-search" \
  '{"query": "restaurant", "lat": 41.9028, "lon": 12.4964}'

echo "Done. Check gateway logs for TomTom-Upstream-Metadata header."
