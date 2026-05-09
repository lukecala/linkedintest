# Prerequisites

Everything to have ready **before** you SSH into the VPS. If any item is missing, the install will stall.

## Required for both paths

### 1. VPS
- Ubuntu 22.04 or 24.04 (Hostinger / Hetzner / DigitalOcean — anything mainstream)
- **Minimum 2 GB RAM** (4 GB recommended — chromium is hungry)
- **Minimum 20 GB disk** — chrome containers + profiles eat space
- Public IPv4
- Root SSH access (password or key)

If you only have a sudo user, that's fine — anywhere the docs say `root@<vps-ip>` substitute your user and prefix commands with `sudo`.

### 2. Crispy.ai account
- Active subscription (paid)
- API key generated from your Crispy dashboard
- Your LinkedIn account already connected inside Crispy (so connection requests can be sent on your behalf)

If you don't have Crispy yet: sign up at crispy.ai before the call. Plan: whichever tier exposes the MCP / API.

### 3. LinkedIn account
- Active, not in restricted state
- Two-factor auth: app-based or none. Email/SMS-based 2FA can stall the noVNC login flow — switch to authenticator app if possible
- Used routinely from your laptop already (so the IP/device profile isn't suspicious to LinkedIn when the VPS Chrome logs in for the first time)

### 4. Local laptop
- macOS or Linux (Windows users: use WSL2)
- Node.js 20+ installed (`node --version` should print `v20.x` or higher)
- An SSH client and the ability to add SSH keys (`ssh-keygen`, `ssh-copy-id`)
- A modern browser (Chrome / Firefox / Safari) — for opening the noVNC view

### 5. Anthropic API key
- For Claude Code authentication
- Get one from console.anthropic.com → API keys
- Free tier won't be enough for sustained lead-gen — top up $10–20 to start

### 6. GitHub access (read-only)
- Just enough to `git clone https://github.com/lukecala/linkedintest.git` on the VPS
- Public repo — no auth needed for clone

## Required only for Path A (Cloudflare + custom domain)

### 7. Custom domain
- Already owned by you (any registrar is fine — Namecheap, GoDaddy, Cloudflare Registrar, etc.)

### 8. Domain on Cloudflare nameservers
- The domain's NS records must already point to `*.ns.cloudflare.com`
- Verify before the call: `dig NS yourdomain.com +short`
- If it isn't on Cloudflare yet, **do not start the migration during the 2h call** — propagation can take up to 24h. Use Path B for now.

### 9. Cloudflare dashboard access
- For adding an `A` record pointing the chosen subdomain (e.g. `browser.yourdomain.com`) to your VPS public IP

## Pre-call checklist for Edu (paste into a message)

```
Before our call, please confirm:

[ ] VPS provisioned (provider, IP, root SSH access)
[ ] VPS specs: ____ GB RAM, ____ GB disk
[ ] Crispy.ai account active + API key in hand
[ ] LinkedIn account: 2FA via app (not SMS) or disabled
[ ] Laptop: Node 20+ installed
[ ] Anthropic API key in hand (with $10+ credit)
[ ] Custom domain? Y/N
[ ] If Y: nameservers already on Cloudflare? Y/N
       (run: dig NS <yourdomain> +short — must include *.ns.cloudflare.com)

Optional but speeds things up:
[ ] You give me VPS root SSH credentials 6h before the call so I pre-provision Docker
    and we use the 2h purely for the Claude Code + skill walkthrough
```

If Edu can't tick a Required item, the call gets blocked at that step. Confirm everything in writing **the day before**.
