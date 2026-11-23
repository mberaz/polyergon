import { execFile } from 'child_process'
import { promisify } from 'util'
import { STRICT_PR_URL_RE } from './prDetector'
import type { PrCheckStatus, PrStatus } from './prTypes'

const execFileAsync = promisify(execFile)

export function isValidPrUrl(url: string): boolean {
  return STRICT_PR_URL_RE.test(url)
}

interface GhCheckItem {
  // CheckRun shape
  status?: string
  conclusion?: string | null
  // legacy StatusContext shape
  state?: string
}

// gh's statusCheckRollup mixes CheckRun (`status`/`conclusion`) and legacy
// StatusContext (`state`) shapes — normalize defensively; treat this as
// approximate and revisit if it misclassifies real PRs.
export function summarizeChecks(items: GhCheckItem[]): PrCheckStatus {
  if (!items || items.length === 0) return 'none'

  const FAILURE_CONCLUSIONS = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE'])
  const FAILURE_STATES = new Set(['FAILURE', 'ERROR'])
  const PENDING_STATUSES = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED'])
  const PENDING_STATES = new Set(['PENDING'])

  let sawPending = false
  for (const item of items) {
    if (item.conclusion && FAILURE_CONCLUSIONS.has(item.conclusion)) return 'failing'
    if (item.state && FAILURE_STATES.has(item.state)) return 'failing'
    if (item.status && PENDING_STATUSES.has(item.status) && !item.conclusion) sawPending = true
    if (item.state && PENDING_STATES.has(item.state)) sawPending = true
  }
  return sawPending ? 'pending' : 'passing'
}

// In-memory only — volatile data, cheap to refetch, intentionally lost on
// server restart. Populated only by explicit refresh calls (no background
// polling in this MVP).
export const prStatusCache = new Map<string, PrStatus>()

export async function fetchPrStatus(url: string): Promise<PrStatus | null> {
  if (!isValidPrUrl(url)) return null

  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', url,
      '--json', 'state,reviewDecision,statusCheckRollup,number,title,updatedAt',
    ], {
      timeout: 8000,
      env: {
        ...process.env,
        ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
      },
    })
    const json = JSON.parse(stdout)
    const updatedAt = json.updatedAt ? Date.parse(json.updatedAt) : NaN
    const status: PrStatus = {
      number: json.number,
      title: json.title,
      state: json.state,
      reviewDecision: json.reviewDecision ?? null,
      checks: summarizeChecks(json.statusCheckRollup ?? []),
      updatedAt: Number.isNaN(updatedAt) ? null : updatedAt,
      fetchedAt: Date.now(),
    }
    prStatusCache.set(url, status)
    return status
  } catch {
    return null
  }
}

// One `gh api graphql` call per BATCH PRs. Each process spawn blocks the event
// loop (badly on a loaded Mac with endpoint security scanning every exec), so
// one `gh pr view` per PR froze the whole app for seconds.
const BATCH = 40

export function batchQuery(urls: string[]): string {
  const parts = urls.map((url, i) => {
    const [, owner, name, num] = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/)!
    return `p${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${num}) {
      number title state reviewDecision updatedAt
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        ... on CheckRun { status conclusion } ... on StatusContext { state } } } } } } } } }`
  })
  return `query { ${parts.join('\n')} }`
}

export async function fetchAllPrStatuses(urls: string[]): Promise<Map<string, PrStatus>> {
  const unique = Array.from(new Set(urls)).filter(isValidPrUrl)
  const results = new Map<string, PrStatus>()

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    let stdout: string
    try {
      ({ stdout } = await execFileAsync('gh', ['api', 'graphql', '-f', `query=${batchQuery(batch)}`], { timeout: 30000, maxBuffer: 32 * 1024 * 1024 }))
    } catch (e) {
      // gh exits non-zero when any PR in the batch errors (e.g. deleted repo) but still prints the rest
      stdout = (e as { stdout?: string }).stdout ?? ''
    }
    let data: Record<string, { pullRequest?: GhPr | null } | null> = {}
    try { data = JSON.parse(stdout).data ?? {} } catch { continue }
    batch.forEach((url, idx) => {
      const pr = data[`p${idx}`]?.pullRequest
      if (!pr) return
      const updatedAt = pr.updatedAt ? Date.parse(pr.updatedAt) : NaN
      const status: PrStatus = {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        reviewDecision: pr.reviewDecision ?? null,
        checks: summarizeChecks(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []),
        updatedAt: Number.isNaN(updatedAt) ? null : updatedAt,
        fetchedAt: Date.now(),
      }
      prStatusCache.set(url, status)
      results.set(url, status)
    })
  }

  return results
}

interface GhPr {
  number: number; title: string; state: PrStatus['state']; reviewDecision: string | null; updatedAt: string | null
  commits?: { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: GhCheckItem[] } } | null } }[] }
}
