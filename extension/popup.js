/* Mneme popup — login, status, pause, and one-tap capture of the current page. */

const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function show(view) {
  $('login-view').classList.toggle('hidden', view !== 'login');
  $('home-view').classList.toggle('hidden', view !== 'home');
  $('insight-view').classList.toggle('hidden', view !== 'insight');
}

async function render() {
  const status = await send({ type: 'status' });
  $('api-url').value = status.apiUrl || 'http://localhost:5000';
  if (status.token && status.user) {
    $('who').textContent = status.user.name || status.user.email;
    $('status-dot').style.background = status.paused ? '#e56b6f' : '#4caf8c';
    $('mode-pill').textContent = status.paused ? 'Paused' : 'Active';
    $('pause-btn').textContent = status.paused ? 'Resume observing' : 'Pause observing';
    const base = (status.apiUrl || '').replace(/:5000$/, ':5173');
    $('cc-link').href = `${base || 'http://localhost:5173'}/mneme`;
    show('home');
  } else {
    show('login');
  }
}

async function doLogin() {
  $('login-msg').textContent = '';
  const apiUrl = $('api-url').value.trim() || 'http://localhost:5000';
  await send({ type: 'setApiUrl', apiUrl });
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) {
    $('login-msg').textContent = 'Email and password are required.';
    return;
  }
  $('login-btn').textContent = 'Signing in…';
  const res = await send({ type: 'login', email, password });
  $('login-btn').textContent = 'Sign in';
  if (res?.error) {
    $('login-msg').textContent = res.error;
    return;
  }
  await render();
}

async function getPagePayload() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  let payload;
  try {
    payload = await new Promise((resolve) =>
      chrome.tabs.sendMessage(tab.id, { type: 'extractText' }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      })
    );
  } catch { payload = null; }
  if (!payload) payload = { text: tab.title || '', url: tab.url, title: tab.title };
  return payload;
}

let currentPage = null; // { url, title } context for learn/queue actions

const strengthChip = (strength) => {
  const s = (strength || '').toLowerCase();
  if (s === 'solid') return 'solid';
  if (s === 'fading') return 'fading';
  if (s === 'slipping') return 'slipping';
  return 'gone'; // "almost gone"
};
const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (r) => `${Math.round((r || 0) * 100)}%`;

function renderInsight(data) {
  $('insight-summary').textContent = data.summary || 'Here\u2019s what this page assumes you know.';
  const body = $('insight-body');
  body.innerHTML = '';

  const prereqs = data.prereqs || [];
  const faded = prereqs.filter((p) => p.status === 'faded');
  const missing = prereqs.filter((p) => p.status === 'missing');
  const solid = prereqs.filter((p) => p.status === 'solid');

  if (faded.length) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="section-title">🔁 Refresh first</div>`;
    faded.forEach((p) => sec.appendChild(prereqCard(p)));
    body.appendChild(sec);
  }
  if (missing.length) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="section-title">💡 Learn first</div>`;
    missing.forEach((p) => sec.appendChild(prereqCard(p)));
    body.appendChild(sec);
  }
  if (!faded.length && !missing.length) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="empty">You already know everything this page builds on.</div>`;
    body.appendChild(sec);
  }
  if (solid.length) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="empty">✓ Solid on: ${solid.map((p) => esc(p.concept)).join(', ')}</div>`;
    body.appendChild(sec);
  }

  const kps = data.keyPoints || [];
  if (kps.length) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="section-title">📄 What this page covers</div>` +
      `<ul class="points">${kps.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>`;
    body.appendChild(sec);
  }

  // Save the whole briefing for later → Topics/Study/Quiz
  const foot = document.createElement('div');
  foot.style.marginTop = '10px';
  const btn = document.createElement('button');
  btn.className = 'learn-now-btn';
  btn.style.width = '100%';
  btn.textContent = '🕑 Save this page to study later';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const r = await send({
      type: 'studyPacket',
      payload: { page: data.page || currentPage, overview: data.overview, keyPoints: kps, prereqs },
    });
    foot.innerHTML = (r && !r.error)
      ? `<div class="ok">✓ Saved to “${esc(r.topicName || 'your topics')}” · ${r.conceptsAdded || 0} to study. See Control Center → Topics.</div>`
      : `<div class="err">${esc((r && r.error) || 'Could not save')}</div>`;
  });
  foot.appendChild(btn);
  body.appendChild(foot);
}

function prereqCard(p) {
  const el = document.createElement('div');
  el.className = 'card';
  const isFaded = p.status === 'faded';
  const chip = isFaded
    ? `<span class="chip ${strengthChip(p.strength)}">refresh · ${pct(p.retrievability)}</span>`
    : `<span class="chip fading">new</span>`;
  el.innerHTML =
    `<div class="head"><span class="title">${esc(p.concept)}</span>${chip}</div>` +
    (p.why ? `<div class="anchor">Needed because: ${esc(p.why)}</div>` : '') +
    (p.explanation ? `<div class="body">${esc(p.explanation)}</div>` : '') +
    ((!isFaded && p.anchor) ? `<div class="anchor">Builds on: ${esc(p.anchor)}</div>` : '') +
    `<div class="mini-actions"></div>`;
  const actions = el.querySelector('.mini-actions');
  const settle = (txt) => { actions.outerHTML = `<div class="ok">${esc(txt)}</div>`; };

  if (isFaded) {
    const got = document.createElement('button');
    got.className = 'learn-now-btn';
    got.textContent = 'Still got it';
    got.addEventListener('click', async () => {
      const r = await send({ type: 'recall', payload: { memory_id: p.memoryId, outcome: 'knew', mode: 'show' } });
      settle(r && !r.error ? `✓ Refreshed · ${pct(r.retrievability)}` : 'Saved');
    });
    const fresh = document.createElement('button');
    fresh.className = 'learn-later-btn secondary';
    fresh.textContent = 'Bring back sooner';
    fresh.addEventListener('click', async () => {
      const r = await send({ type: 'recall', payload: { memory_id: p.memoryId, outcome: 'forgot', mode: 'show' } });
      settle(r && !r.error ? `↻ Resurfacing · ${pct(r.retrievability)}` : 'Saved');
    });
    actions.append(got, fresh);
  } else {
    const learned = document.createElement('button');
    learned.className = 'learn-now-btn';
    learned.textContent = 'Got it — remember this';
    learned.addEventListener('click', async () => {
      actions.innerHTML = `<span class="muted">Saving…</span>`;
      const r = await send({
        type: 'learnNow',
        payload: {
          card: p.concept, detail: p.explanation || p.why || '', difficulty: p.difficulty,
          anchor: p.anchor, url: currentPage?.url, title: currentPage?.title, originKind: 'browser',
        },
      });
      settle(r && !r.error ? '✓ Added to your memory' : (r?.error || 'Saved'));
    });
    actions.append(learned);
  }
  return el;
}

async function learnThisPage() {
  // Prefer the roomy in-page panel. Fall back to the popup view if the content
  // script isn't reachable (e.g. it was injected before the page loaded).
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const opened = await new Promise((resolve) =>
      chrome.tabs.sendMessage(tab.id, { type: 'openPanel' }, (r) => {
        resolve(!chrome.runtime.lastError && r && r.ok);
      })
    );
    if (opened) { window.close(); return; }
  }

  show('insight');
  $('insight-summary').textContent = 'Reading this page…';
  $('insight-body').innerHTML = '';
  const payload = await getPagePayload();
  if (!payload || !payload.text) {
    $('insight-summary').textContent = "Couldn't read this page.";
    return;
  }
  currentPage = { url: payload.url, title: payload.title };
  const res = await send({ type: 'pageInsight', payload });
  if (res?.error) {
    $('insight-summary').textContent = res.error;
    return;
  }
  renderInsight(res);
}

async function captureThisPage() {
  $('home-msg').textContent = '';
  const payload = await getPagePayload();
  if (!payload) return;
  $('capture-btn').textContent = 'Capturing…';
  const res = await send({ type: 'captureNow', payload });
  $('capture-btn').textContent = 'Capture this page';
  if (res?.error) {
    $('home-msg').textContent = res.error;
    $('home-msg').className = 'err';
  } else if (res?.kept === false) {
    $('home-msg').textContent = `Nothing worth keeping (${res.reason || 'filtered'}).`;
    $('home-msg').className = 'muted';
  } else {
    const n = res?.memories?.length || 0;
    $('home-msg').textContent = n ? `Remembered ${n} thing${n > 1 ? 's' : ''} from this page.` : 'Observed.';
    $('home-msg').className = 'ok';
  }
}

async function togglePause() {
  const status = await send({ type: 'status' });
  await send({ type: 'setPaused', paused: !status.paused });
  await render();
}

document.addEventListener('DOMContentLoaded', () => {
  render();
  $('login-btn').addEventListener('click', doLogin);
  $('password').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
  $('capture-btn').addEventListener('click', captureThisPage);
  $('learn-btn').addEventListener('click', learnThisPage);
  $('insight-back').addEventListener('click', () => show('home'));
  $('pause-btn').addEventListener('click', togglePause);
  $('logout-btn').addEventListener('click', async () => { await send({ type: 'logout' }); render(); });
});
