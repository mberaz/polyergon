import { DATA_DIR } from './dataDir'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// App-wide user settings, persisted server-side so every hostname/browser
// agrees. Read from disk on every call: the custom server (ts-node) and Next's
// API routes load separate module copies, so an in-memory cache would go stale.

export interface Settings {
  autoCompact: { enabled: boolean; windowTokens: number }
  notifications: { enabled: boolean }
  // Off by default: agents ask before running commands or editing files.
  sessions: { skipPermissions: boolean }
}

// Claude Code's CLAUDE_CODE_AUTO_COMPACT_WINDOW accepts 100k–1M.
export const AUTO_COMPACT_MIN = 100_000
export const AUTO_COMPACT_MAX = 1_000_000
export const DEFAULT_SETTINGS: Settings = { autoCompact: { enabled: true, windowTokens: 300_000 }, notifications: { enabled: true }, sessions: { skipPermissions: false } }

const FILE = join(DATA_DIR, 'settings.json')

const clamp = (n: number) => Math.min(AUTO_COMPACT_MAX, Math.max(AUTO_COMPACT_MIN, Math.round(n)))

export function getSettings(file = FILE): Settings {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<Settings>
    const ac = { ...DEFAULT_SETTINGS.autoCompact, ...raw.autoCompact }
    const nt = { ...DEFAULT_SETTINGS.notifications, ...raw.notifications }
    return {
      autoCompact: { enabled: !!ac.enabled, windowTokens: clamp(Number(ac.windowTokens) || DEFAULT_SETTINGS.autoCompact.windowTokens) },
      notifications: { enabled: !!nt.enabled },
      sessions: { skipPermissions: raw.sessions?.skipPermissions === true },
    }
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function updateSettings(patch: Partial<Settings>, file = FILE): Settings {
  const cur = getSettings(file)
  const next: Settings = {
    autoCompact: { ...cur.autoCompact, ...patch.autoCompact },
    notifications: { enabled: !!{ ...cur.notifications, ...patch.notifications }.enabled },
    sessions: { skipPermissions: ({ ...cur.sessions, ...patch.sessions }).skipPermissions === true },
  }
  next.autoCompact.windowTokens = clamp(Number(next.autoCompact.windowTokens) || cur.autoCompact.windowTokens)
  next.autoCompact.enabled = !!next.autoCompact.enabled
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2))
  return next
}

// Env for a Claude spawn. Disabled → nothing set, the CLI keeps its own default.
export function autoCompactEnv(): Record<string, string> {
  const { autoCompact } = getSettings()
  return autoCompact.enabled ? { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(autoCompact.windowTokens) } : {}
}
