/* Mneme content script.
 *
 * Mneme never barges in. On a content page it shows a small launcher asking if
 * you want help here. Only if you opt in does it analyse the page and show an
 * in-page panel: what you should RECALL (your own fading knowledge) and what's
 * NEW to LEARN — each with instant "now" or "later" actions. Search engines and
 * the Mneme app itself are skipped entirely.
 */
(() => {
  if (window.top !== window.self) return; // top frame only

  // Don't run on the Mneme app or API itself (avoids self-capture / feedback).
  const SELF_HOSTS = new Set(['localhost', '127.0.0.1']);
  const SELF_PORTS = new Set(['5173', '5000']);
  if (SELF_HOSTS.has(location.hostname) && SELF_PORTS.has(location.port)) return;

  // Skip search engines and other "I'm just navigating" surfaces — Mneme is for
  // reading/learning pages, not search result pages. Generic, not per-site.
  const SEARCH_HOST_RES = [
    /^(www\.)?google\.[a-z.]+$/, /^(www\.)?bing\.com$/, /^(www\.)?duckduckgo\.com$/,
    /^search\.yahoo\.com$/, /^(www\.)?baidu\.com$/, /^(www\.)?yandex\.[a-z.]+$/,
    /^(www\.)?ecosia\.org$/, /^(www\.)?startpage\.com$/, /^search\.brave\.com$/,
    /^(www\.)?qwant\.com$/, /^(www\.)?ask\.com$/, /^(www\.)?kagi\.com$/, /searx/,
  ];
  function isSearchHost(host) {
    return SEARCH_HOST_RES.some((re) => re.test(host));
  }
  // Also treat any page carrying a typical search query (?q=, ?query=) as search.
  function isSearchPage() {
    if (isSearchHost(location.hostname)) return true;
    const qs = new URLSearchParams(location.search);
    return (qs.has('q') || qs.has('query')) && /search|results?/i.test(location.pathname + location.search);
  }
  if (isSearchHost(location.hostname)) return;

  const MIN_TEXT = 200;

  function readablePageText() {
    const pick = document.querySelector('article, main, [role="main"]') || document.body;
    if (!pick) return '';
    let text = pick.innerText || '';
    text = text.replace(/\s+/g, ' ').trim();
    return text.slice(0, 8000);
  }
  function pagePayload() {
    return { text: readablePageText(), url: location.href, title: document.title || '' };
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res);
        });
      } catch { resolve(null); }
    });
  }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (r) => Math.round((r || 0) * 100);
  const strengthClass = (s) => {
    const v = (s || '').toLowerCase();
    if (v === 'solid') return 'solid';
    if (v === 'fading') return 'fading';
    if (v === 'slipping') return 'slipping';
    return 'gone';
  };

  // ---- launcher (the opt-in prompt) ----
  let launcherEl = null;
  let panelEl = null;

  function removeEl(ref) {
    if (!ref) return;
    ref.classList.add('mneme-leaving');
    setTimeout(() => ref.remove(), 200);
  }

  function showLauncher() {
    if (launcherEl || panelEl) return;
    const el = document.createElement('div');
    el.className = 'mneme-launcher';
    el.innerHTML = `
      <span class="mneme-l-brain">🧠</span>
      <span class="mneme-l-text">Use Mneme on this page?</span>
      <button class="mneme-l-yes">Yes, help me</button>
      <button class="mneme-l-no" title="Not now">Not now</button>
      <button class="mneme-l-never" title="Never on this site">×</button>
    `;
    el.querySelector('.mneme-l-yes').addEventListener('click', () => { removeEl(el); launcherEl = null; openPanel(); });
    el.querySelector('.mneme-l-no').addEventListener('click', () => { removeEl(el); launcherEl = null; });
    el.querySelector('.mneme-l-never').addEventListener('click', () => {
      removeEl(el); launcherEl = null;
      send({ type: 'muteSite', host: location.hostname });
    });
    document.documentElement.appendChild(el);
    launcherEl = el;
    requestAnimationFrame(() => el.classList.add('mneme-in'));
  }

  // ---- the panel (RECALL + LEARN) ----
  function panelShell() {
    const el = document.createElement('div');
    el.className = 'mneme-panel';
    el.innerHTML = `
      <div class="mneme-p-head">
        <span class="mneme-l-brain">🧠</span>
        <span class="mneme-p-title">Mneme</span>
        <span class="mneme-p-sub">Get ready to read</span>
        <button class="mneme-p-x" title="Close">×</button>
      </div>
      <div class="mneme-p-summary">Reading this page…</div>
      <div class="mneme-p-body"></div>
    `;
    el.querySelector('.mneme-p-x').addEventListener('click', () => { removeEl(el); panelEl = null; });
    return el;
  }

  async function openPanel() {
    if (panelEl) return;
    const el = panelShell();
    document.documentElement.appendChild(el);
    panelEl = el;
    requestAnimationFrame(() => el.classList.add('mneme-in'));

    const payload = pagePayload();
    if (!payload.text || payload.text.length < MIN_TEXT) {
      el.querySelector('.mneme-p-summary').textContent = "There isn't enough readable text on this page.";
      return;
    }
    el.querySelector('.mneme-p-summary').textContent = 'Working out what you need to read this page…';
    const res = await send({ type: 'pageInsight', payload });
    if (!res || res.error) {
      el.querySelector('.mneme-p-summary').textContent =
        res?.error || 'Could not reach Mneme. Sign in via the Mneme icon, then try again.';
      return;
    }
    renderInsight(el, res, payload);
  }

  function renderInsight(el, data, payload) {
    el.querySelector('.mneme-p-summary').textContent =
      data.summary || 'Here\u2019s what this page assumes you know.';
    const body = el.querySelector('.mneme-p-body');
    body.innerHTML = '';
    const ctx = { url: payload.url, title: payload.title };

    const prereqs = data.prereqs || [];
    const faded = prereqs.filter((p) => p.status === 'faded');
    const missing = prereqs.filter((p) => p.status === 'missing');
    const solid = prereqs.filter((p) => p.status === 'solid');

    // REFRESH — things you knew that are fading
    if (faded.length) {
      const sec = section('🔁 Refresh first', "You knew these — they're fading. A quick jog.");
      faded.forEach((p) => sec.appendChild(prereqCard(p, ctx)));
      body.appendChild(sec);
    }

    // LEARN FIRST — missing prerequisites, taught in detail
    if (missing.length) {
      const sec = section('💡 Learn first', "New to you, but the page assumes it. Here's what you need.");
      missing.forEach((p) => sec.appendChild(prereqCard(p, ctx)));
      body.appendChild(sec);
    }

    if (!faded.length && !missing.length) {
      const sec = section('✓ You\u2019re ready', 'You already know everything this page builds on.');
      body.appendChild(sec);
    }

    // YOU'RE SOLID — collapsed reassurance
    if (solid.length) {
      const sec = document.createElement('div');
      sec.className = 'mneme-sec';
      sec.innerHTML =
        `<div class="mneme-solid-h">✓ You\u2019re solid on ${solid.length}: ` +
        solid.map((p) => esc(p.concept)).join(' · ') + `</div>`;
      body.appendChild(sec);
    }

    // WHAT THIS PAGE COVERS — the page's own content
    const kps = data.keyPoints || [];
    if (kps.length) {
      const sec = section('📄 What this page covers', '');
      const ul = document.createElement('ul');
      ul.className = 'mneme-points';
      kps.forEach((k) => {
        const li = document.createElement('li');
        li.textContent = k;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      body.appendChild(sec);
    }

    // FOOTER — save the whole briefing for later
    const footer = document.createElement('div');
    footer.className = 'mneme-p-foot';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'mneme-b mneme-b-primary mneme-save-all';
    saveBtn.textContent = '🕑 Save this page to study later';
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const r = await send({
        type: 'studyPacket',
        payload: { page: data.page || ctx, overview: data.overview, keyPoints: kps, prereqs },
      });
      if (r && !r.error) {
        footer.innerHTML =
          `<div class="mneme-done">✓ Saved to <b>${esc(r.topicName || 'your topics')}</b> · ` +
          `${r.conceptsAdded || 0} to study. Review it in the Control Center → Topics.</div>`;
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = (r && r.error) ? r.error : 'Try again';
      }
    });
    footer.appendChild(saveBtn);
    body.appendChild(footer);
  }

  function section(heading, sub) {
    const sec = document.createElement('div');
    sec.className = 'mneme-sec';
    sec.innerHTML = `<div class="mneme-sec-h">${esc(heading)}</div>` +
      (sub ? `<div class="mneme-sec-sub">${esc(sub)}</div>` : '');
    return sec;
  }

  // One prerequisite card — detailed explanation inline, plus the right action.
  function prereqCard(p, ctx) {
    const card = document.createElement('div');
    card.className = 'mneme-card';
    const isFaded = p.status === 'faded';
    const chip = isFaded
      ? `<span class="mneme-chip ${strengthClass(p.strength)}">refresh · ${pct(p.retrievability)}%</span>`
      : `<span class="mneme-chip new">new</span>`;
    card.innerHTML = `
      <div class="mneme-card-top">
        <span class="mneme-card-title">${esc(p.concept)}</span>
        ${chip}
      </div>
      ${p.why ? `<div class="mneme-why">Needed because: ${esc(p.why)}</div>` : ''}
      ${p.explanation ? `<div class="mneme-explain">${esc(p.explanation)}</div>` : ''}
      ${(!isFaded && p.anchor) ? `<div class="mneme-anchor">Builds on what you know: ${esc(p.anchor)}</div>` : ''}
      <div class="mneme-card-actions"></div>
    `;
    const actions = card.querySelector('.mneme-card-actions');
    const settle = (txt) => { actions.outerHTML = `<div class="mneme-done">${esc(txt)}</div>`; };

    if (isFaded) {
      const got = document.createElement('button');
      got.className = 'mneme-b mneme-b-primary';
      got.textContent = 'Still got it';
      got.addEventListener('click', async () => {
        const r = await send({ type: 'recall', payload: { memory_id: p.memoryId, outcome: 'knew', mode: 'show' } });
        settle(r && !r.error ? `✓ Refreshed · now ${pct(r.retrievability)}%` : 'Saved');
      });
      const fresh = document.createElement('button');
      fresh.className = 'mneme-b';
      fresh.textContent = 'Bring it back sooner';
      fresh.addEventListener('click', async () => {
        const r = await send({ type: 'recall', payload: { memory_id: p.memoryId, outcome: 'forgot', mode: 'show' } });
        settle(r && !r.error ? `↻ We'll resurface this · now ${pct(r.retrievability)}%` : 'Saved');
      });
      actions.append(got, fresh);
    } else {
      const learned = document.createElement('button');
      learned.className = 'mneme-b mneme-b-primary';
      learned.textContent = 'Got it — remember this';
      learned.addEventListener('click', async () => {
        actions.innerHTML = `<span class="mneme-busy">Saving…</span>`;
        const r = await send({
          type: 'learnNow',
          payload: {
            card: p.concept, detail: p.explanation || p.why || '', difficulty: p.difficulty,
            anchor: p.anchor, url: ctx.url, title: ctx.title, originKind: 'browser',
          },
        });
        settle(r && !r.error ? '✓ Added to your memory' : (r?.error || 'Saved'));
      });
      actions.append(learned);
    }
    return card;
  }

  // Popup support: extract text, or open the panel on demand.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'extractText') {
      sendResponse(pagePayload());
      return true;
    }
    if (msg?.type === 'openPanel') {
      openPanel();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  // ---- decide whether to offer the launcher ----
  async function maybeOfferLauncher() {
    if (isSearchPage()) return;
    const payload = pagePayload();
    if (!payload.text || payload.text.length < MIN_TEXT) return; // not a reading page
    const status = await send({ type: 'launchCheck', host: location.hostname, url: location.href });
    if (!status || !status.token) return;     // not signed in
    if (status.paused) return;                // user paused Mneme
    if (status.muted) return;                 // user said "never on this site"
    showLauncher();
  }

  setTimeout(maybeOfferLauncher, 1200);
})();
