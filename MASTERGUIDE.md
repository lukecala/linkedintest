# Master Guide

This document picks your installation path and gives you the high-level steps. Read this first, then follow the numbered docs in order.

## Decision tree — which path?

You have two ways to expose the browser platform on your VPS. Pick one.

```
Do you have a custom domain (e.g. yourdomain.com)?
│
├── No  ──────────────────────────────────────► Path B (localhost + SSH tunnel)
│
└── Yes
    │
    └── Are its nameservers already Cloudflare's? (NS records *.ns.cloudflare.com)
        │
        ├── No   ──────────────────────────────► Path B for now, migrate to A later
        │       (DNS migration can take up to 24h — too slow for the call)
        │
        └── Yes  ──────────────────────────────► Path A (Cloudflare DNS + Traefik HTTPS)
```

| | Path A — Cloudflare | Path B — Localhost |
|---|---|---|
| Setup time | 20–45 min | 10–15 min |
| Public URL | yes (HTTPS, basic-auth) | no — localhost-only via SSH tunnel |
| Reliability | high (always reachable) | breaks when laptop sleeps, wifi changes, or VPS reboots |
| Recommended for the 2h coaching call | only if Cloudflare DNS already done | **default** |
| Migration to the other path | one-way change of `.env` + compose file | profiles persist; switch any time |

**Default for the call: Path B.** It gets you operational fast. Path A is homework after you have a stable workflow.

## High-level steps (both paths)

### Step 1 — Prep
1. Read `00-PREREQUISITES.md`. Make sure every item is checked off.
2. SSH into your VPS as `root` (or a sudo-able user).

### Step 2 — VPS bootstrap
Follow `01-VPS-BOOTSTRAP.md`:
1. `git clone https://github.com/lukecala/linkedintest.git && cd linkedintest`
2. `sudo bash infra/bootstrap.sh` — installs Docker, prepares volume directories.
3. Log out and back in (so docker group membership applies).

### Step 3 — Pick a path
- Path A users: follow `02a-PATH-A-CLOUDFLARE.md` (DNS record, basic-auth hash, edit `.env`, `docker compose up -d`).
- Path B users: follow `02b-PATH-B-LOCALHOST.md` (`docker compose -f infra/docker-compose.localhost.yml up -d`, open SSH tunnel from your laptop).

### Step 4 — Browser platform up
Follow `03-BROWSER-PLATFORM.md`:
1. Verify session-manager is reachable.
2. Create your first chrome session: `POST /api/sessions {"id":"linkedin"}`.
3. Open the **interactive** noVNC link in your laptop browser.
4. Login to LinkedIn **once** — the cookie persists in the volume.
5. Note the **read-only** link (same URL with `&view_only=true`) — use it to supervise the agent without your mouse interfering.

### Step 5 — Claude Code + MCP
Follow `04-CLAUDE-CODE-MCP.md` on your laptop:
1. Install Claude Code (`npm i -g @anthropic-ai/claude-code` or installer script).
2. Configure two MCP servers in `~/.claude/mcp.json`:
   - **browser** — bridges to the VPS Chrome via SSH + `connect-mcp.sh` (or the custom mcp-server).
   - **crispy** — Crispy.ai LinkedIn MCP for search + connection requests.
3. Verify with `/mcp` inside Claude Code — both should be green.

### Step 6 — Install the skill
Follow `05-SKILL-INSTALL.md`:
1. `cp ~/linkedintest/skills/linkedin-leadgen.md ~/.claude/skills/`
2. Confirm with `/skills` inside Claude Code.

### Step 7 — Run it
Follow `06-RUNBOOK.md`:
1. Open Claude Code anywhere.
2. Prompt: `Use the linkedin-leadgen skill to find 20 leads matching this ICP: [your ICP]`.
3. Claude will: search Crispy → score → open profiles in the VPS Chrome → send connection requests.
4. **It will not send DMs.** Verify in the final summary table.

### Step 8 — Read the gotchas
`07-GOTCHAS.md` covers what breaks and how to recover. Most important:
- Path B: what to do when the SSH tunnel dies (laptop sleep, network change).
- Both paths: how to recreate a chrome session without losing the LinkedIn login.
- Connection-request limits (~100/week free, ~200/week Sales Navigator) — don't get rate-limited.

## What this stack will NOT do

By design, the skill stops at connection requests. It will refuse to:
- Send DMs (`mcp__crispy__send_message`)
- Send InMails (`mcp__crispy__send_inmail`)
- Comment on or react to posts
- Follow up on prior conversations

If you want any of those, that is out of scope for this consulting deliverable — talk to Luke about the full Helixiri Mission Control product.

## Time budget for a 2h coaching call (Path B)

| Block | Time |
|---|---|
| Step 2 (VPS bootstrap)            | 10 min |
| Step 3 (Path B compose up)         | 5 min  |
| Step 4 (session + LinkedIn login)  | 10 min |
| Step 5 (Claude Code + MCP)         | 25 min |
| Step 6 (install skill)             | 5 min  |
| Step 7 (first live run)            | 25 min |
| Q&A + edge cases                   | 30 min |
| Slack                              | 10 min |
| **Total**                          | **~2h** |

Path A adds 20–30 min for DNS + cert issuance and is feasible only if the domain is already on Cloudflare nameservers.
