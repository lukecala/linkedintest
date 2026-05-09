# linkedintest

Self-hosted LinkedIn lead-gen stack on a single VPS, controlled by Claude Code.

This repo gives you everything to stand up the same browser-automation platform Helixiri uses internally — Chrome containers + noVNC + CDP + MCP — wired to Claude Code, plus a Skill that finds LinkedIn leads matching an ICP and sends connection requests on your behalf. **It stops before sending DMs.** No dashboards, no scheduler, no message automation. The minimum viable lead pipeline.

## What you get

- **Browser platform** — Dockerised Chromium with persistent profile, accessible over noVNC (interactive + read-only views) and CDP for programmatic control.
- **Claude Code MCP wiring** — connects Claude Code to the VPS Chrome (browser MCP) and to Crispy (LinkedIn search + connection-request MCP).
- **`linkedin-leadgen` skill** — a Claude Code skill that takes an ICP description and produces (a) a ranked list of leads and (b) connection requests sent through Crispy.

## Start here

1. Read [`MASTERGUIDE.md`](MASTERGUIDE.md) — picks Path A or B based on whether you have a Cloudflare-hosted domain.
2. Read [`00-PREREQUISITES.md`](00-PREREQUISITES.md) — what to have ready before you SSH into the VPS.
3. Follow the numbered docs in order: `01` → `02a` or `02b` → `03` → `04` → `05` → `06`.
4. Read [`07-GOTCHAS.md`](07-GOTCHAS.md) once. The reliability section matters.

## Repo layout

```
linkedintest/
├── README.md                       you are here
├── MASTERGUIDE.md                  decision tree (Path A vs B)
├── 00-PREREQUISITES.md             prerequisites checklist
├── 01-VPS-BOOTSTRAP.md             clone + install Docker on the VPS
├── 02a-PATH-A-CLOUDFLARE.md        custom domain + HTTPS via Traefik
├── 02b-PATH-B-LOCALHOST.md         no domain, SSH tunnel from laptop
├── 03-BROWSER-PLATFORM.md          start the platform, create a session
├── 04-CLAUDE-CODE-MCP.md           install Claude Code, wire MCPs
├── 05-SKILL-INSTALL.md             install the linkedin-leadgen skill
├── 06-RUNBOOK.md                   how to use it day-to-day
├── 07-GOTCHAS.md                   reliability, restart commands, edge cases
├── infra/                          Docker stack (compose, Caddy, Traefik, chrome container, session manager, MCP)
├── skills/                         Claude Code skill markdown
└── config/                         example MCP config
```

## License

MIT.
