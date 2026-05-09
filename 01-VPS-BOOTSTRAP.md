# 01 — VPS Bootstrap

## What this does

This guide sets up a fresh Ubuntu VPS with Docker and all host-level dependencies the browser automation platform needs. Run it once; it is safe to re-run (idempotent).

---

## Step 1: SSH into the VPS

```bash
ssh root@<vps-ip>
```

Replace `<vps-ip>` with your Hostinger VPS public IP address.

---

## Step 2: Clone this repo

```bash
git clone https://github.com/lukecala/linkedintest.git
cd linkedintest
```

---

## Step 3: Run the bootstrap script

```bash
sudo bash infra/bootstrap.sh
```

The script does the following in order:

1. Installs `ca-certificates`, `curl`, `gnupg`, and `git` via apt.
2. Installs Docker via the official convenience script (`https://get.docker.com`) — skipped if Docker is already present.
3. Enables and starts the Docker service with `systemctl enable --now docker`.
4. Adds the invoking user to the `docker` group so you can run `docker` commands without `sudo`.
5. Copies `infra/.env.example` to `infra/.env` if no `.env` exists yet — you must edit this file before starting the stack.
6. Creates `/data/browser-profiles` and `/data/browser-extensions` with correct permissions (Chrome profile persistence and shared extensions).

---

## Step 4: Log out and back in

The docker group membership does not apply to your current shell session. Log out and reconnect:

```bash
exit
ssh root@<vps-ip>
```

---

## Step 5: Verify

```bash
docker --version
docker run --rm hello-world
```

Expected output: Docker prints its version, then `hello-world` prints "Hello from Docker!" and exits cleanly.

---

## Common pitfalls

**VPS provider blocking docker.io reach**
Some providers firewall outbound connections to `download.docker.com`. If `curl -fsSL https://get.docker.com | sh` hangs, contact your provider or pre-install Docker from the OS package index with `apt install docker.io` and skip the convenience script.

**Low RAM (under 2 GB)**
Each Chrome container uses roughly 400–600 MB of RAM. The session manager and Caddy/proxy add another ~100 MB. A 2 GB VPS supports 2 concurrent sessions (the default `MAX_SESSIONS=2`). Upgrade to 4 GB before increasing `MAX_SESSIONS`.

**apt locked by unattended-upgrades**
If the bootstrap script stalls on `apt update` with a message like `Could not get lock /var/lib/dpkg/lock-frontend`, wait 1–2 minutes for the background upgrade process to finish, then re-run the script.

---

Now go to `02a-PATH-A-CLOUDFLARE.md` (custom domain + HTTPS) or `02b-PATH-B-LOCALHOST.md` (faster, SSH tunnel).
