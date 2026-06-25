/* Mneme background service worker.
 *
 * The single place that talks to the Mneme API. Content scripts and the popup
 * never call the server directly — they message the worker, which holds the
 * auth token and (via host_permissions) is exempt from page CORS.
 *
 * Flow per page: content.js extracts readable text -> 'observe' -> we ask the
 * brain whether a fading memory is worth surfacing now (context), return the
 * candidate for an in-page toast, then capture the page in the background so it
 * becomes part of what Mneme knows.
 */

const DEFAULT_API = 'http://localhost:5000';

async function getConfig() {
  const c = await chrome.storage.local.get(['apiUrl', 'token', 'user', 'paused']);
  return {
    apiUrl: c.apiUrl || DEFAULT_API,
    token: c.token || null,
    user: c.user || null,
    paused: !!c.paused,
  };
}

async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const { apiUrl, token } = await getConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

// De-dupe rapid re-observes of the same page (SPA route changes, scroll, etc.).
const recentlyObserved = new Map(); // key -> timestamp
const OBSERVE_COOLDOWN_MS = 60_000;

async function login(email, password) {
  const data = await apiFetch('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
  await setConfig({ token: data.token, user: data.user });
  return { user: data.user };
}

async function capturePage({ text, url, title }) {
  if (!text || !text.trim()) return { kept: false };
  return apiFetch('/api/mneme/capture', {
    method: 'POST',
    body: {
      text: text.slice(0, 6000),
      source: { kind: 'browser', identifier: hostnameOf(url), label: title || hostnameOf(url) },
      originRef: url,
    },
  });
}

async function contextFor({ text, title }) {
  // Bias the context query toward the page's gist (title + a readable excerpt).
  const query = [title, text].filter(Boolean).join('. ').slice(0, 1200);
  const data = await apiFetch('/api/mneme/context', { method: 'POST', body: { text: query } });
  return data.candidate || null;
}

async function handleObserve(payload, sender) {
  const cfg = await getConfig();
  if (!cfg.token || cfg.paused) return { candidate: null };

  const key = `${sender?.tab?.id ?? 'x'}:${payload.url}`;
  const last = recentlyObserved.get(key) || 0;
  if (Date.now() - last < OBSERVE_COOLDOWN_MS) return { candidate: null, throttled: true };
  recentlyObserved.set(key, Date.now());

  // 1) Resurface based on the CURRENT (pre-capture) memory state.
  let candidate = null;
  try { candidate = await contextFor(payload); } catch { /* stay quiet on errors */ }

  // 2) Then quietly observe the page so it becomes part of memory.
  capturePage(payload).catch(() => {});

  // Reflect a surfaced cue on the toolbar badge.
  if (candidate) {
    chrome.action.setBadgeText({ text: '1', tabId: sender?.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#6c8cff', tabId: sender?.tab?.id });
  }
  return { candidate };
}

async function handleRecall(payload) {
  try {
    return await apiFetch('/api/mneme/recall', { method: 'POST', body: payload });
  } catch (e) {
    return { error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'login':
          sendResponse(await login(msg.email, msg.password));
          break;
        case 'logout':
          await setConfig({ token: null, user: null });
          sendResponse({ ok: true });
          break;
        case 'status':
          sendResponse(await getConfig());
          break;
        case 'setPaused':
          await setConfig({ paused: !!msg.paused });
          sendResponse({ ok: true });
          break;
        case 'setApiUrl':
          await setConfig({ apiUrl: msg.apiUrl || DEFAULT_API });
          sendResponse({ ok: true });
          break;
        case 'observe':
          sendResponse(await handleObserve(msg.payload, sender));
          break;
        case 'recall':
          sendResponse(await handleRecall(msg.payload));
          break;
        case 'captureNow':
          sendResponse(await capturePage(msg.payload).catch((e) => ({ error: e.message })));
          break;
        default:
          sendResponse({ error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ error: e.message, status: e.status });
    }
  })();
  return true; // async response
});
