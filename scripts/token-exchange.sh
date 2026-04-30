#!/usr/bin/env bash
set -euo pipefail

# Exchange a user JWT for a TomTom ULS API key via OAuth token exchange.
# Usage: ./scripts/token-exchange.sh <user_jwt>

JWT="${1:?Usage: $0 <user_jwt>}"

HOST="${TOKEN_HOST:-https://test.oauth.my.tomtom.com}"
CLIENT_ID="${CLIENT_ID:-https://myapp.tomtom.com}"
RESOURCE="${RESOURCE:-https://api.tomtom.com}"

curl -sS -X POST "${HOST}/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  --data-urlencode "subject_token=${JWT}" \
  --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:jwt" \
  --data-urlencode "requested_token_type=urn:tomtom:uls:params:oauth:token-type:api_key" \
  --data-urlencode "resource=${RESOURCE}" \
  --data-urlencode "client_id=${CLIENT_ID}"
