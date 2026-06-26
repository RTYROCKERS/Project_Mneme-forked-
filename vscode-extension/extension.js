/* Mneme — VS Code surface.
 *
 * A thin doorway to the same Mneme brain the browser extension uses, but for
 * code. Mneme never barges in. It has two surfaces here:
 *
 *  1) FILE briefing — when you focus a code file it asks, once, whether you want
 *     help reading it, then opens a side panel that gets you READY to read the
 *     code: 🔁 refresh fading knowledge, 💡 learn the prerequisites it assumes,
 *     📖 understand the notable lines.
 *
 *  2) TERMINAL / AGENT-SESSION briefing — these days people code THROUGH agents
 *     in the terminal. When a new terminal opens, Mneme asks whether to monitor
 *     it. If you say yes, it watches PATIENTLY and silently — the commands the
 *     agent runs, the errors it hits (and how they get fixed), and the files it
 *     creates/modifies — and when the work SETTLES (the terminal goes quiet after
 *     a successful command) it opens a side panel briefing for what JUST HAPPENED:
 *     the same 🔁 refresh / 💡 learn / 📌 what-happened, plus "save to study later".
 *     It does NOT re-read whole files (the file briefing already does that).
 *
 * All of it is just the same /code-insight, /session-insight, /recall,
 * /learn-now, /study-packet endpoints.
 */
const vscode = require('vscode');
const path = require('path');

let statusBar;
let token = null;
let user = null;
let paused = false;

// ---- file briefing panel ----------------------------------------------------
let filePanel = null;

// ---- per-file gating (ask at most once per file per window session) ---------
const askedFiles = new Set();
const mutedFiles = new Set();
const MAX_CODE = 14000;

// ---- terminal session monitoring -------------------------------------------
let sessionPanel = null;
const sessions = new Map();        // terminal -> session state
const askedTerminals = new Set();  // terminals we've already offered to monitor
let activeMonitoredSession = null; // session the most recent activity belongs to
const execReads = new Map();       // TerminalShellExecution -> Promise<string>

function cfg() {
  const c = vscode.workspace.getConfiguration('mneme');
  return {
    apiUrl: (c.get('apiUrl') || 'http://localhost:5000').replace(/\/$/, ''),
    controlCenterUrl: (c.get('controlCenterUrl') || 'http://localhost:5173').replace(/\/$/, ''),
    ambient: c.get('ambient') !== false,
    monitorTerminals: c.get('monitorTerminals') !== false,
    sessionIdleMs: Number(c.get('sessionIdleMs')) || 7000,
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
    const mon = monitoredCount();
    statusBar.text = mon ? `$(sparkle) Mneme $(eye) ${mon}` : '$(sparkle) Mneme';
    statusBar.tooltip = `Mneme — click for actions (${user?.name || ''})` +
      (mon ? ` · monitoring ${mon} terminal${mon > 1 ? 's' : ''}` : '');
  }
  statusBar.show();
}

function monitoredCount() {
  let n = 0;
  for (const s of sessions.values()) if (s.monitoring) n += 1;
  return n;
}

// ============================================================================
// FILE BRIEFING
// ============================================================================
const SKIP_LANGS = new Set([
  'plaintext', 'log', 'scminput', 'search-result', 'output', 'code-text-output',
  'git-commit', 'git-rebase', 'ignore', 'jsonc', 'json', 'markdown', 'bibtex',
  'restructuredtext', 'tex', 'latex',
]);

function eligibleDoc(doc) {
  if (!doc) return false;
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return false;
  if (SKIP_LANGS.has(doc.languageId)) return false;
  if (doc.lineCount < 4) return false;
  const len = doc.getText().length;
  if (len < 60 || len > 400_000) return false;
  return true;
}

function fileLabel(doc) {
  return path.basename(doc.fileName || doc.uri.path || 'untitled');
}

async function offerBriefing(editor) {
  if (!editor || !token || paused) return;
  if (!cfg().ambient) return;
  const doc = editor.document;
  if (!eligibleDoc(doc)) return;
  const key = doc.uri.toString();
  if (askedFiles.has(key) || mutedFiles.has(key)) return;
  askedFiles.add(key);

  const name = fileLabel(doc);
  const pick = await vscode.window.showInformationMessage(
    `🧠 Mneme: get you ready to read ${name}?`,
    'Get ready',
    'Skip this file'
  );
  if (pick === 'Get ready') briefFile(editor);
  else if (pick === 'Skip this file') mutedFiles.add(key);
}

async function briefFile(editor, { force = false } = {}) {
  if (!token) { vscode.window.showWarningMessage('Mneme: sign in first (Mneme: Sign In).'); return; }
  if (!editor) editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('Mneme: open a code file first.'); return; }
  const doc = editor.document;

  const file = fileLabel(doc);
  const language = doc.languageId;
  const code = doc.getText().slice(0, MAX_CODE);

  const p = getFilePanel();
  p.reveal(vscode.ViewColumn.Beside, true);
  p.title = `Mneme · ${file}`;
  p.webview.postMessage({ kind: 'loading', label: file });

  try {
    const data = await api('/api/mneme/code-insight', { method: 'POST', body: { code, file, language } });
    p.webview.postMessage({ kind: 'insight', data });
  } catch (e) {
    p.webview.postMessage({ kind: 'error', message: e.message || 'Could not analyse this file.' });
  }
}

function getFilePanel() {
  if (filePanel) return filePanel;
  filePanel = vscode.window.createWebviewPanel(
    'mnemeBrief', 'Mneme',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  filePanel.webview.html = panelHtml(filePanel.webview, 'Get ready to read');
  filePanel.onDidDispose(() => { filePanel = null; });
  filePanel.webview.onDidReceiveMessage((m) => handleWebviewMessage(m, filePanel));
  return filePanel;
}

// ============================================================================
// TERMINAL / AGENT-SESSION MONITORING
// ============================================================================

const TRIVIAL_CMD = /^(cd|ls|ll|dir|cls|clear|pwd|exit|echo|history|code|which|where)\b/i;

function newSession(terminal) {
  return {
    terminal,
    name: terminal.name || 'terminal',
    shell: terminal.name || 'shell',
    cwd: null,
    monitoring: true,
    commands: [],          // { command, exitCode, tail }
    filesCreated: new Set(),
    filesModified: new Set(),
    idleTimer: null,
    briefing: false,
    lastBriefSig: '',
  };
}

async function offerMonitor(terminal) {
  if (!terminal || !token || paused) return;
  if (!cfg().monitorTerminals) return;
  if (askedTerminals.has(terminal)) return;
  askedTerminals.add(terminal);

  const pick = await vscode.window.showInformationMessage(
    `🧠 Mneme: monitor "${terminal.name}" and brief you when the agent finishes?`,
    'Monitor',
    'Not this one'
  );
  if (pick === 'Monitor') {
    sessions.set(terminal, newSession(terminal));
    updateStatus();
    vscode.window.setStatusBarMessage('Mneme: watching this session — I\u2019ll brief you when it settles.', 4000);
  }
}

function sessionSignature(s) {
  return `${s.commands.length}|${s.filesCreated.size}|${s.filesModified.size}`;
}

function bumpIdle(s) {
  if (!s || !s.monitoring) return;
  activeMonitoredSession = s;
  updateStatus();
  if (s.idleTimer) clearTimeout(s.idleTimer);
  if (s.briefing) return;
  const { sessionIdleMs } = cfg();
  s.idleTimer = setTimeout(() => maybeAutoBrief(s), sessionIdleMs);
}

function maybeAutoBrief(s) {
  if (!s || !s.monitoring || s.briefing) return;
  if (s.commands.length < 1) return;
  const last = s.commands[s.commands.length - 1];
  // Result-oriented: only settle after the last command SUCCEEDED, so we don't
  // fire in the middle of an agent's error→fix loop.
  if (last && last.exitCode !== 0 && last.exitCode !== null) return;
  const sig = sessionSignature(s);
  if (sig === s.lastBriefSig) return; // nothing new since the last briefing
  briefSession(s, { auto: true });
}

function buildSessionDigest(s) {
  const lines = [`Terminal session (${s.shell}${s.cwd ? `, cwd=${s.cwd}` : ''})`];
  const cmds = s.commands.slice(-40);
  if (cmds.length) {
    lines.push('Commands run (in order):');
    cmds.forEach((c, i) => {
      let line = `${i + 1}. $ ${c.command} (exit ${c.exitCode == null ? '?' : c.exitCode})`;
      if (c.exitCode && c.exitCode !== 0 && c.tail) {
        line += `\n   OUTPUT/ERROR: ${c.tail}`;
      }
      lines.push(line);
    });
  }
  if (s.filesCreated.size) {
    lines.push('Files created during session:');
    [...s.filesCreated].slice(-30).forEach((f) => lines.push(` - ${f}`));
  }
  if (s.filesModified.size) {
    lines.push('Files modified during session:');
    [...s.filesModified].slice(-30).forEach((f) => lines.push(` - ${f}`));
  }
  return lines.join('\n');
}

async function briefSession(s, { auto = false } = {}) {
  if (!s) { vscode.window.showInformationMessage('Mneme: no monitored session yet.'); return; }
  if (!token) { vscode.window.showWarningMessage('Mneme: sign in first.'); return; }
  const digest = buildSessionDigest(s);
  if (digest.trim().length < 20) {
    if (!auto) vscode.window.showInformationMessage('Mneme: not enough session activity yet.');
    return;
  }
  s.briefing = true;
  s.lastBriefSig = sessionSignature(s);

  const p = getSessionPanel();
  p.reveal(vscode.ViewColumn.Beside, true);
  p.title = `Mneme · ${s.name}`;
  p.webview.postMessage({ kind: 'loading', label: s.name });

  try {
    const data = await api('/api/mneme/session-insight', {
      method: 'POST',
      body: { events: digest, label: s.name, shell: s.shell },
    });
    p.webview.postMessage({ kind: 'insight', data });
  } catch (e) {
    p.webview.postMessage({ kind: 'error', message: e.message || 'Could not analyse this session.' });
  } finally {
    s.briefing = false;
  }
}

function getSessionPanel() {
  if (sessionPanel) return sessionPanel;
  sessionPanel = vscode.window.createWebviewPanel(
    'mnemeSession', 'Mneme · Session',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  sessionPanel.webview.html = panelHtml(sessionPanel.webview, 'What the agent just did');
  sessionPanel.onDidDispose(() => { sessionPanel = null; });
  sessionPanel.webview.onDidReceiveMessage((m) => handleWebviewMessage(m, sessionPanel));
  return sessionPanel;
}

// ---- raw terminal event wiring ----------------------------------------------
const IGNORE_PATH = /(^|[\\/])(node_modules|\.git|dist|build|out|\.next|coverage|\.vscode|__pycache__)([\\/]|$)|package-lock\.json|yarn\.lock|pnpm-lock\.yaml/i;

function relPath(uri) {
  try {
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    if (ws) return path.relative(ws.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
  } catch { /* ignore */ }
  return path.basename(uri.fsPath || uri.path || '');
}

function recordFile(uri, op) {
  if (!uri || IGNORE_PATH.test(uri.fsPath || uri.path || '')) return;
  const s = activeMonitoredSession;
  if (!s || !s.monitoring) return;
  const rel = relPath(uri);
  if (op === 'created') s.filesCreated.add(rel);
  else s.filesModified.add(rel);
  bumpIdle(s);
}

function wireTerminalEvents(context) {
  // Offer to monitor any terminal that opens (and whatever is already open).
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => offerMonitor(t)),
    vscode.window.onDidCloseTerminal((t) => {
      const s = sessions.get(t);
      if (s && s.idleTimer) clearTimeout(s.idleTimer);
      sessions.delete(t);
      askedTerminals.delete(t);
      if (activeMonitoredSession === s) activeMonitoredSession = null;
      updateStatus();
    })
  );
  vscode.window.terminals.forEach((t) => offerMonitor(t));

  // Shell-integration command stream (stable since VS Code 1.93).
  if (vscode.window.onDidStartTerminalShellExecution) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((e) => {
        const s = sessions.get(e.terminal);
        if (!s || !s.monitoring) return;
        activeMonitoredSession = s;
        if (!s.cwd && e.shellIntegration && e.shellIntegration.cwd) {
          s.cwd = e.shellIntegration.cwd.fsPath || String(e.shellIntegration.cwd);
        }
        // Begin draining output now; the stream closes when the command ends.
        const p = (async () => {
          let buf = '';
          try {
            for await (const chunk of e.execution.read()) {
              if (buf.length < 8000) buf += chunk;
            }
          } catch { /* shell integration may not stream */ }
          return buf;
        })();
        execReads.set(e.execution, p);
      }),
      vscode.window.onDidEndTerminalShellExecution(async (e) => {
        const s = sessions.get(e.terminal);
        if (!s || !s.monitoring) return;
        const p = execReads.get(e.execution);
        execReads.delete(e.execution);
        const out = p ? await p : '';
        const cmd = (e.execution.commandLine && e.execution.commandLine.value || '').trim();
        if (!cmd || TRIVIAL_CMD.test(cmd)) return;
        const exitCode = (typeof e.exitCode === 'number') ? e.exitCode : null;
        const tail = (exitCode && exitCode !== 0)
          ? stripAnsi(out).replace(/\s+/g, ' ').trim().slice(-500)
          : '';
        s.commands.push({ command: cmd.slice(0, 300), exitCode, tail });
        bumpIdle(s);
      })
    );
  }

  // File create/modify attribution (debounced via Sets; noise filtered).
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate((uri) => recordFile(uri, 'created')),
    vscode.workspace.onDidSaveTextDocument((doc) => recordFile(doc.uri, 'modified')),
    vscode.workspace.onDidCreateFiles((e) => e.files.forEach((u) => recordFile(u, 'created')))
  );
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
}

// ============================================================================
// SHARED webview message handling
// ============================================================================
let reqSeq = 0;
async function handleWebviewMessage(msg, originPanel) {
  if (!msg || msg.kind !== 'action') return;
  const { id, action, payload } = msg;
  const reply = (ok, data, error) =>
    originPanel && originPanel.webview.postMessage({ kind: 'reply', id, ok, data, error });
  try {
    if (action === 'recall') {
      reply(true, await api('/api/mneme/recall', { method: 'POST', body: payload }));
    } else if (action === 'learnNow') {
      reply(true, await api('/api/mneme/learn-now', { method: 'POST', body: payload }));
    } else if (action === 'studyPacket') {
      reply(true, await api('/api/mneme/study-packet', { method: 'POST', body: payload }));
    } else if (action === 'openControlCenter') {
      openControlCenter(); reply(true, {});
    } else {
      reply(false, null, 'unknown action');
    }
  } catch (e) {
    reply(false, null, e.message || 'request failed');
  }
}

// ============================================================================
// COMMANDS
// ============================================================================
async function signIn(context) {
  const email = await vscode.window.showInputBox({ prompt: 'Mneme email', ignoreFocusOut: true });
  if (!email) return;
  const password = await vscode.window.showInputBox({ prompt: 'Mneme password', password: true, ignoreFocusOut: true });
  if (!password) return;
  try {
    const data = await api('/api/auth/login', { method: 'POST', auth: false, body: { email, password } });
    token = data.token; user = data.user;
    await context.secrets.store('mneme.token', token);
    await context.globalState.update('mneme.user', user);
    updateStatus();
    vscode.window.showInformationMessage(`Mneme: signed in as ${user.name || user.email}.`);
    if (vscode.window.activeTextEditor) offerBriefing(vscode.window.activeTextEditor);
    vscode.window.terminals.forEach((t) => offerMonitor(t));
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

// Monitor (or stop monitoring) the active terminal on demand.
async function monitorActiveTerminal() {
  if (!token) { vscode.window.showWarningMessage('Mneme: sign in first.'); return; }
  const t = vscode.window.activeTerminal;
  if (!t) { vscode.window.showInformationMessage('Mneme: no active terminal.'); return; }
  const existing = sessions.get(t);
  if (existing && existing.monitoring) {
    if (existing.idleTimer) clearTimeout(existing.idleTimer);
    sessions.delete(t);
    updateStatus();
    vscode.window.showInformationMessage(`Mneme: stopped monitoring "${t.name}".`);
  } else {
    sessions.set(t, newSession(t));
    askedTerminals.add(t);
    updateStatus();
    vscode.window.showInformationMessage(`Mneme: now monitoring "${t.name}" — I\u2019ll brief you when it settles.`);
  }
}

// "Brief me now" — force a session briefing for the active/most-recent session.
async function briefSessionNow() {
  const t = vscode.window.activeTerminal;
  const s = (t && sessions.get(t)) || activeMonitoredSession || firstMonitoredSession();
  briefSession(s, { auto: false });
}

function firstMonitoredSession() {
  for (const s of sessions.values()) if (s.monitoring) return s;
  return null;
}

async function togglePause() {
  paused = !paused;
  updateStatus();
  vscode.window.showInformationMessage(`Mneme: ${paused ? 'paused' : 'resumed'}.`);
}

function openControlCenter() {
  vscode.env.openExternal(vscode.Uri.parse(`${cfg().controlCenterUrl}/mneme`));
}

async function menu() {
  const items = token
    ? [
        { label: '$(book) Get ready to read this file', cmd: 'mneme.briefThisFile' },
        { label: '$(terminal) Monitor / unmonitor this terminal', cmd: 'mneme.monitorTerminal' },
        { label: '$(rocket) Brief me on this session now', cmd: 'mneme.briefSession' },
        { label: '$(bookmark) Remember selection', cmd: 'mneme.rememberSelection' },
        { label: paused ? '$(play) Resume' : '$(debug-pause) Pause', cmd: 'mneme.togglePause' },
        { label: '$(globe) Open Control Center', cmd: 'mneme.openControlCenter' },
        { label: '$(sign-out) Sign out', cmd: 'mneme.signOut' },
      ]
    : [{ label: '$(sign-in) Sign in to Mneme', cmd: 'mneme.signIn' }];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Mneme' });
  if (pick) vscode.commands.executeCommand(pick.cmd);
}

// ============================================================================
// ACTIVATION
// ============================================================================
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
  reg('mneme.briefThisFile', () => briefFile(vscode.window.activeTextEditor, { force: true }));
  reg('mneme.monitorTerminal', monitorActiveTerminal);
  reg('mneme.briefSession', briefSessionNow);
  reg('mneme.togglePause', togglePause);
  reg('mneme.openControlCenter', openControlCenter);
  reg('mneme.menu', menu);

  // File briefing: offer when you focus a code file (asked at most once per file).
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => { if (e) offerBriefing(e); })
  );
  if (vscode.window.activeTextEditor) offerBriefing(vscode.window.activeTextEditor);

  // Terminal/agent-session monitoring.
  wireTerminalEvents(context);
}

function deactivate() {}

// ============================================================================
// WEBVIEW (shared by file + session panels; data-driven)
// ============================================================================
function panelHtml(webview, subtitle) {
  const nonce = String(Math.random()).slice(2) + String(Date.now());
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); margin: 0; }
  .head {
    position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px;
    padding: 12px 14px; background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .brain { font-size: 16px; }
  .title { font-weight: 600; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 11px; margin-left: 2px; }
  .summary { padding: 12px 14px 4px; color: var(--vscode-descriptionForeground); }
  .body { padding: 6px 14px 28px; }
  .sec { margin-top: 16px; }
  .sec-h { font-weight: 600; margin-bottom: 2px; }
  .sec-sub { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 8px; }
  .card {
    border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 10px 12px;
    margin-bottom: 8px; background: var(--vscode-editorWidget-background);
  }
  .card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .card-title { font-weight: 600; }
  .chip { font-size: 10px; padding: 2px 7px; border-radius: 999px; white-space: nowrap;
    border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  .chip.new { color: var(--vscode-charts-blue); border-color: var(--vscode-charts-blue); }
  .chip.fading { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
  .chip.slipping { color: var(--vscode-charts-orange); border-color: var(--vscode-charts-orange); }
  .chip.gone { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
  .chip.solid { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
  .why { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
  .explain { font-size: 12.5px; margin-top: 8px; line-height: 1.5; white-space: pre-wrap; }
  .anchor { font-size: 11.5px; color: var(--vscode-descriptionForeground); margin-top: 6px; font-style: italic; }
  .actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  button { font-family: inherit; font-size: 12px; cursor: pointer;
    border: 1px solid var(--vscode-button-border, transparent); border-radius: 6px; padding: 5px 11px;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.6; cursor: default; }
  .done { font-size: 12px; color: var(--vscode-charts-green); margin-top: 8px; }
  .solid-h { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .points { margin: 6px 0 0; padding-left: 18px; }
  .points li { margin: 3px 0; }
  .note { border-left: 2px solid var(--vscode-textLink-foreground); padding-left: 10px; margin-bottom: 10px; }
  .note code { display: block; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
    background: var(--vscode-textCodeBlock-background); padding: 4px 6px; border-radius: 4px;
    margin-bottom: 4px; white-space: pre-wrap; }
  .note .nx { font-size: 12.5px; line-height: 1.5; }
  .foot { margin-top: 22px; }
  .save { width: 100%; margin-bottom: 8px; }
  .err { color: var(--vscode-errorForeground); padding: 14px; }
</style>
</head>
<body>
  <div class="head">
    <span class="brain">🧠</span>
    <span class="title">Mneme</span>
    <span class="sub">${subtitle}</span>
  </div>
  <div class="summary" id="summary">Waiting…</div>
  <div class="body" id="body"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const elSummary = document.getElementById('summary');
const elBody = document.getElementById('body');

let reqId = 0;
const pending = new Map();
function request(action, payload) {
  return new Promise((resolve) => {
    const id = ++reqId;
    pending.set(id, resolve);
    vscode.postMessage({ kind: 'action', id, action, payload });
  });
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (r) => Math.round((r || 0) * 100);
function strengthClass(s) {
  const v = (s || '').toLowerCase();
  if (v === 'solid') return 'solid';
  if (v === 'fading') return 'fading';
  if (v === 'slipping') return 'slipping';
  return 'gone';
}

window.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.kind === 'loading') {
    elSummary.textContent = 'Working out what you need from ' + (m.label || 'this') + '…';
    elBody.innerHTML = '';
  } else if (m.kind === 'error') {
    elSummary.textContent = '';
    elBody.innerHTML = '<div class="err">' + esc(m.message || 'Something went wrong.') + '</div>';
  } else if (m.kind === 'insight') {
    render(m.data || {});
  } else if (m.kind === 'reply') {
    const fn = pending.get(m.id);
    if (fn) { pending.delete(m.id); fn(m); }
  }
});

function section(heading, sub) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  sec.innerHTML = '<div class="sec-h">' + esc(heading) + '</div>' +
    (sub ? '<div class="sec-sub">' + esc(sub) + '</div>' : '');
  return sec;
}

function prereqCard(p, ctx) {
  const card = document.createElement('div');
  card.className = 'card';
  const isFaded = p.status === 'faded';
  const chip = isFaded
    ? '<span class="chip ' + strengthClass(p.strength) + '">refresh · ' + pct(p.retrievability) + '%</span>'
    : '<span class="chip new">new</span>';
  card.innerHTML =
    '<div class="card-top"><span class="card-title">' + esc(p.concept) + '</span>' + chip + '</div>' +
    (p.why ? '<div class="why">Needed because: ' + esc(p.why) + '</div>' : '') +
    (p.explanation ? '<div class="explain">' + esc(p.explanation) + '</div>' : '') +
    ((!isFaded && p.anchor) ? '<div class="anchor">Builds on what you know: ' + esc(p.anchor) + '</div>' : '') +
    '<div class="actions"></div>';
  const actions = card.querySelector('.actions');
  const settle = (txt) => { actions.outerHTML = '<div class="done">' + esc(txt) + '</div>'; };

  if (isFaded) {
    const got = document.createElement('button');
    got.className = 'primary'; got.textContent = 'Still got it';
    got.addEventListener('click', async () => {
      got.disabled = true;
      const r = await request('recall', { memory_id: p.memoryId, outcome: 'knew', mode: 'show' });
      settle(r.ok ? '✓ Refreshed · now ' + pct(r.data && r.data.retrievability) + '%' : 'Saved');
    });
    const fresh = document.createElement('button');
    fresh.textContent = 'Bring it back sooner';
    fresh.addEventListener('click', async () => {
      fresh.disabled = true;
      const r = await request('recall', { memory_id: p.memoryId, outcome: 'forgot', mode: 'show' });
      settle(r.ok ? '↻ We\\'ll resurface this · now ' + pct(r.data && r.data.retrievability) + '%' : 'Saved');
    });
    actions.append(got, fresh);
  } else {
    const learned = document.createElement('button');
    learned.className = 'primary'; learned.textContent = 'Got it — remember this';
    learned.addEventListener('click', async () => {
      learned.disabled = true;
      actions.innerHTML = '<span class="sub">Saving…</span>';
      const r = await request('learnNow', {
        card: p.concept, detail: p.explanation || p.why || '', difficulty: p.difficulty,
        anchor: p.anchor, title: ctx.label, originKind: 'desktop',
      });
      settle(r.ok ? '✓ Added to your memory' : (r.error || 'Saved'));
    });
    actions.append(learned);
  }
  return card;
}

function render(data) {
  // Distinguish a session briefing from a file briefing by which fields arrive.
  const isSession = !!(data.sessionNotes && data.sessionNotes.length) || (data.label != null && data.file == null && !data.codeNotes);
  const label = data.label || data.file || '';
  const ctx = { label };

  elSummary.textContent = data.summary || 'Here\\'s what you need.';
  elBody.innerHTML = '';

  const prereqs = data.prereqs || [];
  const faded = prereqs.filter((p) => p.status === 'faded');
  const missing = prereqs.filter((p) => p.status === 'missing');
  const solid = prereqs.filter((p) => p.status === 'solid');

  if (faded.length) {
    const sec = section('🔁 Refresh first', "You knew these — they're fading. A quick jog.");
    faded.forEach((p) => sec.appendChild(prereqCard(p, ctx)));
    elBody.appendChild(sec);
  }
  if (missing.length) {
    const sub = isSession
      ? "New ground the agent's work touched. Here's what it means."
      : "New to you, but this code assumes it. Here's what you need.";
    const sec = section('💡 Learn first', sub);
    missing.forEach((p) => sec.appendChild(prereqCard(p, ctx)));
    elBody.appendChild(sec);
  }
  if (!faded.length && !missing.length) {
    elBody.appendChild(section('✓ You\\'re all caught up', 'Nothing here you need to refresh or learn.'));
  }
  if (solid.length) {
    const sec = document.createElement('div');
    sec.className = 'sec';
    sec.innerHTML = '<div class="solid-h">✓ You\\'re solid on ' + solid.length + ': ' +
      solid.map((p) => esc(p.concept)).join(' · ') + '</div>';
    elBody.appendChild(sec);
  }

  // Notes: session → "what just happened"; file → "understand this code".
  let notes = [];
  let notesHeading = '';
  let notesSub = '';
  if (data.sessionNotes && data.sessionNotes.length) {
    notes = data.sessionNotes.map((n) => ({ label: n.event, explanation: n.explanation }));
    notesHeading = '📌 What just happened'; notesSub = 'The notable things the agent did, explained.';
  } else if (data.codeNotes && data.codeNotes.length) {
    notes = data.codeNotes.map((n) => ({ label: n.snippet, explanation: n.explanation }));
    notesHeading = '📖 Understand this code'; notesSub = 'What the notable lines in this file are doing.';
  }
  if (notes.length) {
    const sec = section(notesHeading, notesSub);
    notes.forEach((n) => {
      const d = document.createElement('div');
      d.className = 'note';
      d.innerHTML = (n.label ? '<code>' + esc(n.label) + '</code>' : '') +
        '<div class="nx">' + esc(n.explanation) + '</div>';
      sec.appendChild(d);
    });
    elBody.appendChild(sec);
  }

  const kcs = data.keyConcepts || [];
  if (kcs.length) {
    const sec = section(isSession ? '🧩 What this session used' : '🧩 What this file uses', data.overview || '');
    const ul = document.createElement('ul'); ul.className = 'points';
    kcs.forEach((k) => { const li = document.createElement('li'); li.textContent = k; ul.appendChild(li); });
    sec.appendChild(ul);
    elBody.appendChild(sec);
  }

  // Save the whole briefing for later.
  const foot = document.createElement('div');
  foot.className = 'sec foot';
  const save = document.createElement('button');
  save.className = 'primary save';
  save.textContent = isSession ? '🕑 Save this session to study later' : '🕑 Save this file to study later';
  save.addEventListener('click', async () => {
    save.disabled = true; save.textContent = 'Saving…';
    const extraConcepts = notes.map((n) => ({
      name: (n.label || n.explanation || '').slice(0, 120),
      description: n.explanation || '', difficulty: 'intermediate',
    }));
    const r = await request('studyPacket', {
      page: { title: (isSession ? 'Session · ' : 'Code · ') + (label || 'work'), url: null },
      overview: data.overview, keyPoints: kcs, prereqs, extraConcepts,
    });
    if (r.ok) {
      foot.innerHTML = '<div class="done">✓ Saved to <b>' + esc(r.data && r.data.topicName || 'your topics') +
        '</b> · ' + ((r.data && r.data.conceptsAdded) || 0) + ' to study.</div>';
      const link = document.createElement('button');
      link.textContent = 'Open Control Center';
      link.addEventListener('click', () => request('openControlCenter', {}));
      foot.appendChild(link);
    } else {
      save.disabled = false; save.textContent = (r.error) || 'Try again';
    }
  });
  foot.appendChild(save);
  elBody.appendChild(foot);
}
</script>
</body>
</html>`;
}

module.exports = { activate, deactivate };
