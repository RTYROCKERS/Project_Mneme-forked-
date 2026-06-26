'use strict';

/*
 * Per-shell hook snippets. Each returns a string the user pastes into their
 * shell profile (or runs once in a session). The hook's only job is to append
 * one TSV line per command to the shared session log:
 *
 *   C \t <epochMs> \t <exitCode> \t <cwd> \t <command>
 *
 * The monitor (mneme-monitor.js) tails that file and also watches files itself,
 * so even shells with NO command hook (raw cmd.exe) still produce useful "files
 * created/modified" briefings — the command hook just makes them richer.
 *
 * Capability tiers:
 *   PowerShell / bash / zsh  → full: command text + exit code + cwd.
 *   cmd.exe                  → full ONLY with Clink installed (Lua hook below);
 *                              raw cmd has no per-command hook API, so it falls
 *                              back to file-activity-only via the monitor.
 */

// PowerShell: override the prompt function. Runs after every command, captures
// the last history entry, its success, and cwd. $LASTEXITCODE is for native
// exes; $? covers cmdlets. We normalise to 0/1.
function powershell(logPath) {
  const p = logPath.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return [
    '# --- Mneme session hook (PowerShell) ---',
    "$env:MNEME_SESSION_LOG = '" + p + "'",
    'function prompt {',
    '  $ok = $?',
    '  try {',
    '    $h = Get-History -Count 1 -ErrorAction SilentlyContinue',
    '    if ($h -and $h.Id -ne $global:__MnemeLastId) {',
    '      $global:__MnemeLastId = $h.Id',
    '      $code = if ($ok) { 0 } else { if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 } }',
    '      $line = "C`t$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())`t$code`t$($PWD.Path)`t$($h.CommandLine)"',
    '      Add-Content -Path $env:MNEME_SESSION_LOG -Value $line -ErrorAction SilentlyContinue',
    '    }',
    '  } catch {}',
    "  return \"PS $($PWD.Path)> \"",
    '}',
    '# --- end Mneme hook ---',
  ].join('\n');
}

// bash: PROMPT_COMMAND runs before each prompt. We grab the last history line
// (stripping its leading number) and $? from the just-finished command.
function bash(logPath) {
  const p = logPath.replace(/"/g, '\\"');
  return [
    '# --- Mneme session hook (bash) ---',
    'export MNEME_SESSION_LOG="' + p + '"',
    '__mneme_log() {',
    '  local code=$?',
    '  local cmd',
    "  cmd=$(history 1 | sed 's/^ *[0-9]* *//')",
    '  [ -z "$cmd" ] && return',
    '  [ "$cmd" = "$__MNEME_LAST" ] && return',
    '  __MNEME_LAST="$cmd"',
    '  printf "C\\t%s\\t%s\\t%s\\t%s\\n" "$(date +%s)000" "$code" "$PWD" "$cmd" >> "$MNEME_SESSION_LOG" 2>/dev/null',
    '}',
    'case ";$PROMPT_COMMAND;" in',
    '  *";__mneme_log;"*) ;;',
    '  *) PROMPT_COMMAND="__mneme_log;${PROMPT_COMMAND}" ;;',
    'esac',
    '# --- end Mneme hook ---',
  ].join('\n');
}

// zsh: precmd runs before each prompt; $? is the last command's status. We read
// the last history entry via `fc -ln -1`.
function zsh(logPath) {
  const p = logPath.replace(/"/g, '\\"');
  return [
    '# --- Mneme session hook (zsh) ---',
    'export MNEME_SESSION_LOG="' + p + '"',
    '__mneme_log() {',
    '  local code=$?',
    '  local cmd',
    '  cmd=$(fc -ln -1 2>/dev/null | sed "s/^ *//")',
    '  [ -z "$cmd" ] && return',
    '  [ "$cmd" = "$__MNEME_LAST" ] && return',
    '  __MNEME_LAST="$cmd"',
    '  printf "C\\t%s\\t%s\\t%s\\t%s\\n" "$(date +%s)000" "$code" "$PWD" "$cmd" >> "$MNEME_SESSION_LOG" 2>/dev/null',
    '}',
    'typeset -ag precmd_functions',
    '(( ${precmd_functions[(I)__mneme_log]} )) || precmd_functions+=(__mneme_log)',
    '# --- end Mneme hook ---',
  ].join('\n');
}

// cmd.exe via Clink: save as a .lua file in your Clink scripts dir. Clink's
// onendedit fires after each command line; os.geterrorlevel() gives the exit
// code of the previous command.
function clink(logPath) {
  const p = logPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    '-- --- Mneme session hook (cmd.exe via Clink) ---',
    '-- Save as mneme.lua in your Clink scripts directory:',
    "--   clink info   (look for 'scripts')",
    'local MNEME_LOG = "' + p + '"',
    'local last = nil',
    'clink.onendedit(function(line)',
    '  if not line or line == "" then return end',
    '  if line == last then return end',
    '  last = line',
    '  local code = os.geterrorlevel and os.geterrorlevel() or 0',
    '  local cwd = os.getcwd()',
    '  local ms = tostring(os.time()) .. "000"',
    '  local f = io.open(MNEME_LOG, "a")',
    '  if f then',
    '    f:write("C\\t" .. ms .. "\\t" .. tostring(code) .. "\\t" .. cwd .. "\\t" .. line .. "\\n")',
    '    f:close()',
    '  end',
    'end)',
    '-- --- end Mneme hook ---',
  ].join('\n');
}

module.exports = { powershell, bash, zsh, clink };
