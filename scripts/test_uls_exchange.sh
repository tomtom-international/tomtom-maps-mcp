#!/usr/bin/env bash

# Test ULS token exchange endpoint
# Usage: ./scripts/test_uls_exchange.sh <jwt_token>

JWT="${1:?Usage: $0 <jwt_token>}"

curl -v -X POST https://test.oauth.my.tomtom.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange\
&subject_token=${JWT}\
&subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Ajwt\
&requested_token_type=urn%3Atomtom%3Auls%3Aparams%3Aoauth%3Atoken-type%3Aapi_key\
&resource=https%3A%2F%2Fapi.tomtom.com\
&client_id=https%3A%2F%2Fmyapp.tomtom.com"
