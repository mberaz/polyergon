import { execFile } from 'child_process'
import { promisify } from 'util'
import { STRICT_PR_URL_RE } from './prDetector'
import type { PrCheckStatus, PrStatus } from './prTypes'

const execFileAsync = promisify(execFile)
const CONCURRENCY = 6

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

// Concurrency-capped so one hung `gh` call can't block the rest.
export async function fetchAllPrStatuses(urls: string[]): Promise<Map<string, PrStatus>> {
  const unique = Array.from(new Set(urls))
  const results = new Map<string, PrStatus>()

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(batch.map(url => fetchPrStatus(url)))
    settled.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) results.set(batch[idx], r.value)
    })
  }

  return results
}
