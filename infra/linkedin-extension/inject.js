(function() {
  if (window.__LI_BRIDGE_INJECTED__) return;
  window.__LI_BRIDGE_INJECTED__ = true;

  // --- Fetch interceptor ---
  const WATCHED_PATTERNS = ['voyagerMessagingGraphQL', 'messaging/conversations', 'voyagerMessaging'];

  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    if (WATCHED_PATTERNS.some(p => url.includes(p))) {
      try {
        const clone = response.clone();
        const data = await clone.json();
        window.postMessage({ type: 'LI_BRIDGE_API', url, data }, '*');
      } catch(e) {}
    }
    return response;
  };

  // --- XHR interceptor (fallback for older LinkedIn code paths) ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._li_bridge_url = url || '';
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (WATCHED_PATTERNS.some(p => (this._li_bridge_url || '').includes(p))) {
      this.addEventListener('load', function() {
        try {
          const data = JSON.parse(this.responseText);
          window.postMessage({ type: 'LI_BRIDGE_API', url: this._li_bridge_url, data }, '*');
        } catch(e) {}
      });
    }
    return origSend.apply(this, args);
  };

  // --- URL change detection (SPA navigation) ---
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  function onNavigation() {
    window.postMessage({ type: 'LI_BRIDGE_NAV', href: window.location.href }, '*');
  }

  history.pushState = function(...args) {
    origPushState.apply(this, args);
    onNavigation();
  };

  history.replaceState = function(...args) {
    origReplaceState.apply(this, args);
    onNavigation();
  };

  window.addEventListener('popstate', onNavigation);

  // --- Media downloader: fetch LinkedIn media URLs while tokens are valid ---
  // Content script sends LI_BRIDGE_DOWNLOAD_MEDIA, we fetch and return base64
  window.addEventListener('message', async (event) => {
    if (event.data?.type !== 'LI_BRIDGE_DOWNLOAD_MEDIA') return;
    const { url, requestId } = event.data;
    try {
      const resp = await origFetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.onload = () => {
        window.postMessage({
          type: 'LI_BRIDGE_MEDIA_RESULT',
          requestId,
          url,
          dataUrl: reader.result,
          size: blob.size,
          mimeType: blob.type,
        }, '*');
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      window.postMessage({
        type: 'LI_BRIDGE_MEDIA_RESULT',
        requestId,
        url,
        error: e.message,
      }, '*');
    }
  });

  console.log('[LI-BRIDGE] Page-context interceptors installed.');
})();
