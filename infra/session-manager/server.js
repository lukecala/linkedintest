import express from "express";
import Docker from "dockerode";
import httpProxy from "http-proxy";
import http from "node:http";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const NETWORK = process.env.DOCKER_NETWORK || "browser-net";
const PORT = parseInt(process.env.SESSION_MANAGER_PORT || "8080", 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "4", 10);
const CHROME_IMAGE = process.env.CHROME_IMAGE || "browser-chrome";
const PROFILE_BASE = process.env.PROFILE_BASE || "/data/browser-profiles";
const CONTAINER_PREFIX = "chrome-";
const EXTENSIONS_BASE = process.env.EXTENSIONS_BASE || "/data/browser-extensions";

// Track active sessions: id → { containerId, containerName, ip, status }
const sessions = new Map();

const app = express();
app.use(express.json());

// ── Helpers ──────────────────────────────────────────

async function waitForCdp(host, port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${host}:${port}/json/version`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`CDP not ready after ${timeoutMs}ms`);
}

async function getContainerIp(container) {
  const info = await container.inspect();
  const networks = info.NetworkSettings?.Networks || {};
  return networks[NETWORK]?.IPAddress || null;
}

async function registerSession(id, container, status = "running") {
  const ip = await getContainerIp(container);
  sessions.set(id, {
    containerId: container.id,
    containerName: `${CONTAINER_PREFIX}${id}`,
    ip,
    status,
  });
  return ip;
}

// ── Recover existing containers on startup ───────────

async function recoverSessions() {
  try {
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
      const name = (c.Names[0] || "").replace(/^\//, "");
      if (!name.startsWith(CONTAINER_PREFIX)) continue;
      const id = name.slice(CONTAINER_PREFIX.length);
      const container = docker.getContainer(c.Id);
      if (c.State === "running") {
        const ip = await getContainerIp(container);
        sessions.set(id, { containerId: c.Id, containerName: name, ip, status: "running" });
        console.log(`  Recovered: ${id} (running, IP ${ip})`);
      } else {
        // Stopped/exited — clean up container, keep as stopped slot
        try { await container.remove().catch(() => {}); } catch {}
        sessions.set(id, { containerId: null, containerName: name, ip: null, status: "stopped" });
        console.log(`  Recovered: ${id} (stopped, container cleaned)`);
      }
    }
  } catch (err) {
    console.error("[session-manager] Recovery failed:", err.message);
  }
}

// ── Health ───────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  const running = [...sessions.values()].filter((s) => s.status === "running").length;
  res.json({ ok: true, sessions: sessions.size, running, max: MAX_SESSIONS });
});

// ── List sessions ────────────────────────────────────

app.get("/api/sessions", (_req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    const hasNetwork = s.status === "running" && s.ip;
    list.push({
      id,
      containerId: s.containerId,
      status: s.status,
      cdpEndpoint: hasNetwork ? `ws://localhost:${PORT}/ws/${id}` : null,
      liveViewUrl: hasNetwork ? `http://localhost:${PORT}/view/${id}/vnc.html` : null,
    });
  }
  res.json(list);
});

// ── Create session ───────────────────────────────────

app.post("/api/sessions", async (req, res) => {
  const id = req.body.id || `s-${Date.now()}`;
  const containerName = `${CONTAINER_PREFIX}${id}`;

  // If session exists and is running, reject
  if (sessions.has(id)) {
    const existing = sessions.get(id);
    if (existing.status === "running") {
      return res.status(409).json({ error: "Session already running", id });
    }
    // Stopped — remove stale slot, fall through to create fresh
    sessions.delete(id);
  }

  const running = [...sessions.values()].filter((s) => s.status === "running").length;
  if (running >= MAX_SESSIONS) {
    return res.status(429).json({ error: "Max running sessions reached", max: MAX_SESSIONS });
  }

  try {
    const binds = [`${PROFILE_BASE}/${id}:/data/profile`];
    // Mount extensions directory if it exists
    binds.push(`${EXTENSIONS_BASE}:/data/extensions:ro`);

    const container = await docker.createContainer({
      Image: CHROME_IMAGE,
      name: containerName,
      HostConfig: {
        Binds: binds,
        ShmSize: 268435456,
        NetworkMode: NETWORK,
      },
      ExposedPorts: { "9222/tcp": {}, "6080/tcp": {} },
    });

    await container.start();
    const ip = await registerSession(id, container, "running");
    await waitForCdp(ip, 9222, 30000);

    res.status(201).json({
      id,
      containerId: container.id,
      resumed: false,
      cdpEndpoint: `ws://localhost:${PORT}/ws/${id}`,
      liveViewUrl: `http://localhost:${PORT}/view/${id}/vnc.html`,
    });
  } catch (err) {
    try {
      const c = docker.getContainer(containerName);
      await c.stop().catch(() => {});
      await c.remove().catch(() => {});
    } catch {}
    sessions.delete(id);
    res.status(500).json({ error: err.message });
  }
});

// ── Stop session (full stop + remove, profile stays on disk) ─

app.patch("/api/sessions/:id/stop", async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status === "stopped") return res.json({ ok: true, id, status: "already stopped" });

  try {
    const container = docker.getContainer(session.containerId);
    await container.stop().catch(() => {});
    await container.remove().catch(() => {});
    session.status = "stopped";
    session.ip = null;
    session.containerId = null;
    res.json({ ok: true, id, status: "stopped" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start session (recreate container with same profile) ─────

app.patch("/api/sessions/:id/start", async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status === "running") return res.json({ ok: true, id, status: "already running" });

  const containerName = `${CONTAINER_PREFIX}${id}`;

  try {
    // Remove leftover container if exists
    try {
      const old = docker.getContainer(containerName);
      await old.stop().catch(() => {});
      await old.remove().catch(() => {});
    } catch {}

    // Create fresh container with same profile
    const binds = [`${PROFILE_BASE}/${id}:/data/profile`];
    binds.push(`${EXTENSIONS_BASE}:/data/extensions:ro`);

    const container = await docker.createContainer({
      Image: CHROME_IMAGE,
      name: containerName,
      HostConfig: {
        Binds: binds,
        ShmSize: 268435456,
        NetworkMode: NETWORK,
      },
      ExposedPorts: { "9222/tcp": {}, "6080/tcp": {} },
    });

    await container.start();
    const ip = await registerSession(id, container, "running");
    if (!ip) throw new Error("Could not determine container IP");
    await waitForCdp(ip, 9222, 30000);

    res.json({ ok: true, id, status: "running" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete session (full removal) ────────────────────

app.delete("/api/sessions/:id", async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  try {
    const container = docker.getContainer(session.containerId);
    await container.stop().catch(() => {});
    await container.remove().catch(() => {});
  } catch {}

  sessions.delete(id);
  res.json({ ok: true, id, deleted: true, profilePath: `${PROFILE_BASE}/${id}` });
});

// ── HTTP server + WebSocket proxy ────────────────────

const proxy = httpProxy.createProxyServer({ ws: true });

proxy.on("error", (err, _req, res) => {
  console.error("[proxy]", err.message);
  if (res.writeHead) res.writeHead(502).end("Bad Gateway");
});

const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";

  const cdpMatch = url.match(/^\/ws\/([^/?]+)/);
  if (cdpMatch) {
    const session = sessions.get(cdpMatch[1]);
    if (!session || !session.ip) { socket.destroy(); return; }
    const target = `ws://${session.ip}:9222`;
    req.url = url.replace(`/ws/${cdpMatch[1]}`, "") || "/";
    proxy.ws(req, socket, head, { target, ws: true });
    return;
  }

  const vncMatch = url.match(/^\/view\/([^/]+)\/websockify/);
  if (vncMatch) {
    const session = sessions.get(vncMatch[1]);
    if (!session || !session.ip) { socket.destroy(); return; }
    const target = `ws://${session.ip}:6080`;
    req.url = "/websockify";
    proxy.ws(req, socket, head, { target, ws: true });
    return;
  }

  socket.destroy();
});

app.get("/view/:id/*", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session || !session.ip) return res.status(404).json({ error: "Session not available" });

  const path = req.params[0] || "vnc.html";
  const target = `http://${session.ip}:6080`;
  req.url = `/${path}`;
  proxy.web(req, res, { target });
});

// ── Start ────────────────────────────────────────────

async function main() {
  console.log("[session-manager] Recovering existing sessions...");
  await recoverSessions();

  server.listen(PORT, () => {
    console.log(`[session-manager] Listening on :${PORT}`);
    console.log(`[session-manager] Network: ${NETWORK}`);
    console.log(`[session-manager] Max running: ${MAX_SESSIONS}`);
    console.log(`[session-manager] Profiles: ${PROFILE_BASE}`);
    console.log(`[session-manager] Sessions: ${sessions.size} recovered`);
  });
}

main();

// ── Graceful shutdown (stop only, don't remove) ──────

async function cleanup() {
  console.log("[session-manager] Shutting down (containers kept alive)...");
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
