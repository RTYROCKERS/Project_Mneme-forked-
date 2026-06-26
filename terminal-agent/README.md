# Mneme — Terminal Session Monitor (external shells)

Watches what an AI agent does in a **standalone** shell — PowerShell, bash, zsh,
or Command Prompt windows that aren't inside VS Code — and, when the work
**settles**, briefs you on it the Mneme way:

- 🔁 **Refresh first** — things you knew that are fading
- 💡 **Learn first** — new ground the work just touched
- 📌 **What just happened** — files created/why, errors hit & how they were fixed, commands run

…then offers **save to study later** (drops it into your Topics for Study/Quiz).

This is the standalone-shell sibling of the VS Code terminal monitor. The VS
Code extension already watches agent sessions inside its integrated terminal;
this companion covers shells *outside* VS Code. It is **not** a capture/recall
CLI — it does one job: session monitoring.

## Requirements

- Node 18+ (uses global `fetch`). Zero npm dependencies.
- The Mneme server running (default `http://localhost:5000`).

## Quick start

```sh
cd terminal-agent

# 1. Sign in once (caches a token in ~/.mneme/token.json)
node mneme-monitor.js login

# 2. Add the command hook to your shell (one-time — see below)

# 3. In the project you're working in, start the monitor:
node mneme-monitor.js            # watches the current directory
node mneme-monitor.js C:\path\to\project
```

Now drive your AI agent in *another* shell window. When its task settles
(terminal quiet for ~7s after a successful command), the monitor auto-briefs
you. Type `b` + Enter in the monitor window to brief on demand; `q` to quit.

## How it works

Two signal sources are combined:

1. **A shared session log** that a tiny shell hook appends to — one TSV line per
   command (`command · exit code · cwd`). This is what makes briefs *rich*
   (it knows which commands ran and which failed → the error→fix story).
2. **Its own recursive file watcher** on the project directory. This works for
   **every** shell, even raw `cmd.exe` with no hook — so you always at least get
   "files created/modified" briefings.

Settle detection is *result-oriented*: if commands ran, it only briefs once the
**last** command succeeded, so it won't fire in the middle of an error→fix loop.

## Installing the command hook

Print the snippet for your shell and add it to your profile:

```sh
node mneme-monitor.js hook powershell   # PowerShell
node mneme-monitor.js hook bash         # bash
node mneme-monitor.js hook zsh          # zsh
node mneme-monitor.js hook cmd          # cmd.exe (via Clink)
```

- **PowerShell** — paste into `$PROFILE` (or run once per session).
- **bash** — append to `~/.bashrc`.
- **zsh** — append to `~/.zshrc`.
- **cmd.exe** — save the printed Lua as `mneme.lua` in your Clink scripts dir
  (`clink info` → look for `scripts`). Requires [Clink](https://chrisant996.github.io/clink/).

All hooks append to the same shared log; find its path with:

```sh
node mneme-monitor.js where
```

## Capability tiers

| Shell | Command hook | What you get |
|-------|--------------|--------------|
| PowerShell / bash / zsh | native prompt hook | **Full** — commands + exit codes + cwd, plus file activity |
| cmd.exe **with Clink** | Lua `onendedit` | **Full** — same as above |
| cmd.exe **raw** (no Clink) | none available | File activity only (still useful briefs) |

File watching works for **all** shells regardless of the hook.

## Commands

| Command | What it does |
|---------|--------------|
| `node mneme-monitor.js [dir]` | Watch `dir` (default cwd) + auto-brief on settle |
| `node mneme-monitor.js brief` | Force a briefing from the current log now |
| `node mneme-monitor.js login` | Sign in and cache a token |
| `node mneme-monitor.js logout` | Forget the cached token |
| `node mneme-monitor.js hook <shell>` | Print the hook snippet for a shell |
| `node mneme-monitor.js where` | Print the shared session-log path |

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `MNEME_API_URL` | `http://localhost:5000` | Mneme server base URL |
| `MNEME_SESSION_LOG` | `~/.mneme/session.log` | Shared command log path |
| `MNEME_IDLE_MS` | `7000` | Quiet time before a session is "settled" |
| `MNEME_TOKEN` | — | Bypass the cached token (headless/testing) |
| `NO_COLOR` | — | Disable ANSI colors |

## Privacy

The monitor only ever sends a **digest** of the session (commands run, exit
codes, file paths created/modified) to your own Mneme server — never file
contents. Trivial navigation commands (`cd`, `ls`, `clear`, …) are dropped, and
`node_modules`/`.git`/build output are ignored.
