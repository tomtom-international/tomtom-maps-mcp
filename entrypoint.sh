#!/bin/bash

# Clean up any existing Xvfb lock files
rm -f /tmp/.X99-lock

# Start Xvfb in the background
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset & 
XVFB_PID=$!

# Wait for Xvfb to be ready
TIMEOUT=500
WAIT=0
while ! xdpyinfo -display :99 >/dev/null 2>&1; do
  sleep 0.1
  WAIT=$(echo "$WAIT + 0.1" | bc)
  if [ "$(echo "$WAIT > $TIMEOUT" | bc)" -eq 1 ]; then
    echo "Xvfb failed to start within ${TIMEOUT}s"
    kill $XVFB_PID
    exit 1
  fi
done

echo "Xvfb is ready."

# Start the application, replacing this script
exec "$@"
