#!/usr/bin/env node
/*
 * Mneme — terminal session monitor (external shells).
 *
 * The VS Code extension already watches agent sessions inside VS Code's
 * integrated terminal. This is the same idea for STANDALONE shells — PowerShell,
 * bash, zsh, or Command Prompt windows that aren't inside VS Code. It is NOT the
 * old capture/recall CLI (that was removed); it does only one job: watch what an
 * AI agent does in your shell, and when the work SETTLES, brief you on it —
 *   🔁 refresh fading knowledge · 💡 learn the gaps · 📌 what just happened
 * plus "save to study later" — using the same Mneme brain endpoints.
 *
 * Two signal sources, combined:
 *   1. A shared session log that shell hooks append to (commands + exit codes).
 *      See ./hooks/snippets.js for the per-shell snippets.
 *   2. Its own recursive file watcher on the project dir (covers EVERY shell,
 *      even raw cmd with no command hook — you still get "files created" briefs).
 *
 * Zero dependencies. Node 18+ (global fetch). Usage:
 *   node mneme-monitor.js [projectDir]     # watch + auto-brief on settle
 *   node mneme-monitor.js brief            # force a briefing now
 *   node mneme-monitor.js login            # sign in (caches token)
 *   node mneme-monitor.js logout
 *   node mneme-monitor.js hook <shell>     # print the hook snippet for a shell
 *   node mneme-monitor.js where            # print the shared session-log path
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const snippets = require('./hooks/snippets');

// ---- config -----------------------------------------------------------------
const API_URL = (process.env.MNEME_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const HOME_DIR = path.join(os.homedir(), '.mneme');
const TOKEN_FILE = path.join(HOME_DIR, 'token.json');
// One shared log both the shell hook (writer) and this watcher (reader) agree on
// with zero configuration. Override with MNEME_SESSION_LOG if you want isolation.
const SESSION_LOG = process.env.MNEME_SESSION_LOG || path.join(HOME_DIR, 'session.log');
const IDLE_MS = Number(process.env.MNEME_IDLE_MS) || 7000;

const IGNORE_PATH = /(^|[\\/])(node_modules|\.git|dist|build|out|\.next|coverage|\.vscode|__pycache__|\.mneme)([\\/]|$)|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.log$|~$|\.tmp$/i;
const TRIVIAL_CMD = /^(cd|ls|ll|dir|cls|clear|pwd|exit|echo|history|code|which|where|set|gci|get-childitem)\b/i;

// ANSI helpers (kept minimal; respect NO_COLOR).
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const C = (n) => (s) => (useColor ? `\u001b[${n}m${s}\u001b[0m` : String(s));
const bold = C(1), dim = C(2), cyan = C(36), green = C(32), yellow = C(33), red = C(31), blue = C(34), magenta = C(35);

function ensureHome() {
  try { fs.mkdirSync(HOME_DIR, { recursive: true }); } catch { /* ignore */ }
}

// ---- auth -------------------------------------------------------------------
function loadToken() {
  if (process.env.MNEME_TOKEN) return { token: process.env.MNEME_TOKEN, user: { name: 'env' } };
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}
function saveToken(obj) {
  ensureHome();
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 }); } catch { /* ignore */ }
}
function clearToken() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

function ask(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (mask) {
      const onData = (char) => {
        const s = String(char);
        if (s === '\n' || s === '\r' || s === '\u0004') process.stdout.write('\n');
        else process.stdout.write('*');
      };
      process.stdin.on('data', onData);
      rl.question(question, (ans) => { process.stdin.removeListener('data', onData); rl.close(); resolve(ans); });
    } else {
      rl.question(question, (ans) => { rl.close(); resolve(ans); });
    }
  });
}

async function api(pathName, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_URL}${pathName}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const err = new Error(`Cannot reach Mneme at ${API_URL} (${e.message}). Is the server running?`);
    err.network = true;
    throw err;
  }
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

async function login() {
  const email = await ask('Mneme email: ');
  const password = await ask('Mneme password: ', { mask: true });
  const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  saveToken({ token: data.token, user: data.user });
  console.log(green(`\u2713 Signed in as ${data.user?.name || data.user?.email}.`));
  return { token: data.token, user: data.user };
}

async function requireAuth() {
  let cur = loadToken();
  if (!cur || !cur.token) {
    console.log(dim('You need to sign in first.'));
    cur = await login();
  }
  return cur;
}

// ---- session state ----------------------------------------------------------
const session = {
  commands: [],            // { ts, command, exitCode, cwd, tail }
  filesCreated: new Set(),
  filesModified: new Set(),
  shell: process.env.MNEME_SHELL || 'shell',
  cwd: process.cwd(),
};
let logOffset = 0;
let idleTimer = null;
let briefing = false;     // a briefing is currently showing / interactive
let lastSig = '';
let auth = null;

function signature() {
  return `${session.commands.length}|${session.filesCreated.size}|${session.filesModified.size}`;
}

// ---- shared-log ingestion ---------------------------------------------------
// Each line is a tab-separated event the shell hooks append:
//   C \t <epochMs> \t <exitCode|?> \t <cwd> \t <command>
//   F \t <epochMs> \t <created|modified> \t <relpath>
function ingestLine(line) {
  const raw = line.trim();
  if (!raw) return false;
  const parts = raw.split('\t');
  const kind = parts[0];
  if (kind === 'C') {
    const [, ts, exit, cwd, ...cmdParts] = parts;
    const command = cmdParts.join('\t').trim();
    if (!command || TRIVIAL_CMD.test(command)) return false;
    const exitCode = (exit === '?' || exit === '' || exit == null) ? null : Number(exit);
    if (cwd) session.cwd = cwd;
    session.commands.push({
      ts: Number(ts) || Date.now(),
      command: command.slice(0, 300),
      exitCode: Number.isNaN(exitCode) ? null : exitCode,
      cwd: cwd || session.cwd,
      tail: '',
    });
    return true;
  }
  if (kind === 'F') {
    const [, , op, ...rest] = parts;
    const rel = rest.join('\t').trim();
    if (!rel || IGNORE_PATH.test(rel)) return false;
    if (op === 'created') session.filesCreated.add(rel);
    else session.filesModified.add(rel);
    return true;
  }
  return false;
}

function drainLog() {
  let changed = false;
  try {
    const stat = fs.statSync(SESSION_LOG);
    if (stat.size < logOffset) logOffset = 0; // file was truncated/rotated
    if (stat.size > logOffset) {
      const fd = fs.openSync(SESSION_LOG, 'r');
      const len = stat.size - logOffset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, logOffset);
      fs.closeSync(fd);
      logOffset = stat.size;
      buf.toString('utf8').split('\n').forEach((l) => { if (ingestLine(l)) changed = true; });
    }
  } catch { /* log may not exist yet */ }
  if (changed) bumpIdle();
}

// ---- own file watcher (covers every shell, incl. raw cmd) -------------------
const recentFile = new Map(); // debounce duplicate fs events
function watchFiles(dir) {
  let watcher;
  try {
    watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const rel = String(filename).replace(/\\/g, '/');
      if (IGNORE_PATH.test(rel)) return;
      const now = Date.now();
      if (now - (recentFile.get(rel) || 0) < 400) return;
      recentFile.set(rel, now);
      const full = path.join(dir, filename);
      let exists = false;
      try { exists = fs.existsSync(full) && fs.statSync(full).isFile(); } catch { exists = false; }
      if (!exists) return;
      // created vs modified: if we've not seen it this session, call it created.
      if (!session.filesCreated.has(rel) && !session.filesModified.has(rel)) session.filesCreated.add(rel);
      else session.filesModified.add(rel);
      bumpIdle();
    });
  } catch (e) {
    console.log(dim(`(file watching unavailable: ${e.message})`));
  }
  return watcher;
}

// ---- settle detection -------------------------------------------------------
function bumpIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  if (briefing) return;
  idleTimer = setTimeout(onSettle, IDLE_MS);
}

async function onSettle() {
  if (briefing) return;
  const haveCmd = session.commands.length > 0;
  const haveFiles = session.filesCreated.size + session.filesModified.size > 0;
  if (!haveCmd && !haveFiles) return;
  // Result-oriented: if there are commands, only settle once the LAST one
  // succeeded, so we don't fire mid error→fix loop.
  if (haveCmd) {
    const last = session.commands[session.commands.length - 1];
    if (last && last.exitCode !== 0 && last.exitCode !== null) return;
  }
  const sig = signature();
  if (sig === lastSig) return;
  await runBriefing({ auto: true });
}

// ---- digest -----------------------------------------------------------------
function buildDigest() {
  const lines = [`Terminal session (${session.shell}${session.cwd ? `, cwd=${session.cwd}` : ''})`];
  const cmds = session.commands.slice(-40);
  if (cmds.length) {
    lines.push('Commands run (in order):');
    cmds.forEach((c, i) => {
      let line = `${i + 1}. $ ${c.command} (exit ${c.exitCode == null ? '?' : c.exitCode})`;
      if (c.exitCode && c.exitCode !== 0 && c.tail) line += `\n   OUTPUT/ERROR: ${c.tail}`;
      lines.push(line);
    });
  }
  if (session.filesCreated.size) {
    lines.push('Files created during session:');
    [...session.filesCreated].slice(-30).forEach((f) => lines.push(` - ${f}`));
  }
  if (session.filesModified.size) {
    lines.push('Files modified during session:');
    [...session.filesModified].slice(-30).forEach((f) => lines.push(` - ${f}`));
  }
  return lines.join('\n');
}

// ---- rendering --------------------------------------------------------------
function hr() { return dim('\u2500'.repeat(Math.min(60, (process.stdout.columns || 60)))); }
function wrap(text, indent = '   ') {
  const width = Math.max(40, (process.stdout.columns || 80) - indent.length - 1);
  const words = String(text || '').split(/\s+/);
  const out = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { out.push(line); line = w; }
    else line = (line ? line + ' ' : '') + w;
  }
  if (line) out.push(line);
  return out.map((l) => indent + l).join('\n');
}
function strengthColor(s) {
  const v = (s || '').toLowerCase();
  if (v === 'solid') return green;
  if (v === 'fading') return yellow;
  if (v === 'slipping') return C(33);
  return red;
}

function renderBriefing(data) {
  console.log('\n' + hr());
  console.log(`${bold(magenta('\ud83e\udde0 Mneme'))}  ${dim('\u2014 what the agent just did')}`);
  console.log(hr());
  console.log(wrap(bold(data.summary || 'Here\u2019s what you need.'), ''));

  const prereqs = data.prereqs || [];
  const faded = prereqs.filter((p) => p.status === 'faded');
  const missing = prereqs.filter((p) => p.status === 'missing');
  const solid = prereqs.filter((p) => p.status === 'solid');

  if (faded.length) {
    console.log(`\n${bold(yellow('\ud83d\udd01 Refresh first'))} ${dim('\u2014 you knew these, they\u2019re fading')}`);
    faded.forEach((p, i) => {
      const sc = strengthColor(p.strength);
      console.log(`  ${bold(`[${i + 1}]`)} ${bold(p.concept)}  ${sc(`refresh \u00b7 ${Math.round((p.retrievability || 0) * 100)}%`)}`);
      if (p.why) console.log(wrap(dim(`needed because: ${p.why}`)));
      if (p.explanation) console.log(wrap(p.explanation));
    });
  }
  if (missing.length) {
    console.log(`\n${bold(blue('\ud83d\udca1 Learn first'))} ${dim('\u2014 new ground this work touched')}`);
    missing.forEach((p, i) => {
      console.log(`  ${bold(`[${faded.length + i + 1}]`)} ${bold(p.concept)}  ${blue('new')}`);
      if (p.why) console.log(wrap(dim(`needed because: ${p.why}`)));
      if (p.explanation) console.log(wrap(p.explanation));
      if (p.anchor) console.log(wrap(dim(`builds on what you know: ${p.anchor}`)));
    });
  }
  if (!faded.length && !missing.length) {
    console.log('\n' + green('\u2713 You\u2019re all caught up \u2014 nothing to refresh or learn here.'));
  }
  if (solid.length) {
    console.log('\n' + dim(`\u2713 You\u2019re solid on ${solid.length}: ` + solid.map((p) => p.concept).join(' \u00b7 ')));
  }

  const notes = data.sessionNotes || [];
  if (notes.length) {
    console.log(`\n${bold(cyan('\ud83d\udccc What just happened'))}`);
    notes.forEach((n) => {
      if (n.event) console.log('  ' + cyan('\u2022 ') + bold(n.event));
      if (n.explanation) console.log(wrap(n.explanation, '    '));
    });
  }
  const kcs = data.keyConcepts || [];
  if (kcs.length) {
    console.log(`\n${bold('\ud83e\udde9 What this session used')}`);
    if (data.overview) console.log(wrap(dim(data.overview)));
    kcs.forEach((k) => console.log('   \u2022 ' + k));
  }
  console.log('\n' + hr());
}

// ---- interactive actions ----------------------------------------------------
async function interact(data) {
  if (!process.stdin.isTTY) return; // non-interactive (tests / piped) — just print
  const prereqs = data.prereqs || [];
  const faded = prereqs.filter((p) => p.status === 'faded');
  const missing = prereqs.filter((p) => p.status === 'missing');

  for (;;) {
    const menu = [
      faded.length ? `${bold('r')}=grade refreshers` : '',
      missing.length ? `${bold('l')}=remember all new` : '',
      `${bold('s')}=save session to study later`,
      `${bold('Enter')}=back to watching`,
    ].filter(Boolean).join('   ');
    const choice = (await ask(`\n${dim('Action:')} ${menu}\n> `)).trim().toLowerCase();
    if (!choice) break;

    if (choice === 'r' && faded.length) {
      for (const p of faded) {
        const a = (await ask(`  "${p.concept}" \u2014 still got it? [${green('y')}/${red('n')}/skip] `)).trim().toLowerCase();
        if (a === 'skip' || a === 's') continue;
        const outcome = (a === 'y' || a === 'yes') ? 'knew' : 'forgot';
        try {
          const r = await api('/api/mneme/recall', { method: 'POST', token: auth.token, body: { memory_id: p.memoryId, outcome, mode: 'show' } });
          console.log('   ' + green(`\u2713 ${outcome === 'knew' ? 'strengthened' : 'will resurface'} \u2192 ${Math.round((r.retrievability || 0) * 100)}%`));
        } catch (e) { console.log('   ' + red(e.message)); }
      }
    } else if (choice === 'l' && missing.length) {
      for (const p of missing) {
        try {
          await api('/api/mneme/learn-now', { method: 'POST', token: auth.token, body: {
            card: p.concept, detail: p.explanation || p.why || '', difficulty: p.difficulty, title: data.label, originKind: 'desktop',
          } });
          console.log('   ' + green(`\u2713 remembered: ${p.concept}`));
        } catch (e) { console.log('   ' + red(e.message)); }
      }
    } else if (choice === 's') {
      await saveSession(data);
    }
  }
}

async function saveSession(data) {
  const notes = data.sessionNotes || [];
  const extraConcepts = notes.map((n) => ({
    name: (n.event || n.explanation || '').slice(0, 120),
    description: n.explanation || '',
    difficulty: 'intermediate',
  }));
  try {
    const r = await api('/api/mneme/study-packet', { method: 'POST', token: auth.token, body: {
      page: { title: 'Session \u00b7 ' + (data.label || session.shell), url: null },
      overview: data.overview, keyPoints: data.keyConcepts || [], prereqs: data.prereqs || [], extraConcepts,
    } });
    console.log('   ' + green(`\u2713 Saved to "${r.topicName}" \u00b7 ${r.conceptsAdded} to study. Open the Control Center \u2192 Topics.`));
  } catch (e) {
    console.log('   ' + red(`Could not save: ${e.message}`));
  }
}

// ---- briefing driver --------------------------------------------------------
async function runBriefing({ auto = false } = {}) {
  const digest = buildDigest();
  if (digest.trim().length < 20) {
    if (!auto) console.log(dim('Not enough session activity yet.'));
    return;
  }
  briefing = true;
  lastSig = signature();
  try {
    if (auto) process.stdout.write('\n' + dim('Mneme: the session settled \u2014 briefing you\u2026') + '\n');
    const data = await api('/api/mneme/session-insight', {
      method: 'POST', token: auth.token,
      body: { events: digest, label: path.basename(session.cwd || '') || session.shell, shell: session.shell },
    });
    renderBriefing(data);
    await interact(data);
  } catch (e) {
    if (e.status === 401) {
      console.log(red('Session expired \u2014 run: node mneme-monitor.js login'));
      clearToken();
    } else {
      console.log(red(`Mneme: ${e.message}`));
    }
  } finally {
    briefing = false;
  }
}

// ---- hooks ------------------------------------------------------------------
function hookSnippet(shell) {
  const s = (shell || '').toLowerCase();
  if (s === 'powershell' || s === 'pwsh' || s === 'ps') return snippets.powershell(SESSION_LOG);
  if (s === 'bash') return snippets.bash(SESSION_LOG);
  if (s === 'zsh') return snippets.zsh(SESSION_LOG);
  if (s === 'cmd' || s === 'clink') return snippets.clink(SESSION_LOG);
  return null;
}

// ---- main -------------------------------------------------------------------
async function watch(projectDir) {
  ensureHome();
  auth = await requireAuth();
  // Start fresh: don't replay an old log; jump to current end.
  try { logOffset = fs.statSync(SESSION_LOG).size; } catch { logOffset = 0; }

  const dir = path.resolve(projectDir || process.cwd());
  console.log(bold(magenta('\ud83e\udde0 Mneme session monitor')) + dim(`  (signed in as ${auth.user?.name || 'you'})`));
  console.log(dim(`Watching files in: ${dir}`));
  console.log(dim(`Shared command log: ${SESSION_LOG}`));
  console.log(dim('Shell hooks append here. Add one with:  node mneme-monitor.js hook powershell'));
  console.log(dim(`I\u2019ll wait patiently and brief you when the agent\u2019s task settles (idle ${IDLE_MS / 1000}s after success).`));
  console.log(dim('Press Ctrl+C to stop.  Type "b" + Enter to brief now.\n'));

  watchFiles(dir);
  // Poll the shared log (fs.watch on a single file is flaky across platforms).
  const poll = setInterval(drainLog, 800);
  drainLog();

  // Let the user force a briefing by typing b<Enter> in this window.
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on('line', (l) => {
      const t = l.trim().toLowerCase();
      if (t === 'b' || t === 'brief') { if (!briefing) runBriefing({ auto: false }); }
      else if (t === 'q' || t === 'quit') { clearInterval(poll); process.exit(0); }
    });
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  ensureHome();
  try {
    if (cmd === 'login') { await login(); return; }
    if (cmd === 'logout') { clearToken(); console.log('Signed out.'); return; }
    if (cmd === 'where') { console.log(SESSION_LOG); return; }
    if (cmd === 'hook') {
      const snip = hookSnippet(arg);
      if (!snip) { console.error(`Unknown shell "${arg}". Try: powershell | bash | zsh | cmd`); process.exit(1); }
      process.stdout.write(snip + '\n');
      return;
    }
    if (cmd === 'brief') {
      auth = await requireAuth();
      // Brief from whatever is currently in the shared log.
      logOffset = 0; drainLog();
      await runBriefing({ auto: false });
      return;
    }
    // default: watch [projectDir]
    await watch(cmd && cmd !== 'watch' ? cmd : arg);
  } catch (e) {
    console.error(red(e.message || String(e)));
    process.exit(1);
  }
}

// Exported for tests.
module.exports = { ingestLine, buildDigest, session, signature };

if (require.main === module) main();
