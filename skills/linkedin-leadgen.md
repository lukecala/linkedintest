---
name: linkedin-leadgen
description: Find LinkedIn leads matching an ICP, send connection requests via Crispy, stop before DMs. Use when the user asks to find leads, prospect, or reach out to LinkedIn profiles.
---

# LinkedIn Lead-Gen Skill

## Purpose

This skill searches LinkedIn for profiles matching an Ideal Customer Profile (ICP), scores and ranks the results, opens each top profile in the VPS Chrome browser, and sends a connection request via Crispy. It does nothing beyond connection requests. DMs, InMail, post engagement, and follow-ups are explicitly out of scope.

---

## Step 1 — Parse the ICP

Read the user's ICP description. Extract the following dimensions:

- **Role / Title**: e.g., "Founder", "VP Sales", "Head of Marketing", "CTO"
- **Industry / Vertical**: e.g., "B2B SaaS", "e-commerce", "fintech", "manufacturing"
- **Company size**: e.g., "10-50 employees", "Series A", "SMB"
- **Geography**: e.g., "DACH", "Italy", "United States", "UK"
- **Signal** (optional): e.g., "posting about AI", "recently hired", "hiring now", "recently raised"
- **Requested count**: how many leads the user wants (default: 20, hard cap: 30)

If the ICP description is ambiguous on more than one of these dimensions, ask ONE clarifying question before proceeding. Do not ask multiple questions at once.

Example clarifying question: "I have your role (Founder) and geography (DACH) — should I focus on any specific industry, or search across all B2B tech?"

---

## Step 2 — Search via Crispy

Call `mcp__crispy__search_people` with the parsed filters. Aim for 2-3x the user's requested count to allow scoring and filtering.

```
mcp__crispy__search_people
  filters: {
    title: <role>,
    industry: <industry>,
    company_size: <size range>,
    location: <geography>,
    keywords: <signal if any>
  }
  limit: <requested_count * 3>
```

If `search_people` does not accept a filter that the ICP requires (e.g., a very specific signal), try `mcp__crispy__search_leads` as an alternative — it may support different filter fields. Check both if needed.

If Crispy returns zero results, loosen the filters one step at a time (e.g., remove the signal filter, then broaden geography) and retry once. If still zero, report to the user and stop.

---

## Step 3 — Score and Rank

For each profile returned by Crispy, assess ICP fit in 1-2 lines. Consider:

- Does the title match? (exact match > partial match > adjacent role)
- Does the company size and industry match?
- Is there any visible signal from the profile data (recent posts, headline keywords)?

Discard profiles that are clearly mismatches (wrong role category, wrong geography, obviously wrong company size). Keep the top N profiles where N is the user's requested count. If fewer than N survive scoring, proceed with what is available and note the shortfall.

Do not over-engineer the scoring. A quick judgment call per profile is sufficient — the goal is removing obvious mismatches, not building a scoring matrix.

---

## Step 4 — Process Each Lead

Work through the ranked list one profile at a time. For each lead:

**4a. Open the profile in VPS Chrome**

Navigate to the LinkedIn profile URL using the browser MCP. Use `mcp__browser__browser_navigate` if you are wired to the playwright-mcp (Option A), or `mcp__browser__browser_navigate` from the custom server (Option B) — the tool name is the same in both cases.

```
mcp__browser__browser_navigate
  url: <linkedin_profile_url>
```

Wait for the page to load (domcontentloaded). If navigation fails or returns an error, skip this lead and note it.

**4b. Confirm the profile loaded (optional)**

Take a snapshot to verify the correct profile is displayed:

```
mcp__browser__browser_snapshot
```

Check that the name in the accessibility tree matches the lead's name from Crispy. If there is a mismatch (e.g., LinkedIn redirect to a different profile), skip this lead.

**4c. Send the connection request via Crispy**

```
mcp__crispy__send_invitation
  profileUrl: <linkedin_profile_url>
```

Do NOT include a personalized message. Use the default no-message connection request. Adding a message introduces additional complexity and is out of scope for this skill.

If Crispy returns an error for this lead (e.g., "already connected", "invitation pending", "profile not found"), record the error in the output table and move to the next lead. Do not retry.

**4d. Record the action**

Note the result: "Connection requested", "Skipped — already connected", "Skipped — error: [reason]", etc.

---

## Step 5 — Hard Stop: Prohibited Actions

The following actions are strictly prohibited. Do not call these tools under any circumstances during this skill:

- `mcp__crispy__send_message` — sending DMs to connections
- `mcp__crispy__send_inmail` — sending InMail
- `mcp__crispy__comment_on_post` — commenting on posts
- `mcp__crispy__reply_to_comment` — replying to comments
- `mcp__crispy__engage_with_latest_post` — reacting to or reposting content
- `mcp__crispy__react_to_post` — reacting to posts
- `mcp__crispy__start_conversation` — opening new message threads
- `mcp__crispy__schedule_message` — scheduling any message

If the user asks you to do any of these things during or after the skill run, decline clearly:

"This skill is scoped to LinkedIn connection requests only. Sending DMs, InMail, or engaging with posts is out of scope here. To set up a messaging workflow, a separate skill with different guardrails is needed."

---

## Step 6 — Output

After processing all leads, output a final markdown table. This is the only output format — do not summarize differently.

```markdown
| # | Name | Headline | Company | Profile | Action |
|---|------|----------|---------|---------|--------|
| 1 | Jane Doe | Co-Founder & CEO | Acme GmbH | https://linkedin.com/in/jane-doe | Connection requested |
| 2 | Max Muller | Founder | DataFlow AG | https://linkedin.com/in/max-muller | Skipped — already connected |
```

After the table, add a one-line summary:

```
Sent X connection requests out of Y leads processed. Z skipped (reasons listed above).
```

---

## Step 7 — Rate Limit Guard

Before starting the loop, check if the user's requested count exceeds 30. If it does, warn them:

"LinkedIn caps connection requests. I will send a maximum of 30 this run to stay within safe limits. To reach [N], run this skill again tomorrow."

Then proceed with 30.

During the run, keep a running count of successful `send_invitation` calls. If the count reaches 30, stop the loop immediately regardless of how many leads remain. Report in the output table that remaining leads were not processed due to the per-run limit.

---

## Step 8 — Safety: Stop on LinkedIn Block

If Crispy returns any error that indicates a LinkedIn-level block, rate-limit, or CAPTCHA trigger — including errors with phrases like "restricted", "blocked", "challenge required", "too many requests", or any HTTP 429 — stop the entire run immediately. Do not retry, do not continue to the next lead.

Report to the user:

"Crispy returned a signal that LinkedIn may be rate-limiting or flagging this account. Stopping the run. Leads processed so far are shown below. Wait at least 24 hours before running again, and consider reducing batch size to 10-15 per run."

Then output the partial results table for whatever was completed before the block.
