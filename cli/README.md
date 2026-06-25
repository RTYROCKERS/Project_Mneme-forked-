# mneme — terminal surface

Your shell becomes a memory surface. Capture worthwhile ideas from the command
line, and let what you're doing *right now* jog the things you're forgetting.

Zero dependencies — just Node 18+.

## Install

```bash
cd cli
npm link        # makes `mneme` available globally (or: npm install -g .)
```

Or run without installing:

```bash
node cli/mneme.js <command>
```

By default it talks to `http://localhost:5000`. Override with the `MNEME_API`
env var or `--api`.

## Quick start

```bash
mneme register                       # or: mneme login
mneme capture "Postgres VACUUM reclaims dead tuples; autovacuum runs it automatically"
mneme memories                       # see your feed (weakest first)
mneme context "why is my table bloated"   # what should I recall here?
mneme recall <id> knew               # tell Mneme you remembered it
mneme strength                       # retention stats
```

## Automatic recall (shell hook)

Print a hook for your shell and add it to your profile:

```bash
mneme hook --shell ps     # PowerShell  ($PROFILE)
mneme hook --shell bash   # ~/.bashrc
mneme hook --shell zsh    # ~/.zshrc
```

After that, each command you run is quietly checked against your memories, and
a subtle one-liner appears when something relevant is fading. It's
fire-and-forget — it never blocks your prompt.

## Commands

| command | what it does |
|---|---|
| `login` / `register` / `whoami` / `logout` | auth (token saved to `~/.mneme/config.json`) |
| `capture "text"` | remember worthwhile ideas (also reads stdin) |
| `context "text"` | surface the most relevant fading memory (`--force`, `--quiet`) |
| `recall <id> <outcome>` | update the forgetting model (`knew`/`forgot`/`used`/…) |
| `explain <id>` | get a quick refresher |
| `memories [--limit n]` | your feed, weakest first |
| `strength` | retention stats |
| `seed-demo` | seed the compound-interest demo memory |
| `hook [--shell ps\|bash\|zsh]` | print a shell hook |

Memory ids can be given as short prefixes (e.g. the first 8 chars shown in
`mneme memories`).
