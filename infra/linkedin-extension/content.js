/**
 * Helixiri LinkedIn Bridge — Content Script
 * Runs on: *://www.linkedin.com/messaging/*
 *
 * Responsibilities:
 *  A) Inject a fetch/XHR interceptor into the PAGE context to capture Voyager API responses
 *  B) Observe the conversation list DOM for changes and push structured thread data to background
 *  C) Handle SEND_MESSAGE commands forwarded from background
 */

const LOG = '[LI-BRIDGE]';

// ---------------------------------------------------------------------------
// A) FETCH INTERCEPTOR — injected into PAGE context via <script> tag
// ---------------------------------------------------------------------------

function injectPageScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => {
      script.remove();
      console.log(LOG, 'Injected page-context script via src.');
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.warn(LOG, 'Failed to inject page script:', err);
  }
}

injectPageScript();

// ---------------------------------------------------------------------------
// A2) Listen for messages from PAGE context and relay to background
// ---------------------------------------------------------------------------

window.addEventListener('message', (event) => {
  if (!event.data || event.source !== window) return;

  if (event.data.type === 'LI_BRIDGE_API') {
    const url = event.data.url || '';
    // Parse messages from Voyager response
    if (url.includes('messengerMessages') || url.includes('messengerConversations')) {
      const parsed = parseVoyagerMessages(event.data.data);
      if (parsed && parsed.length > 0) {
        lastVoyagerMessages = parsed;
        console.log(LOG, `Parsed ${parsed.length} Voyager messages with media`);
        // Proactively download media while tokens are valid
        downloadMediaFromMessages(parsed);
      }
    }
    try {
      chrome.runtime.sendMessage({
        type: 'VOYAGER_DATA',
        url: event.data.url,
        data: event.data.data
      });
    } catch (err) {
      console.warn(LOG, 'Could not relay VOYAGER_DATA to background:', err);
    }
  }

  // Handle media download results from inject.js
  if (event.data.type === 'LI_BRIDGE_MEDIA_RESULT') {
    const { requestId, url: mediaUrl, dataUrl, size, mimeType, error } = event.data;
    if (error) {
      console.warn(LOG, `Media download failed for ${mediaUrl}: ${error}`);
      return;
    }
    console.log(LOG, `Media downloaded: ${size} bytes, ${mimeType}`);
    // Send to background for caching on MCT server
    try {
      chrome.runtime.sendMessage({
        type: 'MEDIA_DOWNLOADED',
        url: mediaUrl,
        dataUrl,
        size,
        mimeType,
      });
    } catch (err) {
      console.warn(LOG, 'Could not send media to background:', err);
    }
  }

  if (event.data.type === 'LI_BRIDGE_NAV') {
    console.log(LOG, 'SPA navigation detected:', event.data.href);
    // Re-observe after navigation (DOM may have changed)
    scheduleObserverRestart();
    debouncedExtract();
  }
});

// ---------------------------------------------------------------------------
// B) DOM OBSERVER — conversation list + active thread
// ---------------------------------------------------------------------------

const SELECTORS = {
  convList:         '.msg-conversations-container__conversations-list',
  convCards:        '.msg-conversation-listitem:not(.msg-conversation-card--occluded)',
  cardName:         '.msg-conversation-listitem__participant-names',
  cardTimestamp:    '.msg-conversation-listitem__time-stamp',
  cardPreview:      '.msg-conversation-card__message-snippet',
  cardStarred:      '.msg-conversation-card__star-icon--starred',
  cardActiveLink:   '.msg-conversations-container__convo-item-link--active',
  profileLink:      'a.msg-thread__link-to-profile',
  avatarImg:        'img[src*="profile-displayphoto"]',
  messageItems:     '.msg-s-event-listitem',
  messageSenderA:   '.msg-s-message-group__name',
  messageSenderB:   '.msg-s-event-listitem__name',
  messageBody:      '.msg-s-event-listitem__body',
  messageInput:     '.msg-form__contenteditable, [role="textbox"][contenteditable="true"]',
  sendBtnA:         '.msg-form__send-button',
  sendBtnB:         'button[type="submit"].msg-form__send-btn'
};

// Get the prospect's name from the thread header — used for isOwn detection.
// Strategy: anyone whose name ≠ prospect is "you" (the owner of this LinkedIn account).
function getProspectName() {
  const headerEl = document.querySelector('a.msg-thread__link-to-profile')
    || document.querySelector('.msg-entity-lockup__entity-title');
  if (!headerEl) return null;
  // Only take direct/shallow text — skip child elements like status badges, "Active now", etc.
  let name = '';
  for (const node of headerEl.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim();
      if (t) { name = t; break; }
    }
  }
  // If no direct text node found, try the first meaningful nested span
  if (!name) {
    for (const child of headerEl.querySelectorAll('span, h2')) {
      const t = child.textContent?.trim();
      if (t && !t.includes('Active') && !t.includes('Status') && t.length > 1) {
        name = t;
        break;
      }
    }
  }
  return name || null;
}

function parseVoyagerMessages(voyagerData) {
  const elements = voyagerData?.data?.messengerMessagesBySyncToken?.elements
    || voyagerData?.data?.messengerConversationsBySyncToken?.elements
    || [];

  if (!elements.length) return null;

  const prospectName = getProspectName();

  // Extract prospect profile ID from the header link for URN-based sender matching
  const profileLink = document.querySelector('a.msg-thread__link-to-profile');
  const prospectProfileId = profileLink?.href?.match(/\/in\/([^/?#]+)/)?.[1] ?? null;

  const parsed = [];

  for (const msg of elements) {
    const bodyText = msg.body?.text ?? '';
    const deliveredAt = msg.deliveredAt;
    const entityUrn = msg.entityUrn;

    // Resolve sender name: Voyager doesn't include participantName inline,
    // so we match the sender's hostIdentityUrn against the prospect's profile ID.
    const senderHostUrn = msg.sender?.hostIdentityUrn || msg.actor?.hostIdentityUrn || '';
    const senderProfileId = senderHostUrn.split(':').pop() || '';

    // isOwn: if sender's profile ID matches prospect → not own. Otherwise → own.
    const isProspect = prospectProfileId && senderProfileId === prospectProfileId;
    const isOwn = !isProspect;
    const sender = isProspect ? (prospectName || 'Prospect') : '';

    // Extract links from body attributes
    const bodyParts = [];
    if (bodyText) {
      const attrs = msg.body?.attributes || [];
      // Sort attributes by start position
      const linkAttrs = attrs
        .filter(a => a._type?.includes('HyperlinkAttribute') || a._type?.includes('Entity'))
        .sort((a, b) => (a.start || 0) - (b.start || 0));

      let lastIndex = 0;
      for (const attr of linkAttrs) {
        const start = attr.start || 0;
        const len = attr.length || 0;
        const url = attr.hyperlink?.url || attr.url || '';

        if (start > lastIndex) {
          bodyParts.push({ type: 'text', content: bodyText.substring(lastIndex, start) });
        }
        if (url) {
          bodyParts.push({ type: 'link', url, text: bodyText.substring(start, start + len) });
        } else {
          bodyParts.push({ type: 'text', content: bodyText.substring(start, start + len) });
        }
        lastIndex = start + len;
      }
      if (lastIndex < bodyText.length) {
        bodyParts.push({ type: 'text', content: bodyText.substring(lastIndex) });
      }

      // If no link attrs found, just use plain text with linebreaks
      if (bodyParts.length === 0) {
        const lines = bodyText.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]) bodyParts.push({ type: 'text', content: lines[i] });
          if (i < lines.length - 1) bodyParts.push({ type: 'linebreak' });
        }
      }
    }

    // Extract media from renderContent
    const media = [];
    const rc = msg.renderContent?.[0];
    if (rc) {
      if (rc.audio) {
        media.push({
          type: 'audio',
          url: rc.audio.url,
          duration: rc.audio.duration, // milliseconds
        });
      }
      if (rc.vectorImage) {
        media.push({
          type: 'image',
          url: rc.vectorImage.rootUrl,
          asset: rc.vectorImage.digitalmediaAsset,
        });
      }
      if (rc.video) {
        media.push({
          type: 'video',
          url: rc.video.url || rc.video.progressiveStreams?.[0]?.streamingLocations?.[0]?.url,
          duration: rc.video.duration,
          thumbnail: rc.video.thumbnail?.rootUrl,
        });
      }
      if (rc.hostUrnData && rc.hostUrnData.type === 'FEED_UPDATE') {
        media.push({
          type: 'linkedin_post',
          hostUrn: rc.hostUrnData.hostUrn,
          fallbackText: msg.renderContentFallbackText || '',
        });
      }
      if (rc.forwardedMessageContent) {
        const fwd = rc.forwardedMessageContent;
        media.push({
          type: 'forwarded',
          body: fwd.forwardedBody?.text ?? '',
          originalSender: fwd.originalSender?.participantName?.text ?? '',
          originalSenderPicture: fwd.originalSender?.profilePicture?.displayImageReference?.vectorImage?.rootUrl ?? null,
          originalSendAt: fwd.originalSendAt,
          footerText: fwd.footerText?.text ?? '',
        });
      }
      if (rc.file) {
        media.push({
          type: 'file',
          name: rc.file.name,
          url: rc.file.url,
          size: rc.file.byteSize,
          mediaType: rc.file.mediaType,
        });
      }
    }

    parsed.push({
      sender,
      isOwn,
      time: deliveredAt ? new Date(deliveredAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
      deliveredAt,
      entityUrn,
      body: bodyText.substring(0, 500),
      bodyParts: bodyParts.length > 0 ? bodyParts : [{ type: 'text', content: bodyText }],
      embeds: [], // DOM-only, not in Voyager
      media, // NEW: rich media from Voyager
    });
  }

  // Voyager returns newest first, reverse for chronological order
  return parsed.reverse();
}

function detectCurrentUser() {
  // no-op kept for compat; isOwn now uses prospect-name inversion
  console.log(LOG, 'isOwn detection via prospect-name inversion');
}

// --- Proactive media downloader ---
const downloadedMediaUrls = new Set();
let mediaRequestCounter = 0;

function downloadMediaFromMessages(messages) {
  for (const msg of messages) {
    for (const m of (msg.media || [])) {
      const url = m.url;
      if (!url || downloadedMediaUrls.has(url)) continue;
      if (m.type !== 'audio' && m.type !== 'image' && m.type !== 'video') continue;

      downloadedMediaUrls.add(url);
      const requestId = `media_${++mediaRequestCounter}`;
      console.log(LOG, `Requesting download: ${m.type} (${requestId})`);

      // Ask inject.js (page context) to fetch the media while tokens are valid
      window.postMessage({
        type: 'LI_BRIDGE_DOWNLOAD_MEDIA',
        url,
        requestId,
      }, '*');
    }
  }
}

let observer = null;
let debounceTimer = null;

// Persistent thread ID + profile URL maps — backed by chrome.storage.local
const threadIdMap = new Map();   // name → threadId
const profileUrlMap = new Map(); // name → profileUrl

// Load cached maps from storage on init
try {
  chrome.storage.local.get(['threadIdMap', 'profileUrlMap'], (result) => {
    if (result.threadIdMap) {
      for (const [k, v] of Object.entries(result.threadIdMap)) threadIdMap.set(k, v);
      console.log(LOG, `Loaded ${threadIdMap.size} cached threadIds from storage`);
    }
    if (result.profileUrlMap) {
      for (const [k, v] of Object.entries(result.profileUrlMap)) profileUrlMap.set(k, v);
    }
  });
} catch (e) { console.warn(LOG, 'Failed to load cached maps:', e); }

// Save maps to storage (debounced)
let saveTimer = null;
function persistMaps() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      chrome.storage.local.set({
        threadIdMap: Object.fromEntries(threadIdMap),
        profileUrlMap: Object.fromEntries(profileUrlMap),
      });
    } catch (e) { /* storage might be unavailable */ }
  }, 1000);
}

let lastVoyagerMessages = null;

function debounce(fn, delay) {
  return function(...args) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function getThreadIdFromUrl(href) {
  return href.match(/\/messaging\/thread\/([^/?#]+)/)?.[1] ?? null;
}

function extractConversationCards() {
  const cards = [];
  const cardEls = document.querySelectorAll(SELECTORS.convCards);

  for (const card of cardEls) {
    try {
      const nameEl  = card.querySelector(SELECTORS.cardName);
      const timeEl  = card.querySelector(SELECTORS.cardTimestamp);
      const previewEl = card.querySelector(SELECTORS.cardPreview);
      const starEl  = card.querySelector(SELECTORS.cardStarred);
      const linkEl  = card.querySelector('a[href*="/messaging/thread/"]');
      const avatarEl = card.querySelector(SELECTORS.avatarImg);

      const name       = nameEl?.textContent?.trim() ?? '';
      const timestamp  = timeEl?.textContent?.trim() ?? '';
      const preview    = previewEl?.textContent?.trim() ?? '';
      const isStarred  = !!starEl;
      const isActive   = !!card.querySelector(SELECTORS.cardActiveLink) ||
                         card.classList.contains('msg-conversation-listitem--active');

      // Unread: LinkedIn bolds the name when unread
      let isUnread = false;
      if (nameEl) {
        const fw = getComputedStyle(nameEl).fontWeight;
        isUnread = parseInt(fw, 10) >= 600;
      }

      const threadHref = linkEl?.href ?? '';
      let threadId     = getThreadIdFromUrl(threadHref);
      const avatarUrl  = avatarEl?.src ?? null;

      // For active card, capture threadId from URL and profile from header
      if (isActive) {
        const urlThreadId = getThreadIdFromUrl(window.location.href);
        if (urlThreadId) {
          threadId = urlThreadId;
          if (name) { threadIdMap.set(name, urlThreadId); persistMaps(); }
        }
        const profileEl = document.querySelector(SELECTORS.profileLink);
        if (profileEl?.href && name) { profileUrlMap.set(name, profileEl.href); persistMaps(); }
      }

      // Fall back to cached threadId/profileUrl for non-active cards
      if (!threadId && name) threadId = threadIdMap.get(name) || null;
      const profileUrl = (name && profileUrlMap.get(name)) || null;

      cards.push({ name, timestamp, preview, isUnread, isStarred, isActive, threadId, profileUrl, avatarUrl });
    } catch (err) {
      console.warn(LOG, 'Error extracting card:', err);
    }
  }

  return cards;
}

function extractActiveThreadMessages() {
  const messages = [];
  const events = document.querySelectorAll(SELECTORS.messageItems);
  const prospectName = getProspectName();

  for (const evt of events) {
    try {
      const senderEl = evt.querySelector('.msg-s-message-group__name')
        || evt.querySelector('.msg-s-event-listitem__name');
      const bodyEl = evt.querySelector(SELECTORS.messageBody);
      const timeEl = evt.querySelector('time') || evt.querySelector('[datetime]');

      if (!bodyEl) continue;

      const sender = senderEl?.textContent?.trim() ?? '';
      const time = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';

      // isOwn: if sender is NOT the prospect, it's you.
      // For grouped messages (sender === ''), inherit from previous message.
      let isOwn;
      if (sender === '') {
        isOwn = messages.length > 0 ? messages[messages.length - 1].isOwn : false;
      } else if (prospectName && sender === prospectName) {
        isOwn = false;
      } else {
        // Sender is present and is NOT the prospect → it's you
        isOwn = true;
      }

      // --- Extract body parts (text + links + linebreaks) ---
      const bodyParts = [];

      function walkNodes(parent) {
        for (const node of parent.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text && text.trim()) {
              bodyParts.push({ type: 'text', content: text });
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName;

            if (tag === 'BR') {
              bodyParts.push({ type: 'linebreak' });
            } else if (tag === 'A' && node.href) {
              bodyParts.push({
                type: 'link',
                url: node.href,
                text: node.textContent?.trim() || node.href
              });
            } else if (node.classList?.contains('white-space-pre')) {
              // LinkedIn uses this for spacing
              bodyParts.push({ type: 'text', content: ' ' });
            } else if (node.nodeType === Node.COMMENT_NODE) {
              // Skip Ember comments
            } else {
              // Recurse into child elements (spans, etc.)
              walkNodes(node);
            }
          }
        }
      }

      walkNodes(bodyEl);

      // --- Extract article embeds ---
      const embeds = [];
      const seenEmbedUrls = new Set();
      // Target only containers with the sizing class (top-level article cards)
      const articleCards = evt.querySelectorAll('[class*="update-components-article--with-small-image"], [class*="update-components-article--with-large-image"]');

      const processedCards = new Set();
      for (const card of articleCards) {
        if (processedCards.has(card)) continue;
        processedCards.add(card);

        const linkEl = card.querySelector('a[href]');
        const titleEl = card.querySelector('[class*="article__title"]');
        const subtitleEl = card.querySelector('[class*="article__subtitle"]');
        const imgEl = card.querySelector('img[class*="article__image"], img[class*="ivm-view-attr__img"]');

        const url = linkEl?.href ?? '';
        if (seenEmbedUrls.has(url)) continue;
        if (url) seenEmbedUrls.add(url);

        if (url || titleEl) {
          embeds.push({
            type: 'article',
            url,
            title: titleEl?.textContent?.trim() ?? '',
            subtitle: subtitleEl?.textContent?.trim() ?? '',
            imageUrl: imgEl?.src ?? null,
          });
        }
      }

      // Also check for shared LinkedIn posts (different format)
      const postCards = evt.querySelectorAll('[class*="msg-s-event-listitem__share"], [class*="feed-shared-update"]');
      for (const post of postCards) {
        if (processedCards.has(post)) continue;
        processedCards.add(post);

        const linkEl = post.querySelector('a[href]');
        const textEl = post.querySelector('[class*="feed-shared-text"], [class*="update-components-text"]');
        const imgEl = post.querySelector('img:not([class*="presence"]):not([class*="profile"])');

        if (linkEl?.href || textEl) {
          embeds.push({
            type: 'article',
            url: linkEl?.href ?? '',
            title: textEl?.textContent?.trim()?.substring(0, 120) ?? 'Shared post',
            subtitle: '',
            imageUrl: imgEl?.src ?? null,
          });
        }
      }

      messages.push({
        sender,
        isOwn,
        time,
        bodyParts: bodyParts.length > 0 ? bodyParts : [{ type: 'text', content: bodyEl.textContent?.trim() ?? '' }],
        embeds,
        // Keep plain body for backward compat
        body: bodyEl.textContent?.trim()?.substring(0, 500) ?? ''
      });
    } catch (err) {
      console.warn(LOG, 'Error extracting message item:', err);
    }
  }

  return messages;
}

function extractAndSend() {
  try {
    const threads   = extractConversationCards();
    const threadId  = getThreadIdFromUrl(window.location.href);
    const messages  = extractActiveThreadMessages();
    const profileEl = document.querySelector(SELECTORS.profileLink);
    const profileUrl = profileEl?.href ?? null;
    const activeName = profileEl?.textContent?.trim() ?? '';

    const messagesSource = lastVoyagerMessages || messages;

    const activeThread = threadId ? {
      name: activeName,
      threadId,
      profileUrl,
      messages: messagesSource
    } : null;

    const payload = {
      type: 'THREAD_LIST_UPDATE',
      threads,
      activeThread
    };

    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) {
        // Background may be sleeping — not fatal
        console.warn(LOG, 'sendMessage error:', chrome.runtime.lastError.message);
      }
    });

    console.log(LOG, `Sent update: ${threads.length} threads, activeThread=${threadId ?? 'none'}`);
  } catch (err) {
    console.warn(LOG, 'extractAndSend error:', err);
  }
}

const debouncedExtract = debounce(extractAndSend, 300);

function startObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  const target = document.querySelector(SELECTORS.convList);
  if (!target) {
    console.warn(LOG, 'Conversation list not found yet — will retry.');
    return false;
  }

  observer = new MutationObserver(debouncedExtract);
  observer.observe(target, { childList: true, subtree: true, characterData: true });

  // Also observe the message thread area (right panel)
  const threadArea = document.querySelector('.msg-s-message-list');
  if (threadArea) {
    observer.observe(threadArea, { childList: true, subtree: true, characterData: true });
  }

  console.log(LOG, 'MutationObserver started on conversation list.');
  return true;
}

let restartTimer = null;
function scheduleObserverRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!startObserver()) {
      // DOM not ready yet — retry once more after 1s
      restartTimer = setTimeout(startObserver, 1000);
    }
  }, 500);
}

// --- Auto-populate thread IDs by clicking through conversations ---
async function autoPopulateThreadIds() {
  console.log(LOG, 'Starting thread ID auto-population...');

  // Wait for DOM to be fully settled
  await sleep(2000);

  const cards = document.querySelectorAll(SELECTORS.convCards);
  if (!cards.length) {
    console.log(LOG, 'No conversation cards found, skipping auto-populate.');
    return;
  }

  // Remember which card is currently active
  const activeCard = document.querySelector(SELECTORS.cardActiveLink);
  const activeName = activeCard?.closest('.msg-conversation-listitem')
    ?.querySelector(SELECTORS.cardName)?.textContent?.trim();

  let populated = 0;

  for (const card of cards) {
    const name = card.querySelector(SELECTORS.cardName)?.textContent?.trim();
    if (!name) continue;

    // Skip if we already have a threadId for this name
    if (threadIdMap.has(name)) continue;

    // Click the card's clickable area
    const clickTarget = card.querySelector('.msg-conversation-listitem__link') || card;
    clickTarget.click();

    // Wait for URL to update
    await sleep(800);

    const urlThreadId = getThreadIdFromUrl(window.location.href);
    if (urlThreadId) {
      threadIdMap.set(name, urlThreadId);
      populated++;
      console.log(LOG, `Auto-populated threadId for "${name}": ${urlThreadId.substring(0, 25)}...`);
    }

    // Also capture profile URL from header
    const profileEl = document.querySelector(SELECTORS.profileLink);
    if (profileEl?.href) {
      profileUrlMap.set(name, profileEl.href);
    }
  }

  // Persist all populated maps
  persistMaps();

  // Return to the original active conversation
  if (activeName && threadIdMap.has(activeName)) {
    const origCard = [...document.querySelectorAll(SELECTORS.convCards)].find(c =>
      c.querySelector(SELECTORS.cardName)?.textContent?.trim() === activeName
    );
    if (origCard) {
      const clickTarget = origCard.querySelector('.msg-conversation-listitem__link') || origCard;
      clickTarget.click();
      await sleep(500);
    }
  }

  console.log(LOG, `Auto-population complete: ${populated} new threadIds populated.`);

  // Do a final extraction and push
  extractAndSend();
}

// Initial setup — wait briefly for LinkedIn's React to render
setTimeout(async () => {
  detectCurrentUser();
  if (!startObserver()) {
    scheduleObserverRestart();
  }
  // Initial data push
  extractAndSend();

  // Auto-populate thread IDs after initial extraction
  // Use chrome.storage.local to check if we've already populated recently
  chrome.storage.local.get('lastAutoPopulate', async (result) => {
    const lastRun = result.lastAutoPopulate || 0;
    const hoursSince = (Date.now() - lastRun) / (1000 * 60 * 60);
    // Only auto-populate if we haven't done it in the last hour
    if (hoursSince > 1) {
      await autoPopulateThreadIds();
      chrome.storage.local.set({ lastAutoPopulate: Date.now() });
    } else {
      console.log(LOG, 'Skipping auto-populate (last run was', Math.round(hoursSince * 60), 'minutes ago)');
    }
  });
}, 1500);

// ---------------------------------------------------------------------------
// C) MESSAGE SENDING — commanded from background
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SEND_MESSAGE') {
    console.log(LOG, `SEND_MESSAGE command received: threadId=${msg.threadId}`);
    sendMessageToThread(msg.threadId, msg.text)
      .then(result => {
        console.log(LOG, 'sendMessageToThread result:', result);
        sendResponse(result);
      })
      .catch(err => {
        console.warn(LOG, 'sendMessageToThread threw:', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true; // Keep channel open for async response
  }

  if (msg.type === 'NAVIGATE_TO_THREAD') {
    console.log(LOG, `NAVIGATE_TO_THREAD: ${msg.threadId}`);
    window.location.href = `https://www.linkedin.com/messaging/thread/${msg.threadId}/`;
    // The page will reload, content script re-injects, MutationObserver fires, messages get extracted
    sendResponse({ success: true });
    return true;
  }
});

async function sendMessageToThread(threadId, text) {
  if (!threadId || !text) {
    return { success: false, error: 'Missing threadId or text' };
  }

  // 1. Navigate to the thread if we're not already there
  const currentThread = getThreadIdFromUrl(window.location.href);
  if (currentThread !== threadId) {
    console.log(LOG, `Navigating to thread ${threadId} (currently on ${currentThread ?? 'none'})`);
    window.location.href = `https://www.linkedin.com/messaging/thread/${threadId}/`;
    await sleep(2500); // Wait for LinkedIn SPA to render the thread
  }

  // 2. Find the message input
  const input = document.querySelector(SELECTORS.messageInput);
  if (!input) {
    return { success: false, error: 'Message input not found' };
  }

  // 3. Focus and insert text — execCommand triggers React/Ember handlers
  input.focus();
  const inserted = document.execCommand('insertText', false, text);
  if (!inserted) {
    // Fallback: set innerHTML and dispatch input event
    console.warn(LOG, 'execCommand insertText returned false — trying fallback');
    input.textContent = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  await sleep(400);

  // 4. Find and click the send button
  let sendBtn = document.querySelector(SELECTORS.sendBtnA) ||
                document.querySelector(SELECTORS.sendBtnB);

  if (!sendBtn) {
    // Broader search: any visible button whose text is "Send"
    sendBtn = [...document.querySelectorAll('button')].find(
      b => b.textContent.trim().toLowerCase() === 'send' && !b.disabled
    );
  }

  if (!sendBtn) {
    return { success: false, error: 'Send button not found' };
  }

  sendBtn.click();
  console.log(LOG, `Message sent to thread ${threadId}.`);
  return { success: true };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

console.log(LOG, 'Content script loaded on', window.location.href);
