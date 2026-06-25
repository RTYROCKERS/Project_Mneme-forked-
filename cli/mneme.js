#!/usr/bin/env node
/**
 * mneme — the terminal surface for Project Mneme.
 *
 * Your shell becomes a memory surface: capture ideas from the command line,
 * and let what you're doing *right now* jog the things you're forgetting.
 *
 * Talks to the Mneme API over HTTP. Zero npm dependencies — Node 18+ built-ins
 * only (global fetch, readline, fs).
 *
 * Config lives at ~/.mneme/config.json  ({ apiUrl, token, user }).
 *
 * Commands:
 *   mneme login [--email e --password p] [--api url]   authenticate, save token
 *   mneme register [--name n --email e --password p]   create account + login
 *   mneme whoami                                        show current user/api
 *   mneme capture "text"        (or:  echo text | mneme capture)
 *   mneme context "text"        what should I recall given this?
 *   mneme recall <id> <outcome> outcome: knew|kinda|forgot|correct|incorrect|used|relookup|shown
 *   mneme memories [--limit n]  your memory feed (weakest first)
 *   mneme strength              retention stats
 *   mneme explain <id>          refresh explanation of a memory
 *   mneme seed-demo             seed the compound-interest demo memory
 *   mneme hook [--shell ps|bash|zsh]   print a shell hook for auto-recall
 *   mneme help
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const CONFIG_DIR = path.join(os.homedir(), '.mneme');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_API = process.env.MNEME_API || 'http://localhost:5000';

// --- tiny ANSI helpers -------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);
const cyan = (s) => c('36', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const red = (s) => c('31', s);

// --- config ------------------------------------------------------------------
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { apiUrl: DEFAULT_API };
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// --- arg parsing -------------------------------------------------------------
// Flags that are booleans and must NOT consume the following token (otherwise
// `context --force "my text"` would swallow the text as the flag's value).
const BOOLEAN_FLAGS = new Set(['force', 'quiet']);

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      const raw = args[i].slice(2);
      // Support --key=value explicitly.
      const eq = raw.indexOf('=');
      if (eq !== -1) {
        flags[raw.slice(0, eq)] = raw.slice(eq + 1);
        continue;
      }
      const key = raw;
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
        flags[key] = args[(i += 1)];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

// --- http --------------------------------------------------------------------
async function api(method, p, { body, token, timeout = 15000 } = {}) {
  const cfg = loadConfig();
  const base = cfg.apiUrl || DEFAULT_API;
  const headers = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token || cfg.token}`;
  let res;
  try {
    res = await fetch(base + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const err = new Error(`cannot reach Mneme API at ${base} (${e.name === 'TimeoutError' ? 'timeout' : e.message})`);
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function requireAuth() {
  const cfg = loadConfig();
  if (!cfg.token) {
    console.error(red('Not logged in.') + ' Run: ' + cyan('mneme login'));
    process.exit(1);
  }
  return cfg;
}

// --- stdin / prompt ----------------------------------------------------------
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}
function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hidden) {
      const onData = (char) => {
        char = char + '';
        if (['\n', '\r', '\u0004'].includes(char)) process.stdin.removeListener('data', onData);
        else process.stdout.write('\x1b[2K\x1b[200D' + question + '*'.repeat(rl.line.length));
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// --- pretty printers ---------------------------------------------------------
function strengthColor(label) {
  if (label === 'solid') return green;
  if (label === 'fading') return cyan;
  if (label === 'slipping') return yellow;
  return red; // almost gone
}
function printCandidate(cand) {
  if (!cand) {
    console.log(dim('  (nothing worth resurfacing right now)'));
    return;
  }
  const sc = strengthColor(cand.strength);
  console.log('');
  console.log('  ' + cyan('🧠 Mneme'), dim('— ' + cand.why));
  console.log('  ' + bold(cand.memory.card));
  if (cand.memory.detail) console.log('  ' + dim(cand.memory.detail));
  console.log('  ' + sc(`[${cand.strength}]`) + dim(` · ${Math.round(cand.retrievability * 100)}% recall · id ${cand.memory.id.slice(0, 8)}`));
  if (cand.interaction === 'quiz' && cand.quiz) {
    console.log('  ' + yellow('❓ ' + cand.quiz.question));
  }
  console.log('');
}

// --- commands ----------------------------------------------------------------
const commands = {
  async login(args) {
    const { flags } = parseFlags(args);
    const cfg = loadConfig();
    if (flags.api) cfg.apiUrl = flags.api;
    const email = flags.email || (await ask('email: '));
    const password = flags.password || (await ask('password: ', { hidden: true }));
    const data = await api('POST', '/api/auth/login', { body: { email, password }, token: null });
    cfg.token = data.token;
    cfg.user = data.user;
    saveConfig(cfg);
    console.log(green('✓ logged in as ') + bold(data.user.name || data.user.email));
  },

  async register(args) {
    const { flags } = parseFlags(args);
    const cfg = loadConfig();
    if (flags.api) cfg.apiUrl = flags.api;
    const name = flags.name || (await ask('name: '));
    const email = flags.email || (await ask('email: '));
    const password = flags.password || (await ask('password (min 8): ', { hidden: true }));
    const data = await api('POST', '/api/auth/register', { body: { name, email, password }, token: null });
    cfg.token = data.token;
    cfg.user = data.user;
    saveConfig(cfg);
    console.log(green('✓ account created, logged in as ') + bold(data.user.name));
  },

  async whoami() {
    const cfg = loadConfig();
    console.log('api:  ' + cyan(cfg.apiUrl || DEFAULT_API));
    if (!cfg.token) return console.log(dim('not logged in'));
    console.log('user: ' + bold((cfg.user && (cfg.user.name || cfg.user.email)) || 'unknown'));
  },

  async logout() {
    const cfg = loadConfig();
    delete cfg.token;
    delete cfg.user;
    saveConfig(cfg);
    console.log(green('✓ logged out'));
  },

  async capture(args) {
    requireAuth();
    const { flags, positional } = parseFlags(args);
    let text = positional.join(' ').trim();
    if (!text) text = await readStdin();
    if (!text) {
      console.error(red('nothing to capture.') + ' Pass text or pipe via stdin.');
      process.exit(1);
    }
    const source = {
      kind: 'terminal',
      identifier: flags.source || process.cwd(),
      label: flags.label || path.basename(process.cwd()),
    };
    const data = await api('POST', '/api/mneme/capture', { body: { text, source, originRef: flags.ref } });
    if (!data.kept) {
      console.log(dim('· nothing kept — ' + data.reason));
      return;
    }
    console.log(green(`✓ remembered ${data.memories.length} thing(s):`));
    data.memories.forEach((m) => console.log('  • ' + bold(m.card) + (m.deduped ? dim(' (already knew this)') : '')));
  },

  async context(args) {
    requireAuth();
    const { flags, positional } = parseFlags(args);
    let text = positional.join(' ').trim();
    if (!text) text = await readStdin();
    if (!text) return;
    const quiet = !!flags.quiet;
    try {
      const data = await api('POST', '/api/mneme/context', {
        body: { text, force: !!flags.force, interaction: flags.interaction },
        // Hook runs as a background job, so a generous timeout is fine — it
        // never blocks the prompt. Tight timeouts just cause missed cues.
        timeout: quiet ? Number(flags.timeout || 15000) : 15000,
      });
      if (quiet) {
        // Hook mode: print only a single subtle line if there is a candidate.
        if (data.candidate) {
          const cand = data.candidate;
          process.stdout.write(
            dim('  🧠 ') + cyan(cand.memory.card) +
            dim(`  (${Math.round(cand.retrievability * 100)}% · mneme recall ${cand.memory.id.slice(0, 8)})\n`)
          );
        }
      } else {
        printCandidate(data.candidate);
      }
    } catch (e) {
      if (quiet) process.exit(0); // never disrupt the prompt
      throw e;
    }
  },

  async recall(args) {
    requireAuth();
    const { flags, positional } = parseFlags(args);
    const memoryId = positional[0];
    const outcome = positional[1];
    if (!memoryId || !outcome) {
      console.error('usage: ' + cyan('mneme recall <id> <knew|kinda|forgot|correct|incorrect|used|relookup|shown>'));
      process.exit(1);
    }
    // Accept short id prefixes by resolving against the feed.
    const id = await resolveMemoryId(memoryId);
    const data = await api('POST', '/api/mneme/recall', {
      body: { memory_id: id, outcome, mode: flags.mode || 'show' },
    });
    const sc = strengthColor(data.strength);
    console.log(
      green('✓ ') + 'recorded ' + bold(outcome) + ' — stability ' +
      dim(data.stability_before + ' → ') + bold(data.stability_after) +
      ' · now ' + sc(`[${data.strength}]`) + dim(` ${Math.round(data.retrievability * 100)}%`)
    );
  },

  async explain(args) {
    requireAuth();
    const { positional } = parseFlags(args);
    if (!positional[0]) return console.error('usage: ' + cyan('mneme explain <id>'));
    const id = await resolveMemoryId(positional[0]);
    const data = await api('POST', '/api/mneme/explain', { body: { memory_id: id } });
    console.log('\n  ' + data.explanation + '\n');
  },

  async memories(args) {
    requireAuth();
    const { flags } = parseFlags(args);
    const list = await api('GET', `/api/mneme/memories?limit=${flags.limit || 50}`);
    if (list.length === 0) return console.log(dim('no memories yet. Capture something!'));
    console.log(bold(`\n  ${list.length} memories (weakest first):\n`));
    for (const m of list) {
      const sc = strengthColor(m.strength);
      console.log(
        '  ' + dim(m.id.slice(0, 8)) + '  ' + sc(`[${m.strength}]`.padEnd(14)) +
        dim(`${Math.round(m.retrievability * 100)}%`.padStart(4)) + '  ' + m.card
      );
    }
    console.log('');
  },

  async strength() {
    requireAuth();
    const s = await api('GET', '/api/mneme/strength');
    console.log('');
    console.log('  ' + bold('Memory strength'));
    console.log('  total memories : ' + bold(s.total_memories));
    console.log('  avg recall     : ' + bold(Math.round(s.avg_retrievability * 100) + '%'));
    console.log('  due now        : ' + yellow(s.due_now));
    const b = s.strength_buckets;
    console.log('  ' + green(`solid ${b.solid}`) + '  ' + cyan(`fading ${b.fading}`) + '  ' +
      yellow(`slipping ${b.slipping}`) + '  ' + red(`almost-gone ${b['almost gone']}`));
    console.log('  recalls        : ' + bold(s.recalls.total) + dim(` (${s.recalls.strengthened} strengthened, ${s.recalls.lapsed} lapsed)`));
    console.log('');
  },

  async 'seed-demo'() {
    requireAuth();
    const data = await api('POST', '/api/mneme/seed-demo', { body: {} });
    console.log(green('✓ seeded demo memory at ') + yellow(Math.round(data.retrievability * 100) + '% recall') +
      dim(` [${data.strength}]`) + '\n  ' + bold(data.memory.card));
  },

  hook(args) {
    const { flags } = parseFlags(args);
    const shell = (flags.shell || (process.platform === 'win32' ? 'ps' : 'bash')).toLowerCase();
    console.log(hookSnippet(shell));
  },

  help() {
    console.log(HELP);
  },
};

// Resolve a possibly-shortened id prefix to a full memory id.
async function resolveMemoryId(idOrPrefix) {
  if (idOrPrefix.length >= 32) return idOrPrefix;
  try {
    const list = await api('GET', '/api/mneme/memories?limit=500');
    const match = list.find((m) => m.id.startsWith(idOrPrefix));
    return match ? match.id : idOrPrefix;
  } catch {
    return idOrPrefix;
  }
}

// --- shell hook snippets -----------------------------------------------------
function hookSnippet(shell) {
  if (shell === 'bash') {
    return `# Mneme bash hook — add to ~/.bashrc
_mneme_hook() {
  local last=$(history 1 | sed 's/^ *[0-9]* *//')
  [ -n "$last" ] && (mneme context --quiet "$last" &) 2>/dev/null
}
PROMPT_COMMAND="_mneme_hook;\${PROMPT_COMMAND:-:}"`;
  }
  if (shell === 'zsh') {
    return `# Mneme zsh hook — add to ~/.zshrc
precmd() {
  local last=$(fc -ln -1)
  [ -n "$last" ] && (mneme context --quiet "$last" &) 2>/dev/null
}`;
  }
  // PowerShell (default on Windows)
  return `# Mneme PowerShell hook — add to $PROFILE
function global:prompt {
  $last = (Get-History -Count 1).CommandLine
  if ($last) { Start-Job -ScriptBlock { param($cmd) mneme context --quiet $cmd } -ArgumentList $last | Out-Null }
  "PS " + (Get-Location) + "> "
}
# Tip: 'mneme context --quiet' is fire-and-forget and never blocks your prompt.`;
}

const HELP = `${bold('mneme')} — your terminal memory surface

${bold('auth')}
  mneme login [--email e --password p --api url]
  mneme register [--name n --email e --password p]
  mneme whoami | logout

${bold('memory')}
  mneme capture "text"          remember worthwhile ideas (or pipe via stdin)
  mneme context "text"          what should I recall, given this? (--force --quiet)
  mneme recall <id> <outcome>   knew|kinda|forgot|correct|incorrect|used|relookup|shown
  mneme explain <id>            refresh explanation
  mneme memories [--limit n]    your feed (weakest first)
  mneme strength                retention stats
  mneme seed-demo               seed the compound-interest demo memory

${bold('integration')}
  mneme hook [--shell ps|bash|zsh]   print a shell hook for automatic recall

Config: ~/.mneme/config.json   ·   API: ${DEFAULT_API} (override with MNEME_API or --api)`;

// --- main --------------------------------------------------------------------
(async () => {
  const [, , cmd, ...rest] = process.argv;
  const handler = commands[cmd] || (cmd ? null : commands.help);
  if (!handler) {
    console.error(red(`unknown command: ${cmd}`) + '\n');
    console.log(HELP);
    process.exit(1);
  }
  try {
    await handler(rest);
  } catch (e) {
    console.error(red('✗ ') + e.message);
    process.exit(e.network ? 2 : 1);
  }
})();
