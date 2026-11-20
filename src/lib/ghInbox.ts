import { execFile } from 'child_process'
import { promisify } from 'util'
import { fetchAllPrStatuses, prStatusCache } from './ghPrStatus'
import { buildPrSessionEntries } from './prSessionEntries'
import type { PrStatus, PrSessionEntry } from './prTypes'

const execFileAsync = promisify(execFile)

export type InboxSectionKey = 'needsReview' | 'returned' | 'waiting' | 'mergedRecent'

export interface InboxPr {
  url: string
  title: string
  repo: string // owner/name
  updatedAt: number
  createdAt: number
  closedAt: number | null
  isDraft: boolean
  status: PrStatus | null
  // Link back to the Claude session that touched this PR, when one exists
  liveId: string | null
  sessionId: string | null
  cwd: string | null
}

export interface PrInbox {
  sections: Record<InboxSectionKey, InboxPr[]>
  // Session-detected PRs outside your GitHub workload (e.g. teammates' PRs a
  // session reviewed) — kept so nothing silently disappears from the old tab
  fromSessions: PrSessionEntry[]
  // Merged-per-week counts over the stats window, oldest week first
  mergedByWeek: { weekStart: number; count: number }[]
  // Every merged PR in the stats window (for per-week drill-down)
  mergedWindow: InboxPr[]
  fetchedAt: number
  error: string | null
}

const CACHE_TTL_MS = 5 * 60 * 1000
const MERGED_SECTION_DAYS = 7
const STATS_WINDOW_WEEKS = 8
const SEARCH_LIMIT = '50'
const MERGED_SEARCH_LIMIT = '200'

interface GhSearchItem {
  url: string
  title: string
  repository?: { nameWithOwner?: string }
  updatedAt?: string
  createdAt?: string
  closedAt?: string
  isDraft?: boolean
}

// gh must use the local keyring credentials (which can see private orgs), so
// any GITHUB_TOKEN/GH_TOKEN in the server's environment is stripped.
function ghEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  return env
}

async function ghSearchPrs(args: string[], limit: string = SEARCH_LIMIT): Promise<GhSearchItem[]> {
  const { stdout } = await execFileAsync('gh', [
    'search', 'prs', ...args,
    '--json', 'url,title,repository,updatedAt,createdAt,closedAt,isDraft',
    '--limit', limit,
  ], { timeout: 30000, env: ghEnv(), maxBuffer: 10 * 1024 * 1024 })
  return JSON.parse(stdout)
}

function parseMs(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? 0 : t
}

function toInboxPr(item: GhSearchItem, sessionByUrl: Map<string, PrSessionEntry>): InboxPr {
  const session = sessionByUrl.get(item.url)
  // gh reports Go's zero time ("0001-01-01T00:00:00Z") for open PRs' closedAt
  // — it parses to a large negative number, so only positive times count
  const closedAt = parseMs(item.closedAt)
  return {
    url: item.url,
    title: item.title,
    repo: item.repository?.nameWithOwner ?? item.url.match(/github\.com\/([\w.-]+\/[\w.-]+)/)?.[1] ?? '',
    updatedAt: parseMs(item.updatedAt),
    createdAt: parseMs(item.createdAt),
    closedAt: closedAt > 0 ? closedAt : null,
    isDraft: item.isDraft ?? false,
    status: prStatusCache.get(item.url) ?? null,
    liveId: session?.liveId ?? null,
    sessionId: session?.sessionId ?? null,
    cwd: session?.cwd ?? null,
  }
}

// Monday 00:00 local time of the week containing `t`
function weekStartOf(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

// Your PR is back in your court when a reviewer asked for changes or CI is red
function isReturned(status: PrStatus | null): boolean {
  return !!status && status.state === 'OPEN' &&
    (status.reviewDecision === 'CHANGES_REQUESTED' || status.checks === 'failing')
}

export async function buildInbox(): Promise<PrInbox> {
  // Merged query spans the stats window (8 weeks); the "Recently merged"
  // section shows only the last 7 days of it
  const mergedSince = new Date(weekStartOf(Date.now()) - (STATS_WINDOW_WEEKS - 1) * 7 * 86_400_000).toISOString().slice(0, 10)

  const [authoredRes, reviewRes, mergedRes, sessionEntries] = await Promise.allSettled([
    ghSearchPrs(['--author=@me', '--state=open']),
    ghSearchPrs(['--review-requested=@me', '--state=open']),
    ghSearchPrs(['--author=@me', '--merged', `--merged-at=>=${mergedSince}`], MERGED_SEARCH_LIMIT),
    buildPrSessionEntries(),
  ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null))

  const authored = (authoredRes as GhSearchItem[] | null) ?? []
  const reviewRequested = (reviewRes as GhSearchItem[] | null) ?? []
  const merged = (mergedRes as GhSearchItem[] | null) ?? []
  const sessions = (sessionEntries as PrSessionEntry[] | null) ?? []
  const error = authoredRes === null && reviewRes === null
    ? 'gh search failed — check `gh auth status` on the server machine'
    : null

  const sessionByUrl = new Map(sessions.map(e => [e.prUrl, e]))

  // Fresh review/checks detail for every open PR — this is what decides
  // returned-vs-waiting, so it can't rely on a stale cache
  const openUrls = [...authored, ...reviewRequested].map(i => i.url)
  await fetchAllPrStatuses(openUrls)

  const needsReview: InboxPr[] = []
  const returned: InboxPr[] = []
  const waiting: InboxPr[] = []
  const seen = new Set<string>()

  for (const item of reviewRequested) {
    seen.add(item.url)
    needsReview.push(toInboxPr(item, sessionByUrl))
  }
  for (const item of authored) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    const pr = toInboxPr(item, sessionByUrl)
    if (isReturned(pr.status)) returned.push(pr)
    else waiting.push(pr)
  }
  const mergedAll = merged.filter(i => !seen.has(i.url)).map(i => toInboxPr(i, sessionByUrl))
  const mergedRecent = mergedAll.filter(p => (p.closedAt ?? 0) >= Date.now() - MERGED_SECTION_DAYS * 86_400_000)

  // Merged-per-week buckets across the full stats window (zero-filled)
  const thisWeek = weekStartOf(Date.now())
  const mergedByWeek = Array.from({ length: STATS_WINDOW_WEEKS }, (_, i) => ({
    weekStart: thisWeek - (STATS_WINDOW_WEEKS - 1 - i) * 7 * 86_400_000,
    count: 0,
  }))
  for (const p of mergedAll) {
    if (!p.closedAt) continue
    const bucket = mergedByWeek.find(b => weekStartOf(p.closedAt!) === b.weekStart)
    if (bucket) bucket.count++
  }

  const byUpdated = (a: InboxPr, b: InboxPr) => b.updatedAt - a.updatedAt
  needsReview.sort(byUpdated); returned.sort(byUpdated); waiting.sort(byUpdated); mergedRecent.sort(byUpdated)

  // Session PRs outside the workload, still relevant (open or status unknown)
  const inboxUrls = new Set(Array.from(seen).concat(mergedRecent.map(p => p.url)))
  const fromSessions = sessions.filter(e =>
    !inboxUrls.has(e.prUrl) && (!e.status || e.status.state === 'OPEN'))

  return {
    sections: { needsReview, returned, waiting, mergedRecent },
    fromSessions,
    mergedByWeek,
    mergedWindow: mergedAll.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    fetchedAt: Date.now(),
    error,
  }
}

// On globalThis, not module scope: Next dev re-evaluates route modules, which
// reset module-level state and let several 20s `gh` searches run concurrently.
declare global { var __ghInbox: { cached: PrInbox | null; inFlight: Promise<PrInbox> | null } | undefined }
const st = global.__ghInbox ?? (global.__ghInbox = { cached: null, inFlight: null })

export async function getInbox(force = false): Promise<PrInbox> {
  if (!force && st.cached && Date.now() - st.cached.fetchedAt < CACHE_TTL_MS) return st.cached
  if (!st.inFlight) {
    st.inFlight = buildInbox()
      .then(inbox => { st.cached = inbox; return inbox })
      .finally(() => { st.inFlight = null })
  }
  return st.inFlight
}
