import { execSync, execFileSync } from 'child_process'
import { join } from 'path'
import { readdirSync, statSync, openSync, readSync, closeSync } from 'fs'

// A "backend" is the agent CLI a session runs on. The app spawns Claude Code
// today; Copilot is a peer backend selectable per session. Each backend knows
// its binary, how to pass a model + the extra args every session needs, and any
// env it must set for a given model.

export type BackendId = 'claude' | 'copilot' | 'opencode' | 'codex' | 'gemini'

// 'default' = let the CLI use its own configured model (no --model flag)
export const DEFAULT_MODEL_ID = 'default'
const modelArgs = (flag: string, model: string) => (model && model !== DEFAULT_MODEL_ID ? [flag, model] : [])

export interface BackendSpec {
  id: BackendId
  label: string
  bin: string
  // Full argv (after the bin) for an interactive session on `model` in `cwd`.
  // resumeId and rcName are backend-agnostic extras the caller appends where
  // supported.
  // skipPermissions: run without permission prompts (Settings → Sessions).
  spawnArgs: (opts: { model: string; cwd: string; resumeId?: string; sessionId?: string; rcName?: string; rc?: boolean; skipPermissions?: boolean }) => string[]
  // Extra env for this model (e.g. the fable-5-1 window-enforcement bypass).
  env: (model: string) => Record<string, string>
  // Find the CLI's own session id for a session started in `cwd` at/after
  // `sinceMs`, so it can be resumed later. Returns null until the CLI has
  // written it. Claude scans its project .jsonl files (handled specially in
  // ptyManager, which knows the configDir); Copilot reads its session store.
  detectSessionId?: (cwd: string, sinceMs: number) => string | null
}

const CLAUDE: BackendSpec = {
  id: 'claude',
  label: 'Claude',
  bin: 'claude',
  spawnArgs: ({ model, resumeId, sessionId, rcName, rc, skipPermissions }) => [
    ...(skipPermissions ? ['--permission-mode', 'bypassPermissions'] : []),
    '--model', model,
    // Remote Control is opt-in per session (📱 on the card) so the phone list
    // only shows sessions you actually want there, labeled with their name.
    ...(rc ? ['--remote-control', ...(rcName ? [rcName] : [])] : []),
    ...(resumeId ? ['--resume', resumeId] : []),
    // New session: we pick its id, so Chat view can read it from the first message
    ...(sessionId ? ['--session-id', sessionId] : []),
  ],
  env: (model): Record<string, string> =>
    // CLI 2.1.241 doesn't recognize the `claude-fable-5-1` id yet and refuses
    // to launch it without this; the flag just skips the unknown-model context
    // guard (Fable is 1M-context anyway). Remove once the CLI knows the id.
    model.startsWith('claude-fable-5-1')
      ? { CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1' }
      : {},
}

// GitHub Copilot CLI (standalone `copilot`, @github/copilot). Interactive by
// default (no -p). --allow-all is the full bypassPermissions equivalent
// (= --allow-all-tools --allow-all-paths --allow-all-urls) so it never prompts;
// --allow-all-tools alone still asks about file paths and URLs. --resume=<id>
// resumes a prior session. Copilot has its own remote-control/export prompts
// that would block an unattended PTY, so we disable them here (unrelated to
// Claude's Remote Control feature).
// Copilot records each session in ~/.copilot/session-store.db (sqlite). We find
// the newest session row for this cwd created at/after spawn time — the direct
// analog of Claude's per-project .jsonl scan. Uses the sqlite3 CLI to avoid a
// native dependency; returns null on any error (DB locked, no row yet, etc.).
function findCopilotSessionIdSince(cwd: string, sinceMs: number): string | null {
  const db = join(process.env.HOME!, '.copilot', 'session-store.db')
  try {
    // Copilot resolves symlinks in cwd (e.g. /tmp -> /private/tmp); match both
    // the raw and realpath'd forms so detection isn't fooled by that.
    let real = cwd
    try { real = execFileSync('/usr/bin/readlink', ['-f', cwd], { timeout: 2000 }).toString().trim() || cwd } catch {}
    const since = new Date(sinceMs - 1000).toISOString() // 1s tolerance for lag
    const sql = `SELECT id FROM sessions WHERE cwd IN ('${cwd.replace(/'/g, "''")}','${real.replace(/'/g, "''")}') AND created_at >= '${since}' ORDER BY created_at DESC LIMIT 1;`
    const out = execFileSync('sqlite3', [db, sql], { timeout: 3000 }).toString().trim()
    return out || null
  } catch {
    return null
  }
}

const COPILOT: BackendSpec = {
  id: 'copilot',
  label: 'Copilot',
  bin: 'copilot',
  detectSessionId: findCopilotSessionIdSince,
  spawnArgs: ({ model, cwd, resumeId, skipPermissions }) => [
    '--model', model,
    ...(skipPermissions ? ['--allow-all'] : []),
    // Trust the session's folder up front. --allow-all covers tools/paths/URLs
    // but NOT folder trust, so an interactive session in a new dir would pop a
    // "Confirm folder trust" prompt every time; --add-dir pre-trusts it.
    '--add-dir', cwd,
    '--no-remote',
    '--no-remote-export',
    // Copilot enables terminal mouse tracking by default, which captures drag
    // events so xterm.js can't select text (no copy). Disable it so click-drag
    // selection + copy work the same as in Claude sessions.
    '--no-mouse',
    ...(resumeId ? [`--resume=${resumeId}`] : []),
  ],
  env: () => ({}),
}

const realpath = (p: string) => { try { return execFileSync('/usr/bin/readlink', ['-f', p], { timeout: 2000 }).toString().trim() || p } catch { return p } }

// OpenCode (sst/opencode). TUI; sessions live in ~/.local/share/opencode/opencode.db.
// Footer shows "esc interrupt" while working. --auto = approve permissions.
const OPENCODE: BackendSpec = {
  id: 'opencode',
  label: 'OpenCode',
  bin: 'opencode',
  spawnArgs: ({ model, cwd, resumeId, skipPermissions }) => [
    cwd,
    ...modelArgs('-m', model),
    ...(skipPermissions ? ['--auto'] : []),
    ...(resumeId ? ['-s', resumeId] : []),
  ],
  env: () => ({}),
  detectSessionId: (cwd, sinceMs) => {
    const db = join(process.env.HOME!, '.local', 'share', 'opencode', 'opencode.db')
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`
    try {
      const out = execFileSync('sqlite3', [db, `SELECT id FROM session WHERE parent_id IS NULL AND directory IN (${q(cwd)},${q(realpath(cwd))}) AND time_created >= ${sinceMs - 1000} ORDER BY time_created DESC LIMIT 1;`], { timeout: 3000 }).toString().trim()
      return out || null
    } catch { return null }
  },
}

// OpenAI Codex CLI. Resume is a subcommand; sessions are JSONL files under
// ~/.codex/sessions/YYYY/MM/DD whose first line holds {payload: {id, cwd}}.
function findCodexSessionIdSince(cwd: string, sinceMs: number): string | null {
  const root = join(process.env.HOME!, '.codex', 'sessions')
  const real = realpath(cwd)
  const d = new Date(sinceMs)
  const dirs = [0, 1].map(off => { const x = new Date(d.getTime() + off * 86400000); return join(root, String(x.getFullYear()), String(x.getMonth() + 1).padStart(2, '0'), String(x.getDate()).padStart(2, '0')) })
  let best: { id: string; t: number } | null = null
  for (const dir of dirs) {
    let files: string[] = []
    try { files = readdirSync(dir).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const p = join(dir, f)
      try {
        const t = statSync(p).birthtimeMs
        if (t < sinceMs - 1000 || (best && t < best.t)) continue
        const fd = openSync(p, 'r'); const buf = Buffer.alloc(8192); const n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd)
        const meta = JSON.parse(buf.toString('utf-8', 0, n).split('\n')[0])
        const pl = meta.payload ?? meta
        if (pl.id && (pl.cwd === cwd || pl.cwd === real)) best = { id: pl.id, t }
      } catch { /* partial file */ }
    }
  }
  return best?.id ?? null
}

const CODEX: BackendSpec = {
  id: 'codex',
  label: 'Codex',
  bin: 'codex',
  spawnArgs: ({ model, resumeId, skipPermissions }) => [
    ...(resumeId ? ['resume', resumeId] : []),
    ...modelArgs('-m', model),
    ...(skipPermissions ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
  ],
  env: () => ({}),
  detectSessionId: findCodexSessionIdSince,
}

// Google Gemini CLI. --yolo = approve all tool calls. No resume support here yet.
const GEMINI: BackendSpec = {
  id: 'gemini',
  label: 'Gemini',
  bin: 'gemini',
  spawnArgs: ({ model, skipPermissions }) => [
    ...modelArgs('-m', model),
    ...(skipPermissions ? ['--yolo'] : []),
  ],
  env: () => ({}),
}

export const BACKENDS: Record<BackendId, BackendSpec> = {
  claude: CLAUDE,
  copilot: COPILOT,
  opencode: OPENCODE,
  codex: CODEX,
  gemini: GEMINI,
}

export const DEFAULT_BACKEND: BackendId = 'claude'

export function getBackend(id: string | null | undefined): BackendSpec {
  return BACKENDS[(id as BackendId)] ?? BACKENDS[DEFAULT_BACKEND]
}

// Which backends are actually runnable on this machine — the UI only offers
// these, so a missing binary can never produce a failed spawn.
const availabilityCache = new Map<string, boolean>()
function isBinaryAvailable(bin: string): boolean {
  if (availabilityCache.has(bin)) return availabilityCache.get(bin)!
  let ok = false
  try {
    // login shell so PATH matches where the user's CLIs live (e.g. ~/.local/bin)
    execSync(`zsh -lc 'command -v ${bin}'`, { stdio: 'ignore' })
    ok = true
  } catch {
    ok = false
  }
  // Cache only hits, so installing a CLI works without restarting Polyergon.
  if (ok) availabilityCache.set(bin, ok)
  return ok
}

export function availableBackends(): { id: BackendId; label: string }[] {
  return (Object.values(BACKENDS) as BackendSpec[])
    .filter(b => isBinaryAvailable(b.bin))
    .map(b => ({ id: b.id, label: b.label }))
}
