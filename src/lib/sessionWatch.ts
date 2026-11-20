import { statSync } from 'fs'
import { join } from 'path'
import { liveSessionStore } from './liveSessionStore'
import { orgRegistry } from './orgRegistry'
import { screenText, submitLine, lastOutputAt, claudeProjectDir } from './ptyManager'

// Usage limits and stalls, for every live session:
// - Claude shows "…limit reached… resets 3pm" and stops: we send "continue" a minute after the reset.
// - A session "thinking" with no progress for STALL_MS: tell the user once.
const TICK_MS = 30_000
const STALL_MS = 15 * 60_000
const RESUME_DELAY_MS = 60_000

const LIMIT_RE = /(usage limit|limit reached|hit your (?:\w+ )?limit|limit will reset)/i

// Reset time from Claude's limit message, as epoch ms after `now`. null if none.
export function parseLimitReset(text: string, now = Date.now()): number | null {
  if (!LIMIT_RE.test(text)) return null
  const rel = text.match(/resets? in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i)
  if (rel && (rel[1] || rel[2])) return now + (Number(rel[1] ?? 0) * 60 + Number(rel[2] ?? 0)) * 60_000
  const abs = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (!abs) return null
  let h = Number(abs[1]) % 12
  if (abs[3].toLowerCase() === 'pm') h += 12
  const d = new Date(now)
  d.setHours(h, Number(abs[2] ?? 0), 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export interface SessionAlert { id: string; title: string; body: string }

class SessionWatch {
  limitResetAt = new Map<string, number>() // session → when its usage limit resets
  stalledSince = new Map<string, number>()
  private resumedAt = new Map<string, number>() // session → when we sent "continue" (old message stays on screen a while)
  private listeners = new Set<(a: SessionAlert) => void>()
  private started = false

  onAlert(fn: (a: SessionAlert) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private alert(a: SessionAlert) { this.listeners.forEach(fn => fn(a)) }

  start() {
    if (this.started) return
    this.started = true
    setInterval(() => this.tick(), TICK_MS).unref()
  }

  // Last sign of progress: Claude's transcript write, else any screen output
  private progressAt(id: string): number {
    const s = liveSessionStore.get(id)
    let t = lastOutputAt.get(id) ?? 0
    if (s?.claudeSessionId && (s.backend ?? 'claude') === 'claude') {
      try { t = statSync(join(claudeProjectDir(s.cwd, orgRegistry.get(s.orgId)?.configDir ?? null), `${s.claudeSessionId}.jsonl`)).mtimeMs } catch { /* not written yet */ }
    }
    return t
  }

  tick(now = Date.now()) {
    for (const s of liveSessionStore.list()) {
      // Usage limit (Claude only; the message sits at the bottom of the screen)
      if ((s.backend ?? 'claude') === 'claude' && s.status !== 'idle') {
        const reset = parseLimitReset(screenText(s.id), now)
        if (reset && !this.limitResetAt.has(s.id) && now - (this.resumedAt.get(s.id) ?? 0) > 10 * 60_000) {
          this.limitResetAt.set(s.id, reset)
          this.alert({ id: s.id, title: 'Usage limit reached', body: `Polyergon will continue it at ${new Date(reset + RESUME_DELAY_MS).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` })
        }
      }
      const due = this.limitResetAt.get(s.id)
      if (due && now >= due + RESUME_DELAY_MS) {
        this.limitResetAt.delete(s.id)
        this.resumedAt.set(s.id, now)
        if (s.status === 'waiting') {
          submitLine(s.id, 'continue')
          this.alert({ id: s.id, title: 'Usage limit reset', body: 'Sent "continue" to the session' })
        }
      }

      // Stall: thinking, but nothing written for a long time
      if (s.status === 'thinking') {
        const quietFor = now - this.progressAt(s.id)
        if (quietFor > STALL_MS && !this.stalledSince.has(s.id)) {
          this.stalledSince.set(s.id, now - quietFor)
          this.alert({ id: s.id, title: 'Session looks stuck', body: `No progress for ${Math.round(quietFor / 60_000)} minutes. A long command may still be running; open it to check.` })
        } else if (quietFor <= STALL_MS) this.stalledSince.delete(s.id)
      } else this.stalledSince.delete(s.id)
    }
  }
}

declare global { var __sessionWatch: SessionWatch | undefined }
export const sessionWatch: SessionWatch = global.__sessionWatch ?? (global.__sessionWatch = new SessionWatch())
