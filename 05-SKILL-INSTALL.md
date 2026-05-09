# 05 — Skill Install

## What is a Claude Code Skill?

A skill is a markdown file with YAML frontmatter that lives in `~/.claude/skills/`. Claude Code loads all skill files at session start. When you describe a task, Claude matches it against available skills by their `description` field and follows the instructions in the skill body. You can also invoke a skill explicitly by typing `/skill linkedin-leadgen` in the Claude Code chat.

---

## Step 1: Copy the Skill File

```bash
mkdir -p ~/.claude/skills
cp ~/linkedintest/skills/linkedin-leadgen.md ~/.claude/skills/
```

If your project is at a different path, adjust accordingly. The skill file itself is at `skills/linkedin-leadgen.md` in this deliverable package.

---

## Step 2: Verify the Skill Loaded

Open Claude Code:

```bash
claude
```

Type `/skills` (or `/help` on older versions) and press Enter. You should see `linkedin-leadgen` in the list with its description:

```
linkedin-leadgen   Find LinkedIn leads matching an ICP, send connection requests via Crispy, stop before DMs.
```

If it does not appear, check that the file is in the correct directory:

```bash
ls ~/.claude/skills/
# should show: linkedin-leadgen.md
```

Also verify the YAML frontmatter is intact at the top of the file — if the `---` delimiters or the `name`/`description` fields are malformed, Claude Code will skip the file silently.

---

## Step 3: Use the Skill

See `06-RUNBOOK.md` for the daily workflow, example prompts, and output format.
