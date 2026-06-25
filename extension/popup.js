/* Mneme popup — login, status, pause, and one-tap capture of the current page. */

const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function show(view) {
  $('login-view').classList.toggle('hidden', view !== 'login');
  $('home-view').classList.toggle('hidden', view !== 'home');
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

async function captureThisPage() {
  $('home-msg').textContent = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
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
  $('pause-btn').addEventListener('click', togglePause);
  $('logout-btn').addEventListener('click', async () => { await send({ type: 'logout' }); render(); });
});
