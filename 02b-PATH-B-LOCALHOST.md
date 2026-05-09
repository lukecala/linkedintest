# Path B — Localhost Only via SSH Tunnel (No Domain Required)

## When to use this path

- You have no custom domain, OR your domain is not yet on Cloudflare nameservers.
- You want to be operational in 10 minutes without waiting for DNS propagation or cert issuance.

---

## The architecture

- The session-manager binds only to `127.0.0.1:8080` on the VPS — it is not reachable from the public internet.
- You access it from your laptop by opening an SSH tunnel: `ssh -L 8080:127.0.0.1:8080 user@vps`.
- Traffic flows: laptop browser → SSH tunnel → VPS localhost:8080 → session-manager → Chrome container.
- No HTTPS, no domain, and no basic-auth password are required. The SSH connection itself is the authentication boundary.

---

## Step 1 — Bring up the localhost stack

Run this on your **VPS** (not your laptop):

```bash
cd ~/linkedintest/infra
docker compose -f docker-compose.localhost.yml up -d
docker compose -f docker-compose.localhost.yml logs -f session-manager
```

Wait until you see:

```
Server listening on 0.0.0.0:8080
```

This compose file does not include Traefik and does not require a `DOMAIN` or `AUTH_PASS_HASH`. The session-manager port is bound to `127.0.0.1` only, so it is not reachable until you open the tunnel in Step 2.

---

## Step 2 — Open the SSH tunnel from your laptop

Run this on your **laptop**, not the VPS:

```bash
ssh -L 8080:127.0.0.1:8080 -N root@<vps-ip>
```

Leave this terminal open. The tunnel is alive only while this command is running. If you close the terminal or the process exits, the tunnel drops and the browser cannot reach the session-manager.

Replace `root` with the actual user account you use to SSH into the VPS.

---

## Step 3 — Verify from your laptop

Open a second terminal on your laptop and run:

```bash
curl http://localhost:8080/api/sessions
```

Expected response: `[]`

Or open `http://localhost:8080/api/sessions` directly in your laptop's browser — you should see an empty JSON array.

---

## Step 4 — Create a session

Run this from your laptop (it hits the tunneled port):

```bash
curl -X POST http://localhost:8080/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"id":"linkedin"}'
```

---

## Step 5 — Open the interactive view

Open this URL in your laptop's browser:

```
http://localhost:8080/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify
```

You should see a Chrome browser window running inside noVNC.

Read-only variant — append `&view_only=true` when supervising an agent:

```
http://localhost:8080/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify&view_only=true
```

---

## Reliability caveats — read this carefully

**The SSH tunnel is the weak link in this architecture. It will break.**

| Event | Effect |
|---|---|
| Your laptop sleeps | Tunnel drops. Must restart. |
| Your wifi changes networks | Tunnel drops. Must restart. |
| VPS reboots | Tunnel drops AND Chrome container is gone. Must restart both. |
| You close the terminal running `ssh` | Tunnel drops immediately. |

There is no background keepalive in a plain `ssh -N` command. This is a deliberate tradeoff for setup speed.

### When the tunnel breaks

1. Re-run the SSH command from Step 2.
2. Check whether your Chrome container is still running:
   ```bash
   # run on VPS
   docker ps
   ```
   If the `linkedin` session container is gone, recreate it by re-running the `curl -X POST` from Step 4.
3. If LinkedIn was already logged in when the container was lost, the session cookie is stored in `/data/browser-profiles/linkedin/` on the VPS. Profile data persists across container recreates — you will not need to log in to LinkedIn again. Just open the noVNC link from Step 5 after recreating the session.

---

## Auto-reconnect option

Install `autossh` on your laptop for a tunnel that automatically reopens when the network blips:

```bash
# macOS
brew install autossh

# Debian/Ubuntu
sudo apt install autossh
```

Then replace the Step 2 command with:

```bash
autossh -M 0 -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
  -L 8080:127.0.0.1:8080 -N root@<vps-ip>
```

`autossh` will reopen the TCP tunnel when it detects the connection has dropped. It still cannot survive a laptop sleep — the OS suspends the SSH process entirely, and `autossh` only restarts it after wake. For laptop-sleep resilience you would need a persistent reverse tunnel or a daemon approach, neither of which is covered here.

---

## Migrating from Path B to Path A later

When you have a Cloudflare domain ready:

1. Stop the localhost stack on the VPS:
   ```bash
   cd ~/linkedintest/infra
   docker compose -f docker-compose.localhost.yml down
   ```
2. Follow `02a-PATH-A-CLOUDFLARE.md` from the beginning.
3. Your browser profiles in `/data/browser-profiles/` are untouched — LinkedIn login state and any other stored cookies carry over automatically.

---

Now go to `03-BROWSER-PLATFORM.md` to create your first session.
