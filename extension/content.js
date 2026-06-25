/* Mneme content script.
 *
 * Runs on each page (top frame). Pulls the readable gist, asks the background
 * worker whether a fading memory is worth jogging right now, and if so shows a
 * quiet bottom-right toast with a "why am I seeing this?" line and one-tap
 * self-rating (knew it / forgot) that feeds the forgetting model.
 */
(() => {
  if (window.top !== window.self) return; // top frame only

  // Don't observe the Mneme app or API itself (avoids self-capture / feedback).
  const SELF_HOSTS = new Set(['localhost', '127.0.0.1']);
  const SELF_PORTS = new Set(['5173', '5000']);
  if (SELF_HOSTS.has(location.hostname) && SELF_PORTS.has(location.port)) return;

  const MIN_TEXT = 200; // don't bother with near-empty pages

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

  // ---- toast UI ----
  let toastEl = null;

  function removeToast() {
    if (toastEl) {
      toastEl.classList.add('mneme-leaving');
      const el = toastEl;
      toastEl = null;
      setTimeout(() => el.remove(), 220);
    }
  }

  function showToast(candidate) {
    removeToast();
    const pct = Math.round((candidate.retrievability || 0) * 100);
    const wrap = document.createElement('div');
    wrap.className = 'mneme-toast';
    wrap.innerHTML = `
      <div class="mneme-row">
        <span class="mneme-brain">🧠</span>
        <span class="mneme-title">Mneme</span>
        <span class="mneme-strength">${candidate.strength} · ${pct}%</span>
        <button class="mneme-x" title="Dismiss">×</button>
      </div>
      <div class="mneme-card"></div>
      <div class="mneme-why"></div>
      <div class="mneme-actions">
        <button class="mneme-btn mneme-knew">I knew it</button>
        <button class="mneme-btn mneme-forgot">I forgot</button>
      </div>
    `;
    wrap.querySelector('.mneme-card').textContent = candidate.memory.card;
    wrap.querySelector('.mneme-why').textContent = candidate.why || '';

    wrap.querySelector('.mneme-x').addEventListener('click', removeToast);
    wrap.querySelector('.mneme-knew').addEventListener('click', () => rate(candidate, 'knew', wrap));
    wrap.querySelector('.mneme-forgot').addEventListener('click', () => rate(candidate, 'forgot', wrap));

    document.documentElement.appendChild(wrap);
    toastEl = wrap;
    requestAnimationFrame(() => wrap.classList.add('mneme-in'));
  }

  function rate(candidate, outcome, wrap) {
    chrome.runtime.sendMessage(
      { type: 'recall', payload: { memory_id: candidate.memory.id, outcome, mode: 'show' } },
      (res) => {
        const body = wrap.querySelector('.mneme-actions');
        if (res && !res.error) {
          const np = Math.round((res.retrievability || 0) * 100);
          body.innerHTML = `<span class="mneme-done">${
            outcome === 'knew' ? '✓ Strengthened' : '↻ Noted — we\u2019ll bring it back sooner'
          } · now ${np}%</span>`;
        } else {
          body.innerHTML = '<span class="mneme-done">Saved</span>';
        }
        setTimeout(removeToast, 2200);
      }
    );
  }

  // ---- observe on load ----
  function observe() {
    const payload = pagePayload();
    if (!payload.text || payload.text.length < MIN_TEXT) return;
    chrome.runtime.sendMessage({ type: 'observe', payload }, (res) => {
      if (chrome.runtime.lastError) return; // worker asleep / not logged in
      if (res && res.candidate) showToast(res.candidate);
    });
  }

  // Popup "capture this page" support.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'extractText') {
      sendResponse(pagePayload());
      return true;
    }
    return false;
  });

  // Give SPAs a moment to render, then observe once.
  setTimeout(observe, 1200);
})();
