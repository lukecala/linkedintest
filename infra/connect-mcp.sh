#!/bin/bash
# Resolves the CDP endpoint for a browser session and launches @playwright/mcp
# Usage: connect-mcp.sh <session-id>

SESSION_ID="${1:-linkedin}"

# Get container IP
IP=$(sg docker -c "docker inspect chrome-${SESSION_ID} --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'" 2>/dev/null)

if [ -z "$IP" ]; then
  echo "Error: Session '${SESSION_ID}' not found or not running" >&2
  exit 1
fi

# Get the CDP WebSocket URL from Chrome
CDP_URL=$(curl -s "http://${IP}:9222/json/version" | python3 -c "import sys,json; print(json.load(sys.stdin)['webSocketDebuggerUrl'])" 2>/dev/null)

if [ -z "$CDP_URL" ]; then
  echo "Error: Could not get CDP endpoint from chrome-${SESSION_ID}" >&2
  exit 1
fi

exec npx -y @playwright/mcp@latest --cdp-endpoint "$CDP_URL"
