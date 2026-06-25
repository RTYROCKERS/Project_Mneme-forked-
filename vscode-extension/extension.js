/* Mneme — VS Code surface.
 *
 * A thin doorway to the same Mneme brain the browser extension and CLI use.
 * While you code, Mneme watches what file/symbol you're on and quietly
 * resurfaces a fact you saved that's starting to fade; you can also explicitly
 * "Remember Selection". All of it is just /capture, /context, /recall.
 */
const vscode = require('vscode');
const path = require('path');

let statusBar;
let token = null;
let user = null;
let paused = false;
const cooldown = new Map(); // doc uri -> timestamp
const COOLDOWN_MS = 60_000;

function cfg() {
  const c = vscode.workspace.getConfiguration('mneme');
  return {
    apiUrl: (c.get('apiUrl') || 'http://localhost:5000').replace(/\/$/, ''),
    controlCenterUrl: (c.get('controlCenterUrl') || 'http://localhost:5173').replace(/\/$/, ''),
    ambient: c.get('ambient') !== false,
  };
}

async function api(pathName, { method = 'GET', body, auth = true } = {}) {
  const { apiUrl } = cfg();
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiUrl}${pathName}`, {
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

function workspaceName() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length ? f[0].name : 'workspace';
}

function updateStatus() {
  if (!statusBar) return;
  if (!token) {
    statusBar.text = '$(sign-in) Mneme';
    statusBar.tooltip = 'Mneme — click to sign in';
  } else if (paused) {
    statusBar.text = '$(debug-pause) Mneme';
    statusBar.tooltip = `Mneme paused — ${user?.name || ''}`;
  } else {
    statusBar.text = '$(sparkle) Mneme';
    statusBar.tooltip = `Mneme active — ${user?.name || ''}`;
  }
  statusBar.show();
}

// ---- context extraction -----------------------------------------------------
function editorContextQuery(editor) {
  const doc = editor.document;
  const sel = editor.selection;
  let snippet = '';
  if (sel && !sel.isEmpty) {
    snippet = doc.getText(sel);
  } else {
    const line = sel ? sel.active.line : 0;
    const from = Math.max(0, line - 3);
    const to = Math.min(doc.lineCount - 1, line + 3);
    snippet = doc.getText(new vscode.Range(from, 0, to, 200));
  }
  const file = path.basename(doc.fileName || 'untitled');
  const parts = [file, doc.languageId, snippet].filter(Boolean).join(' \u00b7 ');
  return parts.slice(0, 1000);
}

// ---- resurface --------------------------------------------------------------
async function showResurface(candidate) {
  const pct = Math.round((candidate.retrievability || 0) * 100);
  const picked = await vscode.window.showInformationMessage(
    `\uD83E\uDDE0 ${candidate.memory.card}  (${candidate.strength} \u00b7 ${pct}%)`,
    'I knew it',
    'I forgot',
    'Why?'
  );
  if (!picked) return;
  if (picked === 'Why?') {
    vscode.window.showInformationMessage(candidate.why || 'Related to what you\u2019re working on.');
    return;
  }
  const outcome = picked === 'I knew it' ? 'knew' : 'forgot';
  try {
    const r = await api('/api/mneme/recall', {
      method: 'POST',
      body: { memory_id: candidate.memory.id, outcome, mode: 'show' },
    });
    const np = Math.round((r.retrievability || 0) * 100);
    vscode.window.setStatusBarMessage(
      outcome === 'knew' ? `Mneme: strengthened \u2192 ${np}%` : `Mneme: noted \u2014 we\u2019ll bring it back sooner`,
      4000
    );
  } catch (e) {
    vscode.window.setStatusBarMessage(`Mneme: ${e.message}`, 4000);
  }
}

async function observe(editor, { force = false } = {}) {
  if (!editor) return;
  if (!token) { if (force) vscode.window.showWarningMessage('Mneme: sign in first (Mneme: Sign In).'); return; }
  if (paused && !force) return;
  if (!cfg().ambient && !force) return;

  const key = editor.document.uri.toString();
  const last = cooldown.get(key) || 0;
  if (!force && Date.now() - last < COOLDOWN_MS) return;
  cooldown.set(key, Date.now());

  const text = editorContextQuery(editor);
  if (!text || text.trim().length < 12) return;
  try {
    const data = await api('/api/mneme/context', { method: 'POST', body: { text, force } });
    if (data.candidate) showResurface(data.candidate);
    else if (force) vscode.window.showInformationMessage('Mneme: nothing fading that\u2019s relevant here.');
  } catch (e) {
    if (force) vscode.window.showErrorMessage(`Mneme: ${e.message}`);
  }
}

// ---- commands ---------------------------------------------------------------
async function signIn(context) {
  const email = await vscode.window.showInputBox({ prompt: 'Mneme email', ignoreFocusOut: true });
  if (!email) return;
  const password = await vscode.window.showInputBox({ prompt: 'Mneme password', password: true, ignoreFocusOut: true });
  if (!password) return;
  try {
    const data = await api('/api/auth/login', { method: 'POST', auth: false, body: { email, password } });
    token = data.token;
    user = data.user;
    await context.secrets.store('mneme.token', token);
    await context.globalState.update('mneme.user', user);
    updateStatus();
    vscode.window.showInformationMessage(`Mneme: signed in as ${user.name || user.email}.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Mneme sign-in failed: ${e.message}`);
  }
}

async function signOut(context) {
  token = null; user = null;
  await context.secrets.delete('mneme.token');
  await context.globalState.update('mneme.user', undefined);
  updateStatus();
  vscode.window.showInformationMessage('Mneme: signed out.');
}

async function rememberSelection() {
  if (!token) { vscode.window.showWarningMessage('Mneme: sign in first.'); return; }
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const sel = editor.selection;
  const textRaw = sel && !sel.isEmpty ? editor.document.getText(sel) : editor.document.lineAt(sel.active.line).text;
  const text = (textRaw || '').trim();
  if (!text) { vscode.window.showWarningMessage('Mneme: nothing selected.'); return; }
  try {
    const ws = workspaceName();
    const res = await api('/api/mneme/capture', {
      method: 'POST',
      body: {
        text,
        source: { kind: 'desktop', identifier: `vscode:${ws}`, label: `VS Code \u2014 ${ws}` },
        originRef: editor.document.fileName,
      },
    });
    if (res.kept === false) vscode.window.showInformationMessage(`Mneme: not kept (${res.reason || 'filtered'}).`);
    else {
      const n = res.memories?.length || 0;
      vscode.window.showInformationMessage(n ? `Mneme remembered ${n} thing${n > 1 ? 's' : ''}.` : 'Mneme: observed.');
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Mneme: ${e.message}`);
  }
}

async function togglePause() {
  paused = !paused;
  updateStatus();
  vscode.window.showInformationMessage(`Mneme: ${paused ? 'paused' : 'resumed'} observing.`);
}

function openControlCenter() {
  vscode.env.openExternal(vscode.Uri.parse(`${cfg().controlCenterUrl}/mneme`));
}

async function menu(context) {
  const items = token
    ? [
        { label: '$(search) Recall for current context', cmd: 'mneme.recallHere' },
        { label: '$(bookmark) Remember selection', cmd: 'mneme.rememberSelection' },
        { label: paused ? '$(play) Resume observing' : '$(debug-pause) Pause observing', cmd: 'mneme.togglePause' },
        { label: '$(globe) Open Control Center', cmd: 'mneme.openControlCenter' },
        { label: '$(sign-out) Sign out', cmd: 'mneme.signOut' },
      ]
    : [{ label: '$(sign-in) Sign in to Mneme', cmd: 'mneme.signIn' }];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Mneme' });
  if (pick) vscode.commands.executeCommand(pick.cmd);
}

// ---- activation -------------------------------------------------------------
async function activate(context) {
  token = (await context.secrets.get('mneme.token')) || null;
  user = context.globalState.get('mneme.user') || null;

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'mneme.menu';
  context.subscriptions.push(statusBar);
  updateStatus();

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('mneme.signIn', () => signIn(context));
  reg('mneme.signOut', () => signOut(context));
  reg('mneme.rememberSelection', rememberSelection);
  reg('mneme.recallHere', () => observe(vscode.window.activeTextEditor, { force: true }));
  reg('mneme.togglePause', togglePause);
  reg('mneme.openControlCenter', openControlCenter);
  reg('mneme.menu', () => menu(context));

  // Ambient: observe when you switch files or save (debounced via cooldown).
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => e && observe(e)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document === doc) {
        cooldown.delete(doc.uri.toString()); // a save is a fresh intent
        observe(ed);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
