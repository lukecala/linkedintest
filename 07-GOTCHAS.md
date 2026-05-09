# Gotchas — what breaks and how to recover

This is the page you'll come back to when something stops working. Read it once before the call so you know what's normal and what's not.

## Path B: SSH tunnel reliability

The single biggest source of friction. The tunnel is the only path between your laptop browser and the VPS chrome — it has no redundancy.

### Symptoms

- noVNC tab shows "disconnected" or grey screen
- `curl http://localhost:8080/api/sessions` hangs or returns connection refused
- Claude Code's browser MCP shows red in `/mcp`

### Recovery

1. **Check the tunnel is alive**: in the terminal running the SSH command, you should see no exit. If the prompt is back, the tunnel died — re-run:
   ```bash
   ssh -L 8080:127.0.0.1:8080 -N root@<vps-ip>
   ```
2. **Check the VPS containers**: in another terminal, `ssh root@<vps-ip> 'docker ps'`. You should see `chrome-linkedin` and `session-manager`. If chrome is missing, the container exited or was never created — recreate the session:
   ```bash
   ssh root@<vps-ip>
   curl -X POST http://127.0.0.1:8080/api/sessions \
     -H 'Content-Type: application/json' -d '{"id":"linkedin"}'
   ```
3. **LinkedIn cookie persists** in `/data/browser-profiles/linkedin/` — recreating the chrome container does not log you out.

### When it breaks

- Laptop sleeps → tunnel dies. Re-open after wake.
- Wifi changes (coffee shop → home) → tunnel dies. Re-open.
- VPS reboots → containers stopped. Run `docker compose -f infra/docker-compose.localhost.yml up -d` to restart, then re-open tunnel.
- You closed the terminal running ssh → tunnel dies. Don't close it.

### Cleaner alternative — `autossh`

```bash
# macOS
brew install autossh

# Linux
sudo apt install autossh

# Run
autossh -M 0 \
  -o "ServerAliveInterval 30" \
  -o "ServerAliveCountMax 3" \
  -L 8080:127.0.0.1:8080 \
  -N root@<vps-ip>
```

Re-establishes the tunnel automatically on network blips. **Does not survive laptop sleep** — you still re-run after waking.

## Path A: Let's Encrypt cert issuance

Common failure modes when first bringing up Traefik.

### Cert never issued, Traefik logs say "rate limited"

- Let's Encrypt limits 5 cert issuances per registered domain per week.
- If you've been retrying, you may be locked out for up to 7 days.
- Workaround: change the subdomain (`browser2.yourdomain.com`) and try again.

### Cert never issued, Traefik logs say "challenge failed"

- HTTP-01 challenge needs port 80 reachable from the public internet.
- Check: `curl http://browser.yourdomain.com/.well-known/acme-challenge/test` from another machine should reach Traefik (404 is fine, "connection refused" is the bug).
- Common cause: Hostinger/Hetzner firewall blocking port 80, or another container bound to it. `sudo ss -tulpn | grep :80` to check.

### Cloudflare orange cloud breaks websockify

- Cloudflare's proxy doesn't pass WebSocket upgrades through correctly for noVNC's path.
- Set the Cloudflare DNS record to **DNS only** (grey cloud), not Proxied (orange).
- If you need DDoS protection later, set up Cloudflare Spectrum or Argo Tunnel — out of scope here.

## Both paths: chrome container died

### Symptom

`docker ps` doesn't show `chrome-linkedin`, but `chrome-linkedin` container exists in `docker ps -a` with exit code != 0.

### Recovery

```bash
# Inspect the crash
docker logs chrome-linkedin --tail 100

# Common cause: out of memory. Check
free -h
docker stats --no-stream
```

Chromium under Xvfb uses ~600 MB minimum. On a 2 GB VPS with Traefik + session-manager + 1 chrome, you're at the edge — add swap if the OOM killer is firing:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Then recreate the session with the same `id` — the profile volume is intact.

## LinkedIn login flow on noVNC

### Symptom

LinkedIn shows "We don't recognise this device" / new device challenge.

### Cause

The VPS Chrome's IP and fingerprint differ from your usual login. LinkedIn flags it.

### Recovery

1. Login from your laptop's regular Chrome first to make LinkedIn comfortable with you.
2. Then login on the VPS noVNC. If 2FA is enabled, use authenticator app (not SMS, which can be slow over noVNC due to copy-paste).
3. If LinkedIn forces email verification, log into your email **inside the VPS Chrome** (same noVNC session) and click the link from there. Do not click from your laptop email — different IP, LinkedIn re-challenges.

## Claude Code MCP shows red on browser

### Symptom

Inside Claude Code, `/mcp` shows `browser` with a red dot or "disconnected" status.

### Recovery in order

1. **SSH passwordless?** From your laptop:
   ```bash
   ssh root@<vps-ip> 'echo ok'
   ```
   Must print `ok` with no password prompt. If it asks for password: `ssh-copy-id root@<vps-ip>`.
2. **Bridge script runs?** From your laptop:
   ```bash
   ssh root@<vps-ip> 'bash /root/linkedintest/infra/connect-mcp.sh linkedin'
   ```
   Should keep the connection open and not error. If it errors with "Session 'linkedin' not found": create the session first (see Path B step 4 or Path A step 6).
3. **Restart Claude Code.** The MCP servers connect once at startup — quit (`exit` or Ctrl+D) and reopen.

## Crispy MCP shows red

### Symptom

`/mcp` shows `crispy` disconnected.

### Recovery

1. **API key valid?** From your laptop:
   ```bash
   curl -H "Authorization: Bearer $CRISPY_API_KEY" https://api.crispy.ai/v1/me
   ```
   Should return your account info. 401 = key wrong or expired.
2. **MCP package installed?** Run the npx command from `~/.claude/mcp.json` manually:
   ```bash
   npx -y @crispy/mcp
   ```
   If it errors that the package doesn't exist, the package name in your MCP config is wrong — check Crispy's docs for the current name.
3. **Restart Claude Code.**

## Connection request rate limits

LinkedIn caps:
- Free account: ~100 connection requests / week (hard cap, soft warning around 80)
- Sales Navigator: ~200 / week
- Withdraw old pending requests if you're hitting the cap (`mcp__crispy__cancel_invitation`)

The skill is hard-capped at 30 per run. Don't override.

If you get a Crispy error like `RATE_LIMITED`, `LINKEDIN_BLOCK`, or `CHALLENGE_REQUIRED` — **stop immediately**. Logging back into LinkedIn from your normal device usually clears soft challenges. If it persists, take a 24h break.

## "Server can break — restart command"

Whenever the VPS reboots (Hostinger maintenance, you reboot to apply kernel updates, etc.), nothing in this stack auto-recovers gracefully. Run:

```bash
ssh root@<vps-ip>
cd ~/linkedintest/infra

# Path A
docker compose up -d

# Path B
docker compose -f docker-compose.localhost.yml up -d

# Recreate the chrome session (compose only starts session-manager, not the dynamic chromes)
curl -X POST http://127.0.0.1:8080/api/sessions \
  -H 'Content-Type: application/json' -d '{"id":"linkedin"}'

# Path B: re-open SSH tunnel from your laptop
```

Profiles persist in `/data/browser-profiles/`. Your LinkedIn login stays.

## Known unreliable parts (acknowledged)

This stack is intentionally minimum-viable. We know about and accept:

- No automatic chrome restart on container crash (Docker `restart: unless-stopped` is set on session-manager, not on dynamic chrome containers)
- No queue / retry on Crispy MCP errors
- No persistent storage of "leads found" beyond the Claude Code chat history
- No notifications when something breaks
- SSH tunnel dies on laptop sleep

If any of these become painful, that is the trigger for a follow-up engagement to build the full Helixiri Mission Control surface.
