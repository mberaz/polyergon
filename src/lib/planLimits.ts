import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { orgRegistry } from './orgRegistry'

const execFileAsync = promisify(execFile)
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CACHE_TTL_MS = 60_000

export interface LimitWindow {
  percent: number
  resetsAt: string | null
  severity: string
}

export interface ExtraUsage {
  enabled: boolean
  // Real money billed beyond the subscription this period, in dollars
  usedUSD: number | null
  monthlyLimitUSD: number | null
  spendLimitReached: boolean
}

export interface OrgLimits {
  fiveHour: LimitWindow | null
  weekly: LimitWindow | null
  // Model-scoped weekly limits (e.g. Fable has its own weekly cap)
  scoped: { name: string; percent: number; severity: string; resetsAt: string | null }[]
  extraUsage: ExtraUsage | null
  error: string | null
}

export type LimitsReport = { orgs: Record<string, OrgLimits>; fetchedAt: number }

// Claude Code stores each config dir's OAuth token in the macOS keychain as
// "Claude Code-credentials[-<first 8 hex of sha256(configDir)>]"; the default
// ~/.claude dir uses the unsuffixed name.
function keychainService(configDir: string | null): string {
  if (!configDir) return 'Claude Code-credentials'
  return `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`
}

async function readToken(configDir: string | null): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password', '-s', keychainService(configDir), '-w',
    ], { timeout: 5000 })
    return JSON.parse(stdout.trim()).claudeAiOauth?.accessToken ?? null
  } catch {
    return null
  }
}

async function fetchOrgLimits(configDir: string | null): Promise<OrgLimits> {
  const none: OrgLimits = { fiveHour: null, weekly: null, scoped: [], extraUsage: null, error: null }
  const token = await readToken(configDir)
  if (!token) return { ...none, error: 'No login found for this org' }

  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401) return { ...none, error: 'Token expired — open a Claude session in this org to refresh it' }
    if (!res.ok) return { ...none, error: `Usage endpoint returned ${res.status}` }
    const d = await res.json() as {
      limits?: { kind: string; percent: number; severity: string; resets_at: string | null; scope?: { model?: { display_name?: string } } | null }[]
      extra_usage?: {
        is_enabled?: boolean
        used_credits?: number | null
        decimal_places?: number | null
        monthly_limit?: number | null
        spend_limit_reached?: boolean
      } | null
    }

    const limits = d.limits ?? []
    const find = (kind: string) => limits.find(l => l.kind === kind)
    const session = find('session')
    const weekly = find('weekly_all')
    const scoped = limits
      .filter(l => l.kind === 'weekly_scoped')
      .map(l => ({
        name: l.scope?.model?.display_name ?? 'scoped',
        percent: l.percent,
        severity: l.severity,
        resetsAt: l.resets_at,
      }))

    const eu = d.extra_usage
    const scale = Math.pow(10, eu?.decimal_places ?? 2)
    const extraUsage: ExtraUsage | null = eu
      ? {
          enabled: eu.is_enabled ?? false,
          usedUSD: eu.used_credits != null ? eu.used_credits / scale : null,
          monthlyLimitUSD: eu.monthly_limit != null ? eu.monthly_limit / scale : null,
          spendLimitReached: eu.spend_limit_reached ?? false,
        }
      : null

    return {
      fiveHour: session ? { percent: session.percent, resetsAt: session.resets_at, severity: session.severity } : null,
      weekly: weekly ? { percent: weekly.percent, resetsAt: weekly.resets_at, severity: weekly.severity } : null,
      scoped,
      extraUsage,
      error: null,
    }
  } catch (e) {
    return { ...none, error: e instanceof Error ? e.message : 'fetch failed' }
  }
}

let cached: LimitsReport | null = null
let inFlight: Promise<LimitsReport> | null = null

export async function getLimits(force = false): Promise<LimitsReport> {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached
  if (!inFlight) {
    inFlight = (async () => {
      const orgs: Record<string, OrgLimits> = {}
      await Promise.all(orgRegistry.list().map(async org => {
        orgs[org.id] = await fetchOrgLimits(org.configDir)
      }))
      const report = { orgs, fetchedAt: Date.now() }
      cached = report
      return report
    })().finally(() => { inFlight = null })
  }
  return inFlight
}
