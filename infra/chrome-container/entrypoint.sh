#!/bin/bash
set -e

# Remove stale profile locks from previous container
rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie

# Start virtual framebuffer
Xvfb :99 -screen 0 ${RESOLUTION:-1920x1080x24} -ac &
sleep 1

# Build extension flags if any extensions are mounted
EXTENSION_FLAGS=""
if [ -d "/data/extensions" ]; then
  EXT_DIRS=$(find /data/extensions -maxdepth 1 -mindepth 1 -type d | paste -sd, -)
  if [ -n "$EXT_DIRS" ]; then
    EXTENSION_FLAGS="--load-extension=$EXT_DIRS"
    echo "[browser-platform] Loading extensions: $EXT_DIRS"
  fi
fi

# Start Chromium on localhost CDP (port 9223 internal)
chromium \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --disable-background-networking \
  --disable-sync \
  --disable-translate \
  --disable-features=TranslateUI \
  --disable-gpu \
  --disable-dev-shm-usage \
  --user-data-dir=/data/profile \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9223 \
  --remote-allow-origins=* \
  --window-size=1920,1080 \
  --start-maximized \
  $EXTENSION_FLAGS \
  "about:blank" &

sleep 2

# Bridge CDP from 127.0.0.1:9223 to 0.0.0.0:9222 via socat
socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9223 &

# Start VNC server on display :99
x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -q &
sleep 1

# Start websockify to bridge VNC (5900) → WebSocket (6080) with noVNC client
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &

echo "[browser-platform] Session ready"
echo "  CDP:      ws://0.0.0.0:9222"
echo "  Live View: http://0.0.0.0:6080/vnc.html"

# Keep alive — if any critical process dies, restart the container
while kill -0 $! 2>/dev/null; do sleep 5; done
