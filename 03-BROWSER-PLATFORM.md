# 03 — Browser Platform

Start the platform and verify it works. Run all commands from the repo root unless otherwise noted.

---

## Start the stack

**Path A users** (custom domain + HTTPS):

```bash
cd infra
docker compose up -d
```

**Path B users** (localhost, SSH tunnel):

```bash
cd infra
docker compose -f docker-compose.localhost.yml up -d
```

Wait about 30 seconds for the `session-manager` image to build on the first run.

---

## Step 1: Verify session-manager is up

```bash
curl http://127.0.0.1:8080/api/sessions
```

Expected response: `[]`

If you get `Connection refused`, wait a few seconds and retry. Check logs with `docker compose logs session-manager`.

---

## Step 2: Create your first session

```bash
curl -X POST http://127.0.0.1:8080/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"id":"linkedin"}'
```

Expected response (HTTP 201):

```json
{
  "id": "linkedin",
  "containerId": "abc123...",
  "resumed": false,
  "cdpEndpoint": "ws://localhost:8080/ws/linkedin",
  "liveViewUrl": "http://localhost:8080/view/linkedin/vnc.html"
}
```

The session manager spins up a `chrome-linkedin` container and waits up to 30 seconds for CDP to become available. If it times out, check that the `browser-chrome` image built correctly: `docker images | grep browser-chrome`.

---

## Step 3: Get the interactive link

The interactive view lets you click and type in the browser — use this for the initial LinkedIn login.

**Path A:**

```
https://<your-domain>/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify
```

Replace `<your-domain>` with the value of `DOMAIN` in your `.env`.

**Path B:**

First set up the SSH tunnel as described in `02b-PATH-B-LOCALHOST.md`. Once the tunnel is active:

```
http://localhost:8080/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify
```

Open this URL in your local browser. You should see the Chrome desktop inside noVNC.

---

## Step 4: Get the read-only link

Append `&view_only=true` to either URL from Step 3:

**Path A:**

```
https://<your-domain>/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify&view_only=true
```

**Path B:**

```
http://localhost:8080/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify&view_only=true
```

The read-only view streams the browser screen but your mouse clicks and keystrokes are not forwarded to the container. Use this when you want to watch Claude Code work without accidentally interfering with its mouse or keyboard input. Keep the interactive link closed while the agent is running.

---

## Step 5: Login to LinkedIn once

Open the **interactive** link (Step 3) and log in to LinkedIn normally — username, password, any 2FA prompt. You only need to do this once. The profile is stored in `/data/browser-profiles/linkedin/` on the VPS and is mounted into every future `chrome-linkedin` container, so the session persists across restarts.

---

## Stopping a session

```bash
curl -X DELETE http://127.0.0.1:8080/api/sessions/linkedin
```

This stops and removes the `chrome-linkedin` container. The profile directory on disk is **not** deleted — your LinkedIn session cookies are preserved.

---

## Listing sessions

```bash
curl http://127.0.0.1:8080/api/sessions
```

Returns all sessions the manager knows about, their status (`running` or `stopped`), and their CDP/noVNC URLs.

---

Now wire Claude Code to control the browser → `04-CLAUDE-CODE-MCP.md`.
