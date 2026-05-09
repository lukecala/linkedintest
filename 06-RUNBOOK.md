# 06 — Runbook: Daily Lead-Gen Workflow

This document covers day-to-day usage once the VPS is running, MCPs are connected, and the skill is installed.

---

## Before You Start: Preflight Check

**1. Confirm the VPS containers are running**

```bash
ssh root@<vps-ip> 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

You should see both `chrome-linkedin` and `session-manager` (or the equivalent session API container) with status `Up`. If they are stopped, start them per `01-VPS-BOOTSTRAP.md`.

**2. (Option B users only) Confirm the custom MCP server process is reachable**

If you chose Option B (custom `mcp-server/server.js`), no extra tunnel is needed — SSH handles it. But confirm the SSH connection still works:

```bash
ssh root@<vps-ip> echo ok
```

**3. Open Claude Code**

```bash
claude
```

Type `/mcp` — both `browser` and `crispy` should show as connected before you start. If either is red, resolve it before running the skill (see `04-CLAUDE-CODE-MCP.md`, Step 5 troubleshooting).

---

## Daily Workflow

**Step 1** — Describe your ICP and how many leads you want. Paste it directly into the Claude Code chat:

```
Use the linkedin-leadgen skill to find 20 leads matching this ICP:
Founders or Co-Founders of B2B SaaS companies, 10-100 employees,
based in DACH region (Germany, Austria, Switzerland), who have posted
about AI or automation in the last 30 days.
```

**Step 2** — Claude will run automatically. It will:

1. Parse your ICP into searchable filters (role, industry, company size, geography, signal).
2. Call `mcp__crispy__search_people` or `mcp__crispy__search_leads` to pull a candidate pool (typically 2-3x your requested count).
3. Score each result for ICP fit and discard obvious mismatches.
4. For each top-ranked lead: open the LinkedIn profile in the VPS Chrome browser, confirm it loaded, then call `mcp__crispy__send_invitation` to send a connection request.
5. Print a final summary table.

**Step 3** — Review the output table. It will look like:

| # | Name | Headline | Company | Profile | Action |
|---|------|----------|---------|---------|--------|
| 1 | Jane Doe | Co-Founder & CEO | Acme GmbH | linkedin.com/in/jane-doe | Connection requested |
| 2 | Max Muller | Founder | DataFlow AG | linkedin.com/in/max-muller | Connection requested |

The "Action" column should only ever say "Connection requested" or "Skipped — [reason]". If you see anything about DMs, InMail, or messages, that is a sign the skill was overridden. Stop and re-read the skill instructions.

**Step 4** — (Optional) Watch Claude work in real-time via noVNC. Open the noVNC URL for the `linkedin` session in your browser (see `02a-PATH-A-CLOUDFLARE.md` or `02b-PATH-B-LOCALHOST.md` for the URL). You will see the VPS Chrome navigating profiles as Claude works through the list.

---

## Example Prompts

These work out of the box — copy, adjust, and paste into Claude Code:

```
linkedin-leadgen find me 15 founders of B2B SaaS companies in DACH region,
10-50 employees, posting about AI in the last 30 days
```

```
linkedin-leadgen find 10 marketing directors at e-commerce brands in Italy
who recently posted about customer retention or churn
```

```
linkedin-leadgen find 25 heads of engineering or CTOs at Series A or B
startups in the UK, fintech or insurtech, hiring right now
```

```
linkedin-leadgen find 20 sales leaders (VP Sales, Head of Sales, CRO)
at SaaS companies 50-200 employees in the US, who have posted on LinkedIn
in the last 2 weeks
```

---

## Reviewing the Output

**In-chat summary**: the final table in the Claude Code conversation is the canonical record of what was done. Copy it to a spreadsheet or note for your CRM.

**Live view**: noVNC lets you watch the browser session in real-time. This is useful for confirming the right profiles are being opened and that connection dialogs are firing correctly.

**Crispy dashboard**: log in to your Crispy.ai account. Sent invitations should appear under Outreach > Pending. Cross-check names against the Claude output table.

---

## Stopping Mid-Run

Press `Ctrl+C` in the Claude Code terminal. Claude will stop immediately. Connection requests that have already been sent via Crispy are live and cannot be undone from Claude Code — you would need to withdraw them manually from LinkedIn or the Crispy dashboard.

---

## Daily Connection Request Limits

LinkedIn enforces weekly caps on connection requests. Exceeding them triggers a temporary block or a CAPTCHA challenge that will break the automated flow.

Approximate limits (as of mid-2025):
- Free LinkedIn account: ~100 connection requests per week
- LinkedIn Premium: ~150 per week
- Sales Navigator: ~200 per week

**Safe practice**: keep each Claude Code run to 20-30 connections. The skill will refuse to send more than 30 per run and will warn you if you ask for more.

If Crispy returns an error indicating a rate-limit or LinkedIn block, the skill will stop immediately and report the error. Do not retry the same run — wait 24 hours and run a smaller batch.

---

## What the Skill Will NOT Do

The skill is scoped to connection requests only. If you ask Claude to:

- Send DMs to new or existing connections
- Send InMail messages
- Comment on or react to posts
- Follow up on previous outreach conversations

...Claude will decline and explain that those actions are out of scope for this skill. This is intentional. DM/messaging automation on LinkedIn carries a higher risk of account action and is a separate workflow with different guardrails.
