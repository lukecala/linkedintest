/**
 * Helixiri LinkedIn Bridge — Background Service Worker
 *
 * Responsibilities:
 *  - Receives THREAD_LIST_UPDATE and VOYAGER_DATA from the content script
 *  - Maintains in-memory state of all threads, messages, and raw Voyager data
 *  - POSTs state to MCT at http://localhost:5548/api/linkedin/inbox
 *  - Polls http://localhost:5548/api/linkedin/outbox every 3 seconds for send commands
 *  - Forwards SEND_MESSAGE commands to the LinkedIn tab's content script
 *  - Acknowledges delivered messages via POST to /outbox/:id/ack
 */

const LOG = '[LI-BRIDGE BG]';
// Docker containers reach host services via the Docker gateway IP
const MCT_BASE = 'http://172.18.0.1:5548/api/linkedin';
const OUTBOX_POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS   = 10000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  threads:      [],
  activeThread: null,
  voyagerData:  null,
  lastUpdate:   null
};

// Track message IDs currently being processed to avoid duplicate sends
const inFlightMessages = new Set();

// ---------------------------------------------------------------------------
// Message handler — receives from content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.type === 'THREAD_LIST_UPDATE') {
      state.threads      = msg.threads      ?? state.threads;
      state.activeThread = msg.activeThread ?? state.activeThread;
      state.lastUpdate   = new Date().toISOString();
      console.log(
        LOG,
        `THREAD_LIST_UPDATE: ${state.threads.length} threads,`,
        `activeThread=${state.activeThread?.threadId ?? 'none'}`
      );
      pushToMCT();
    }

    if (msg.type === 'VOYAGER_DATA') {
      // Merge rather than replace so multiple API calls accumulate
      state.voyagerData = msg.data;
      state.lastUpdate  = new Date().toISOString();
      console.log(LOG, 'VOYAGER_DATA received from', msg.url);
      pushToMCT();
    }

    if (msg.type === 'MEDIA_DOWNLOADED') {
      // Cache the media file on the MCT server
      cacheMediaOnMCT(msg.url, msg.dataUrl, msg.mimeType);
    }
  } catch (err) {
    console.warn(LOG, 'onMessage handler error:', err);
  }
});

// ---------------------------------------------------------------------------
// Push state to MCT inbox
// ---------------------------------------------------------------------------

async function pushToMCT() {
  try {
    const body = JSON.stringify({
      threads:      state.threads,
      activeThread: state.activeThread,
      voyagerData:  state.voyagerData,
      lastUpdate:   state.lastUpdate
    });

    const resp = await fetch(`${MCT_BASE}/inbox`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (!resp.ok) {
      console.warn(LOG, `pushToMCT: MCT returned HTTP ${resp.status}`);
    } else {
      console.log(LOG, 'pushToMCT: state pushed successfully.');
    }
  } catch (err) {
    // MCT may be temporarily down — silent fail to avoid log spam
    // Only log at debug level
    // console.debug(LOG, 'pushToMCT: fetch failed (MCT may be down):', err.message);
  }
}

// ---------------------------------------------------------------------------
// Cache media files on MCT server
// ---------------------------------------------------------------------------

async function cacheMediaOnMCT(sourceUrl, dataUrl, mimeType) {
  try {
    const resp = await fetch(`${MCT_BASE}/media/cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl, dataUrl, mimeType })
    });
    if (resp.ok) {
      console.log(LOG, `cacheMediaOnMCT: cached ${mimeType} (${sourceUrl.substring(0, 60)}...)`);
    } else {
      console.warn(LOG, `cacheMediaOnMCT: MCT returned ${resp.status}`);
    }
  } catch (err) {
    // Silent fail — MCT may be down
  }
}

// ---------------------------------------------------------------------------
// Poll outbox for pending send commands
// ---------------------------------------------------------------------------

async function pollOutbox() {
  try {
    const resp = await fetch(`${MCT_BASE}/outbox`, {
      method:  'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!resp.ok) {
      // Not a connection error — MCT is up but returned an error status
      console.warn(LOG, `pollOutbox: MCT returned HTTP ${resp.status}`);
      return;
    }

    const data = await resp.json();
    const messages = data?.messages ?? [];

    if (messages.length === 0) {
      // Check for navigation command even when no messages are pending
      const navTarget = data?.navigateToThread;
      if (navTarget) {
        console.log(LOG, `pollOutbox: navigating tab to thread ${navTarget}`);
        const tabs = await chrome.tabs.query({ url: '*://www.linkedin.com/messaging/*' });
        const tab = tabs[0];
        if (tab) {
          // Use chrome.tabs.update for reliable navigation — doesn't depend on content script
          await chrome.tabs.update(tab.id, {
            url: `https://www.linkedin.com/messaging/thread/${navTarget}/`
          });
        } else {
          console.warn(LOG, 'pollOutbox: no LinkedIn messaging tab found for navigation');
        }
      }
      return;
    }

    console.log(LOG, `pollOutbox: ${messages.length} pending message(s).`);

    // Find the LinkedIn messaging tab
    let tabs;
    try {
      tabs = await chrome.tabs.query({ url: '*://www.linkedin.com/messaging/*' });
    } catch (tabErr) {
      console.warn(LOG, 'pollOutbox: tabs.query failed:', tabErr);
      return;
    }

    const tab = tabs[0] ?? null;
    if (!tab) {
      console.warn(LOG, 'pollOutbox: no LinkedIn messaging tab found — messages held.');
      return;
    }

    for (const msg of messages) {
      if (!msg.id || !msg.threadId || !msg.text) {
        console.warn(LOG, 'pollOutbox: skipping malformed message:', msg);
        continue;
      }

      if (inFlightMessages.has(msg.id)) {
        // Already being processed — skip
        continue;
      }

      inFlightMessages.add(msg.id);

      try {
        console.log(LOG, `pollOutbox: forwarding msg ${msg.id} to thread ${msg.threadId}`);

        const result = await chrome.tabs.sendMessage(tab.id, {
          type:     'SEND_MESSAGE',
          threadId: msg.threadId,
          text:     msg.text
        });

        if (result?.success) {
          // Acknowledge delivery
          await ackMessage(msg.id);
          console.log(LOG, `pollOutbox: msg ${msg.id} delivered and acked.`);
        } else {
          console.warn(LOG, `pollOutbox: msg ${msg.id} failed to send:`, result?.error ?? 'unknown');
          // Don't ack — MCT can retry
        }
      } catch (sendErr) {
        console.warn(LOG, `pollOutbox: error forwarding msg ${msg.id}:`, sendErr);
      } finally {
        inFlightMessages.delete(msg.id);
      }
    }

    // Check for navigation command
    const navTarget = data?.navigateToThread;
    if (navTarget) {
      console.log(LOG, `pollOutbox: navigating tab to thread ${navTarget}`);
      const tabs = await chrome.tabs.query({ url: '*://www.linkedin.com/messaging/*' });
      const tab = tabs[0];
      if (tab) {
        await chrome.tabs.update(tab.id, {
          url: `https://www.linkedin.com/messaging/thread/${navTarget}/`
        });
      }
    }
  } catch (err) {
    // Network error or MCT down — expected when MCT is not running
    // console.debug(LOG, 'pollOutbox fetch error:', err.message);
  }
}

async function ackMessage(messageId) {
  try {
    const resp = await fetch(`${MCT_BASE}/outbox/${messageId}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!resp.ok) {
      console.warn(LOG, `ackMessage: MCT returned HTTP ${resp.status} for msg ${messageId}`);
    }
  } catch (err) {
    console.warn(LOG, `ackMessage: failed to ack msg ${messageId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

// Poll outbox every 3 seconds
const outboxInterval = setInterval(pollOutbox, OUTBOX_POLL_INTERVAL_MS);

// Heartbeat: push current state every 10 seconds so MCT knows the bridge is alive
const heartbeatInterval = setInterval(() => {
  state.lastUpdate = new Date().toISOString();
  pushToMCT();
}, HEARTBEAT_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Service worker install/activate lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', () => {
  console.log(LOG, 'Service worker installed.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(LOG, 'Service worker activated.');
  event.waitUntil(clients.claim());
});

console.log(LOG, 'Background service worker started. Polling outbox every', OUTBOX_POLL_INTERVAL_MS, 'ms.');
