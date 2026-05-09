#!/usr/bin/env node
/**
 * Browser Manager MCP Server
 *
 * Single MCP entry that dynamically creates/stops browser sessions
 * and provides Playwright-based browser control for any session.
 *
 * Tools:
 *   session_create(id)     — spin up a new Chrome container
 *   session_list()         — list active sessions
 *   session_stop(id)       — stop container (profile persists)
 *   browser_navigate(session_id, url)
 *   browser_click(session_id, selector)
 *   browser_type(session_id, selector, text)
 *   browser_screenshot(session_id)
 *   browser_snapshot(session_id)     — accessibility tree
 *   browser_scroll(session_id, direction)
 *   browser_press_key(session_id, key)
 *   browser_evaluate(session_id, expression)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium } from "playwright-core";
import { z } from "zod";

const SESSION_API =
  process.env.BROWSER_SESSION_API || "http://127.0.0.1:8080";

// ── Connection pool ──────────────────────────────────
// session-id → { browser, page }
const pool = new Map();

async function getPage(sessionId) {
  if (pool.has(sessionId)) {
    const entry = pool.get(sessionId);
    // Check if page is still alive
    try {
      await entry.page.title();
      return entry.page;
    } catch {
      pool.delete(sessionId);
    }
  }

  // Resolve container IP
  const res = await fetch(`${SESSION_API}/api/sessions`);
  const sessions = await res.json();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session '${sessionId}' not found. Create it first with session_create.`);

  // Get container IP via Docker inspect
  const { execSync } = await import("node:child_process");
  const ip = execSync(
    `sg docker -c "docker inspect chrome-${sessionId} --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'"`,
    { encoding: "utf-8" },
  ).trim();

  if (!ip) throw new Error(`Cannot resolve IP for chrome-${sessionId}`);

  // Get CDP endpoint
  const cdpRes = await fetch(`http://${ip}:9222/json/version`);
  const cdpInfo = await cdpRes.json();
  const wsUrl = cdpInfo.webSocketDebuggerUrl;

  // Connect Playwright
  const browser = await chromium.connectOverCDP(wsUrl);
  const contexts = browser.contexts();
  const context = contexts[0] || (await browser.newContext());
  const pages = context.pages();
  const page = pages[0] || (await context.newPage());

  pool.set(sessionId, { browser, page });
  return page;
}

// ── MCP Server ───────────────────────────────────────
const server = new McpServer({
  name: "browser-manager",
  version: "1.0.0",
});

// Session management
server.tool(
  "session_create",
  "Create a new browser container session",
  { id: z.string().describe("Session identifier (e.g. 'linkedin', 'twitter')") },
  async ({ id }) => {
    const res = await fetch(`${SESSION_API}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }] };
    return { content: [{ type: "text", text: `Session '${id}' created. Container: ${data.containerId?.slice(0, 12)}` }] };
  },
);

server.tool(
  "session_list",
  "List all active browser sessions",
  {},
  async () => {
    const res = await fetch(`${SESSION_API}/api/sessions`);
    const sessions = await res.json();
    if (sessions.length === 0) return { content: [{ type: "text", text: "No active sessions" }] };
    const lines = sessions.map((s) => `• ${s.id} (${s.containerId?.slice(0, 12)})`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.tool(
  "session_stop",
  "Stop a browser session (profile is preserved on disk)",
  { id: z.string().describe("Session identifier to stop") },
  async ({ id }) => {
    // Disconnect Playwright if connected
    if (pool.has(id)) {
      try { await pool.get(id).browser.close(); } catch {}
      pool.delete(id);
    }
    const res = await fetch(`${SESSION_API}/api/sessions/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }] };
    return { content: [{ type: "text", text: `Session '${id}' stopped. Profile preserved at ${data.profilePath}` }] };
  },
);

// Browser control
server.tool(
  "browser_navigate",
  "Navigate to a URL in a browser session",
  {
    session_id: z.string().describe("Session to control"),
    url: z.string().describe("URL to navigate to"),
  },
  async ({ session_id, url }) => {
    const page = await getPage(session_id);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return { content: [{ type: "text", text: `Navigated to ${await page.title()} (${page.url()})` }] };
  },
);

server.tool(
  "browser_screenshot",
  "Take a screenshot of the current page",
  {
    session_id: z.string().describe("Session to screenshot"),
  },
  async ({ session_id }) => {
    const page = await getPage(session_id);
    const buf = await page.screenshot({ type: "jpeg", quality: 70 });
    return {
      content: [
        { type: "text", text: `Screenshot of ${page.url()}` },
        { type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" },
      ],
    };
  },
);

server.tool(
  "browser_click",
  "Click an element on the page",
  {
    session_id: z.string().describe("Session to control"),
    selector: z.string().describe("CSS selector or text content to click"),
  },
  async ({ session_id, selector }) => {
    const page = await getPage(session_id);
    // Try CSS selector first, fallback to text
    try {
      await page.click(selector, { timeout: 5000 });
    } catch {
      await page.getByText(selector, { exact: false }).first().click({ timeout: 5000 });
    }
    return { content: [{ type: "text", text: `Clicked '${selector}'` }] };
  },
);

server.tool(
  "browser_type",
  "Type text into a focused element or a selector",
  {
    session_id: z.string().describe("Session to control"),
    selector: z.string().describe("CSS selector to type into"),
    text: z.string().describe("Text to type"),
  },
  async ({ session_id, selector, text }) => {
    const page = await getPage(session_id);
    await page.fill(selector, text, { timeout: 5000 });
    return { content: [{ type: "text", text: `Typed into '${selector}'` }] };
  },
);

server.tool(
  "browser_press_key",
  "Press a keyboard key",
  {
    session_id: z.string().describe("Session to control"),
    key: z.string().describe("Key to press (e.g. 'Enter', 'Tab', 'PageDown')"),
  },
  async ({ session_id, key }) => {
    const page = await getPage(session_id);
    await page.keyboard.press(key);
    return { content: [{ type: "text", text: `Pressed '${key}'` }] };
  },
);

server.tool(
  "browser_scroll",
  "Scroll the page",
  {
    session_id: z.string().describe("Session to control"),
    direction: z.enum(["up", "down"]).describe("Scroll direction"),
    amount: z.number().optional().describe("Pixels to scroll (default 500)"),
  },
  async ({ session_id, direction, amount }) => {
    const page = await getPage(session_id);
    const px = amount ?? 500;
    await page.mouse.wheel(0, direction === "down" ? px : -px);
    return { content: [{ type: "text", text: `Scrolled ${direction} ${px}px` }] };
  },
);

server.tool(
  "browser_snapshot",
  "Get the accessibility tree of the current page (for finding elements)",
  {
    session_id: z.string().describe("Session to inspect"),
  },
  async ({ session_id }) => {
    const page = await getPage(session_id);
    const snapshot = await page.accessibility.snapshot();
    return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
  },
);

server.tool(
  "browser_evaluate",
  "Evaluate JavaScript on the page",
  {
    session_id: z.string().describe("Session to control"),
    expression: z.string().describe("JavaScript expression to evaluate"),
  },
  async ({ session_id, expression }) => {
    const page = await getPage(session_id);
    const result = await page.evaluate(expression);
    return { content: [{ type: "text", text: String(result ?? "undefined") }] };
  },
);

// ── Start ────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
