import { liveSessionStore } from './liveSessionStore'
import { listAllSessions } from './sessionStore'
import { prUrlCache } from './prScanCache'
import { prStatusCache } from './ghPrStatus'
import { orgRegistry, DEFAULT_ORG_ID } from './orgRegistry'
import type { PrSessionEntry } from './prTypes'

// Assembles the full PR-linked session list: live sessions whose PR was
// detected from streaming output, plus history-only sessions whose PR was
// found via the lazy full-file cache scan — decorated with whatever status
// is already cached (no new `gh` calls here; that's refresh's job).
export async function buildPrSessionEntries(): Promise<PrSessionEntry[]> {
  const [historyUrls, historySessions] = await Promise.all([
    prUrlCache.scan(orgRegistry.projectRoots().map(r => r.root)),
    listAllSessions(),
  ])
  const historyBySessionId = new Map(historySessions.map(s => [s.sessionId, s]))

  const entries: PrSessionEntry[] = []
  const seenSessionIds = new Set<string>()

  for (const s of liveSessionStore.list()) {
    if (!s.prUrl) continue
    entries.push({
      source: 'live',
      liveId: s.id,
      sessionId: s.claudeSessionId,
      orgId: s.orgId ?? DEFAULT_ORG_ID,
      cwd: s.cwd,
      gitRoot: s.gitRoot,
      prUrl: s.prUrl,
      status: prStatusCache.get(s.prUrl) ?? null,
      sessionDate: s.createdAt,
    })
    if (s.claudeSessionId) seenSessionIds.add(s.claudeSessionId)
  }

  historyUrls.forEach((prUrl, sessionId) => {
    if (seenSessionIds.has(sessionId)) return // already covered by a live entry
    const match = historyBySessionId.get(sessionId)
    const parsed = match?.lastTimestamp ? Date.parse(match.lastTimestamp) : NaN
    entries.push({
      source: 'history',
      liveId: null,
      sessionId,
      orgId: match?.orgId ?? DEFAULT_ORG_ID,
      cwd: match?.cwd ?? null,
      gitRoot: match?.gitRoot ?? null,
      prUrl,
      status: prStatusCache.get(prUrl) ?? null,
      sessionDate: Number.isNaN(parsed) ? 0 : parsed,
    })
  })

  return entries
}

function isActionable(e: PrSessionEntry): boolean {
  return e.status?.state === 'OPEN' && (e.status.reviewDecision === 'CHANGES_REQUESTED' || e.status.checks === 'failing')
}

function priority(e: PrSessionEntry): number {
  if (isActionable(e)) return 0
  if (!e.status || e.status.state === 'OPEN') return 1
  if (e.status.state === 'MERGED') return 2
  return 3 // CLOSED
}

// The PR's own GitHub last-updated time once known (post-refresh); falls
// back to the session's own date so every entry always sorts/displays
// something meaningful even before a refresh has ever run.
export function effectiveDate(e: PrSessionEntry): number {
  return e.status?.updatedAt ?? e.sessionDate
}

// Actionable (changes requested / failing checks) first, then open-no-action
// (or status not yet known), then merged, then closed last; newest first
// within each tier.
export function sortPrEntries(entries: PrSessionEntry[]): PrSessionEntry[] {
  return [...entries].sort((a, b) => {
    const pa = priority(a), pb = priority(b)
    if (pa !== pb) return pa - pb
    return effectiveDate(b) - effectiveDate(a)
  })
}

// Pure newest-first, ignoring the actionable/state tiering entirely.
export function sortPrEntriesByDate(entries: PrSessionEntry[]): PrSessionEntry[] {
  return [...entries].sort((a, b) => effectiveDate(b) - effectiveDate(a))
}
