# Path A — Custom Domain via Cloudflare (HTTPS + Basic Auth)

## When to use this path

- You have a custom domain.
- That domain's nameservers are **already pointing at Cloudflare** — not just registered there, but actually delegated.
- You want public HTTPS access without keeping an SSH tunnel open on your laptop.

---

## Pre-flight check — verify nameservers

Before doing anything else, confirm that Cloudflare is authoritative for your domain:

```bash
dig NS yourdomain.com +short
```

The output must include entries ending in `.ns.cloudflare.com`, for example:

```
ada.ns.cloudflare.com.
kit.ns.cloudflare.com.
```

**If you do not see Cloudflare nameservers: STOP. Use Path B (`02b-PATH-B-LOCALHOST.md`) instead.**

Nameserver changes at a registrar can take up to 24 hours to propagate. There is no shortcut; using this path before propagation completes will cause Let's Encrypt to fail cert issuance.

---

## Step 1 — Create an A record on Cloudflare

1. Log in to the Cloudflare dashboard.
2. Select your domain.
3. Go to **DNS** → **Records** → **Add record**.
4. Fill in:
   - **Type**: A
   - **Name**: `browser` (this gives you `browser.yourdomain.com`; use any subdomain you like)
   - **IPv4 address**: your VPS's public IP
   - **Proxy status**: **DNS only** (the gray cloud icon — NOT the orange proxied one)
   - **TTL**: Auto
5. Save.

**Why DNS-only and not orange-cloud proxy?** Cloudflare's orange-cloud mode intercepts TLS at their edge and re-encrypts to your origin. This double-wraps the TLS session and breaks the WebSocket upgrade that noVNC's `websockify` depends on. With DNS-only, Traefik talks TLS directly to the client and handles the WebSocket connection end-to-end.

---

## Step 2 — Generate the basic-auth password hash

Traefik's basic-auth middleware requires a bcrypt hash, not a plaintext password. Generate it with:

```bash
docker run --rm httpd:2.4-alpine htpasswd -nbB admin 'your-strong-password' | sed -e 's/\$/\$\$/g'
```

The output looks like:

```
admin:$$2y$$05$$...long-hash...
```

Copy the entire string. The `$$` doubling is intentional — Docker Compose variable interpolation consumes single `$` signs, so every `$` in the hash must be doubled so Traefik receives the literal `$2y$05$...` it expects.

---

## Step 3 — Edit `.env`

```bash
cd ~/linkedintest/infra
cp .env.example .env
nano .env
```

Set the following values:

```dotenv
DOMAIN=browser.yourdomain.com
AUTH_USER=admin
AUTH_PASS_HASH=admin:$$2y$$05$$...   # paste the full output from Step 2
MAX_SESSIONS=4
```

Note: `.env.example` ships with `AUTH_PASS` (a plaintext field used only for reference). The Traefik stack reads `AUTH_PASS_HASH`, which is not in `.env.example` — you are adding it manually here.

---

## Step 4 — Bring up the stack

```bash
docker compose up -d
docker compose logs -f session-manager
```

Wait until you see:

```
Server listening on 0.0.0.0:8080
```

If Traefik is not yet running on your VPS, start it first — the session-manager container attaches to the `root_default` network that Traefik manages. Check your VPS setup doc (`01-VPS-BOOTSTRAP.md`) if Traefik is not present.

---

## Step 5 — Verify HTTPS and cert issuance

```bash
curl -u admin:your-strong-password https://browser.yourdomain.com/api/sessions
```

Expected response: `[]` (empty sessions list).

The first call may take **5 to 30 seconds** while Traefik completes the Let's Encrypt HTTP-01 challenge and receives the certificate. Subsequent calls are fast.

### Common Let's Encrypt failures

**Rate limit hit.** Let's Encrypt allows 5 certificates per registered domain per week. If you repeatedly tear down and recreate the stack during testing, you may hit this limit. Wait until the window resets or use a different subdomain.

**Domain not yet propagated.** After creating the A record, wait at least 5 to 10 minutes before attempting cert issuance. Let's Encrypt's servers must be able to resolve your subdomain to your VPS IP. Verify from an external resolver:

```bash
dig A browser.yourdomain.com @1.1.1.1 +short
```

**Port 80 blocked.** The HTTP-01 challenge requires that Let's Encrypt can reach port 80 on your VPS from the internet. Check your VPS firewall (`ufw status` or your provider's security group rules) and confirm port 80 is open.

**DNS resolves to the wrong IP.** If you recently changed your VPS IP or made a mistake in the A record, the cert challenge will fail silently. Verify:

```bash
dig A browser.yourdomain.com @8.8.8.8 +short
```

The output must match your VPS's public IP exactly.

---

## Step 6 — Create a test session and open the interactive link

Create a session:

```bash
curl -u admin:your-strong-password -X POST https://browser.yourdomain.com/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"id":"linkedin"}'
```

Then open this URL in your browser:

```
https://browser.yourdomain.com/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify
```

You should see a Chrome browser window running inside noVNC.

### Read-only link

Append `&view_only=true` to the URL when you want to supervise an agent without risking accidental mouse input:

```
https://browser.yourdomain.com/view/linkedin/vnc_lite.html?autoconnect=true&path=view/linkedin/websockify&view_only=true
```

---

## Cost and time estimate

| Scenario | Time |
|---|---|
| Cloudflare nameservers already active | 20 to 45 minutes |
| Nameservers being migrated from another registrar | Up to 24 hours |

If you are mid-migration, do not wait. Use Path B now and migrate to Path A later — it is a clean cutover.

---

Now go to `03-BROWSER-PLATFORM.md` to verify the platform and create your first session.
