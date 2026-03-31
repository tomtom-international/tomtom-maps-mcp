#!/bin/bash
TOKEN="$1"
curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "Authorization: Bearer $TOKEN" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
