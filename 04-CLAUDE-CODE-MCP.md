# 04 — Claude Code + MCP Setup

This guide walks Edu through installing Claude Code on his laptop and connecting it to:
- The self-hosted VPS browser-platform (Chrome controlled via CDP)
- The Crispy LinkedIn MCP server

Prerequisites:
- Node.js 20+ installed on the laptop
- Anthropic API key (from console.anthropic.com)
- Crispy API key (from your Crispy.ai account)
- SSH access to the VPS where the browser-platform is running
- The VPS browser-platform is already up (see `01-VPS-BOOTSTRAP.md`)

---

## Step 1: Install Claude Code

**Option A — npm (recommended if you already have Node 20+)**

```bash
npm i -g @anthropic-ai/claude-code
```

**Option B — install script**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Verify the installation:

```bash
claude --version
```

You should see a version string like `claude 1.x.x`.

---

## Step 2: Authenticate

Run Claude Code in any directory:

```bash
claude
```

On first launch it will open a browser tab for OAuth sign-in with your Anthropic account. Follow the prompts.

Alternatively, set the API key directly as an environment variable (useful for headless/CI setups):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Add that line to your `~/.zshrc` or `~/.bashrc` if you want it to persist across terminal sessions.

---

## Step 3: Configure MCP Servers

Claude Code reads MCP server configuration from a JSON file. You need to wire two servers:

### (a) Browser MCP — VPS Chrome via CDP

This MCP connects Claude Code to the Chrome browser running inside Docker on your VPS. Claude Code can then navigate pages, click, type, take screenshots, and inspect the accessibility tree — all inside a persistent Chrome profile that is already logged in to LinkedIn.

The bridge script `connect-mcp.sh` (located at `/root/linkedintest/infra/connect-mcp.sh` on the VPS) does the heavy lifting: it resolves the Docker container's internal IP, fetches the CDP WebSocket URL from Chrome's debug endpoint, and hands it off to `@playwright/mcp`. Claude Code just needs to SSH in and run that script.

**Option A (recommended) — playwright-mcp via SSH-bridged CDP**

```json
{
  "mcpServers": {
    "browser": {
      "command": "ssh",
      "args": [
        "root@<vps-ip>",
        "bash",
        "/root/linkedintest/infra/connect-mcp.sh",
        "linkedin"
      ]
    }
  }
}
```

- Pro: uses the official, well-maintained `@playwright/mcp` package. Full set of browser control tools with reliable selectors and snapshot support.
- Con: requires passwordless SSH from your laptop to the VPS (see setup below).

The session name `linkedin` corresponds to the `chrome-linkedin` Docker container on the VPS. If your container uses a different name, change that last argument.

**Option B (alternative) — custom browser-platform MCP**

```json
{
  "mcpServers": {
    "browser": {
      "command": "ssh",
      "args": [
        "root@<vps-ip>",
        "node",
        "/root/linkedintest/infra/mcp-server/server.js"
      ]
    }
  }
}
```

- Pro: also exposes `session_create`, `session_list`, and `session_stop` tools for managing container lifecycle from within Claude Code.
- Con: custom codebase, fewer browser control features than playwright-mcp. Requires `playwright-core` and `@modelcontextprotocol/sdk` to be installed on the VPS.

**SSH passwordless setup (required for either option)**

Claude Code launches MCP servers as child processes — it cannot type a password interactively. You must configure key-based authentication before using either option.

On your laptop:

```bash
# Generate a key (skip if you already have one at ~/.ssh/id_ed25519)
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519

# Copy the public key to the VPS
ssh-copy-id root@<vps-ip>

# Verify it works without a password prompt
ssh root@<vps-ip> echo "ok"
```

You should see `ok` with no password prompt. If it hangs or asks for a password, the setup is not complete.

---

### (b) Crispy MCP — LinkedIn outreach tools

Crispy.ai provides an official MCP server that exposes tools for searching LinkedIn profiles, sending connection requests, managing leads, and more.

```json
{
  "mcpServers": {
    "crispy": {
      "command": "npx",
      "args": ["-y", "@crispy/mcp"],
      "env": {
        "CRISPY_API_KEY": "<your-crispy-key>"
      }
    }
  }
}
```

If Crispy has updated their package name or provides a different install command in their documentation, follow their instructions and place the resulting server config block under `"mcpServers"` in the combined config shown in Step 4. The structure is the same regardless of the exact package name.

---

## Step 4: Save the Combined Config

Create or edit the MCP configuration file. The correct path depends on your Claude Code version:

- **Most installations**: `~/.claude/mcp.json`
- **Some macOS installations**: `~/Library/Application Support/Claude/mcp.json`

If you are unsure, create `~/.claude/mcp.json` first. Claude Code will tell you if it is reading from a different path.

**Full combined config (Option A — recommended):**

```json
{
  "mcpServers": {
    "browser": {
      "command": "ssh",
      "args": [
        "root@<vps-ip>",
        "bash",
        "/root/linkedintest/infra/connect-mcp.sh",
        "linkedin"
      ]
    },
    "crispy": {
      "command": "npx",
      "args": ["-y", "@crispy/mcp"],
      "env": {
        "CRISPY_API_KEY": "<your-crispy-key>"
      }
    }
  }
}
```

Replace `<vps-ip>` with your VPS IP address or hostname, and `<your-crispy-key>` with your actual Crispy API key.

A ready-to-edit copy of this file is at `config/mcp.json.example` in this project. Copy it to the right location:

```bash
cp ~/linkedintest/config/mcp.json.example ~/.claude/mcp.json
# Then edit it:
nano ~/.claude/mcp.json
```

---

## Step 5: Verify the Connection

Open Claude Code:

```bash
claude
```

Type `/mcp` and press Enter. You should see both servers listed as connected:

```
browser    connected
crispy     connected
```

**Troubleshooting — browser shows red or disconnected:**

1. Confirm SSH works manually: `ssh root@<vps-ip> echo ok` — should print `ok` with no password prompt.
2. Check the container is running on the VPS: `ssh root@<vps-ip> 'docker ps --filter name=chrome-linkedin'` — should show a running container.
3. Run the bridge script manually: `ssh root@<vps-ip> bash /root/linkedintest/infra/connect-mcp.sh linkedin` — if it prints an error (e.g., "Session 'linkedin' not found"), the container is not running. Start it first.
4. Check that `npx` is available on the VPS (`which npx`) — the script uses `npx -y @playwright/mcp@latest` internally.

**Troubleshooting — crispy shows red or disconnected:**

1. Confirm your API key is correct and has no leading/trailing whitespace.
2. Run `npx @crispy/mcp` directly in a terminal to see the raw error output.
3. Check your internet connection — the Crispy MCP server calls the Crispy.ai API.

---

Next step: install the lead-gen skill. See `05-SKILL-INSTALL.md`.
