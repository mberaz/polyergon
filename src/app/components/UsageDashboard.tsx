'use client'
import { useState, useMemo } from 'react'
import type { UsageReport } from '@/lib/usageStore'
import type { LimitsReport } from '@/lib/planLimits'
import type { Org } from '@/lib/orgRegistry'
import type { SessionSummary } from '@/lib/sessionStore'
import type { LiveSessionInfo } from '@/hooks/useTerminal'

// Same validated categorical slots as the PR dashboard (gray-900 surface):
// slot order maps to org list order, so colors stay stable per org
const ORG_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500']
const MUTED = '#898781'

interface Props {
  usage: UsageReport
  limits: LimitsReport | null
  orgs: Org[]
  activeOrgId: string
  historySessions: SessionSummary[]
  liveSessions: LiveSessionInfo[]
  onAttachLive: (id: string) => void
  onSelectHistory: (sessionId: string, cwd: string | null, orgId?: string) => void
}

interface Tooltip { x: number; y: number; lines: string[] }

function fmtCost(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  if (v >= 100) return `$${Math.round(v)}`
  return `$${v.toFixed(2)}`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-900 rounded-lg px-5 py-4 flex-1 min-w-[130px]">
      <span className="text-xs text-gray-500">{label}</span>
      <p className="text-3xl font-semibold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function resetsIn(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (Number.isNaN(ms) || ms <= 0) return 'resetting…'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 48) return `resets in ${Math.round(h / 24)}d`
  if (h > 0) return `resets in ${h}h ${m}m`
  return `resets in ${m}m`
}

function severityColor(severity: string, percent: number): string {
  if (severity === 'critical' || percent >= 95) return '#d03b3b'
  if (severity === 'warning' || percent >= 80) return '#fab219'
  return '#0ca30c'
}

function LimitBar({ label, percent, resetsAt, severity }: { label: string; percent: number; resetsAt: string | null; severity: string }) {
  const color = severityColor(severity, percent)
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs text-gray-500">
          <span className="font-semibold" style={{ color }}>{percent}%</span> used · {100 - percent}% left · {resetsIn(resetsAt)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, percent)}%`, background: color, minWidth: percent > 0 ? 4 : 0 }} />
      </div>
    </div>
  )
}

export function UsageDashboard({ usage, limits, orgs, activeOrgId, historySessions, liveSessions, onAttachLive, onSelectHistory }: Props) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  const scopedOrgs = orgs.filter(o => (activeOrgId === 'all' || o.id === activeOrgId) && usage.orgs[o.id])
  const orgColor = (orgId: string) => ORG_COLORS[Math.max(0, orgs.findIndex(o => o.id === orgId)) % ORG_COLORS.length]

  // Combined KPIs across the scoped orgs
  const combined = scopedOrgs.reduce(
    (acc, o) => {
      const u = usage.orgs[o.id]
      acc.c5h += u.last5h.costUSD; acc.c24h += u.last24h.costUSD; acc.c7d += u.last7d.costUSD
      acc.total += u.totalCostUSD; acc.sessions += u.sessions
      acc.out += u.totalTokens.output; acc.inp += u.totalTokens.input; acc.cache += u.totalTokens.cacheRead
      return acc
    },
    { c5h: 0, c24h: 0, c7d: 0, total: 0, sessions: 0, out: 0, inp: 0, cache: 0 }
  )

  // Daily stacked series (7 days) across scoped orgs
  const days = usage.orgs[scopedOrgs[0]?.id]?.daily.map(d => d.dayStart) ?? []
  const dailyStacks = days.map((dayStart, i) => ({
    dayStart,
    parts: scopedOrgs.map(o => ({ orgId: o.id, name: o.name, cost: usage.orgs[o.id].daily[i]?.costUSD ?? 0 })),
    total: scopedOrgs.reduce((s, o) => s + (usage.orgs[o.id].daily[i]?.costUSD ?? 0), 0),
  }))
  const maxDay = Math.max(1, ...dailyStacks.map(d => d.total))

  // Top sessions by cost (scoped to org filter)
  const sessionNames = useMemo<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('claude-session-names') ?? '{}') } catch { return {} }
  }, [])
  const topSessions = useMemo(() => {
    return Object.entries(usage.sessions)
      .filter(([, s]) => activeOrgId === 'all' || s.orgId === activeOrgId)
      .sort((a, b) => b[1].costUSD - a[1].costUSD)
      .slice(0, 12)
      .map(([sessionId, s]) => {
        const history = historySessions.find(h => h.sessionId === sessionId)
        const live = liveSessions.find(l => l.claudeSessionId === sessionId)
        const name = (live && sessionNames[live.id]) || sessionNames[sessionId] || history?.firstUserMessage || sessionId.slice(0, 8)
        return { sessionId, name, cost: s.costUSD, tokens: s.tokens, orgId: s.orgId, liveId: live?.id ?? null, cwd: history?.cwd ?? live?.cwd ?? null }
      })
  }, [usage, activeOrgId, historySessions, liveSessions, sessionNames])

  function showTip(e: React.MouseEvent, lines: string[]) {
    const host = (e.currentTarget as Element).closest('[data-usage-root]')?.getBoundingClientRect()
    if (!host) return
    setTooltip({ x: e.clientX - host.left + 12, y: e.clientY - host.top + 12, lines })
  }

  const scopeName = activeOrgId === 'all' ? null : orgs.find(o => o.id === activeOrgId)?.name ?? null

  return (
    <div data-usage-root className="absolute inset-0 overflow-y-auto bg-gray-950">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-white font-semibold text-lg flex items-center gap-2">
            Usage
            {scopeName && <span className="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 text-xs font-medium">{scopeName}</span>}
          </h2>
          <span className="text-xs text-gray-600">scanned {new Date(usage.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p className="text-xs text-gray-600 mb-5">
          <span className="text-gray-400 font-medium">Dollar figures are value, not bills</span> — what your usage would cost at API prices. On a subscription you pay only the flat plan fee; limits throttle, they don&apos;t charge (unless an org has extra-usage billing on).
        </p>

        {/* Plan limits — the official "how much is left" */}
        {limits && scopedOrgs.some(o => limits.orgs[o.id]) && (
          <div className="bg-gray-900 rounded-lg p-5 mb-6">
            <h3 className="text-sm text-gray-200 font-medium mb-4">Plan limits (official, live)</h3>
            <div className={`grid gap-6 ${scopedOrgs.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {scopedOrgs.map(o => {
                const l = limits.orgs[o.id]
                if (!l) return null
                return (
                  <div key={o.id}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 rounded-full" style={{ background: orgColor(o.id) }} />
                      <span className="text-sm text-gray-200 font-medium">{o.name}</span>
                      {o.plan?.name && <span className="text-xs text-gray-600">· {o.plan.name}</span>}
                    </div>
                    {l.error
                      ? <p className="text-xs text-yellow-600">{l.error}</p>
                      : <div className="space-y-3">
                          {l.fiveHour && <LimitBar label="Session (5h window)" percent={l.fiveHour.percent} resetsAt={l.fiveHour.resetsAt} severity={l.fiveHour.severity} />}
                          {l.weekly && <LimitBar label="Weekly (all models)" percent={l.weekly.percent} resetsAt={l.weekly.resetsAt} severity={l.weekly.severity} />}
                          {l.scoped.map(s => (
                            <LimitBar key={s.name} label={`Weekly · ${s.name}`} percent={s.percent} resetsAt={s.resetsAt} severity={s.severity} />
                          ))}
                          {l.extraUsage && (
                            l.extraUsage.enabled ? (
                              <div className="flex items-baseline justify-between rounded bg-red-950/40 border border-red-900/40 px-2.5 py-1.5">
                                <span className="text-xs text-red-300 font-medium">Extra usage ON — overage bills real money</span>
                                <span className="text-xs text-red-200 font-semibold">
                                  {l.extraUsage.usedUSD != null ? `$${l.extraUsage.usedUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })} billed` : ''}
                                  {l.extraUsage.spendLimitReached ? ' · spend limit reached' : ''}
                                </span>
                              </div>
                            ) : (
                              <p className="text-[11px] text-gray-600">Extra usage off — hard cap at the subscription; hitting a limit only throttles, never bills.</p>
                            )
                          )}
                        </div>
                    }
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* KPI row */}
        <div className="flex gap-3 flex-wrap mb-6">
          <StatTile label="Last 5 hours" value={fmtCost(combined.c5h)} sub="rate-limit window" />
          <StatTile label="Last 24 hours" value={fmtCost(combined.c24h)} />
          <StatTile label="Last 7 days" value={fmtCost(combined.c7d)} sub="weekly-cap window" />
          <StatTile label="All-time" value={fmtCost(combined.total)} sub={`${combined.sessions} sessions`} />
        </div>

        {/* Daily cost, stacked by org */}
        <div className="bg-gray-900 rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm text-gray-200 font-medium">Value per day <span className="text-xs text-gray-600 font-normal">(API-equivalent, not billed)</span></h3>
            {scopedOrgs.length > 1 && (
              <div className="flex items-center gap-3">
                {scopedOrgs.map(o => (
                  <span key={o.id} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: orgColor(o.id) }} />{o.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-end justify-between gap-3 h-40">
            {dailyStacks.map(day => {
              const label = new Date(day.dayStart).toLocaleDateString([], { weekday: 'short' })
              return (
                <div key={day.dayStart} className="flex-1 flex flex-col items-center justify-end h-full">
                  {day.total > 0 && <span className="text-xs text-gray-400 mb-1">{fmtCost(day.total)}</span>}
                  <div className="w-full flex flex-col-reverse" style={{ height: `${(day.total / maxDay) * 80}%`, gap: 2 }}>
                    {day.parts.map((p, i) => p.cost > 0 && (
                      <div
                        key={p.orgId}
                        className="w-full hover:brightness-125"
                        style={{
                          flex: `${p.cost} 0 auto`,
                          background: orgColor(p.orgId),
                          borderRadius: i === day.parts.filter(x => x.cost > 0).length - 1 ? '4px 4px 0 0' : 0,
                          minHeight: 3,
                        }}
                        onMouseMove={e => showTip(e, [`${p.name} — ${label}`, fmtCost(p.cost)])}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] mt-1.5" style={{ color: MUTED }}>{label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* Per-org standing */}
          <div className="bg-gray-900 rounded-lg p-5">
            <h3 className="text-sm text-gray-200 font-medium mb-3">By org</h3>
            <div className="space-y-3">
              {scopedOrgs.map(o => {
                const u = usage.orgs[o.id]
                // Monthly run-rate from the last 7 days vs the plan's flat price
                const monthlyRunRate = u.last7d.costUSD * (365.25 / 12 / 7)
                const roi = o.plan?.monthlyUSD ? monthlyRunRate / o.plan.monthlyUSD : null
                return (
                  <div key={o.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: orgColor(o.id) }} />
                      <span className="text-sm text-gray-200 font-medium flex-1">{o.name}</span>
                      <span className="text-sm text-white font-semibold">{fmtCost(u.totalCostUSD)}</span>
                    </div>
                    <div className="flex gap-2 text-xs text-gray-500 pl-4 flex-wrap">
                      <span>5h {fmtCost(u.last5h.costUSD)}</span>·
                      <span>24h {fmtCost(u.last24h.costUSD)}</span>·
                      <span>7d {fmtCost(u.last7d.costUSD)}</span>·
                      <span>{u.sessions} sessions</span>
                    </div>
                    {o.plan?.monthlyUSD ? (
                      <div className="text-xs pl-4 mt-0.5">
                        <span className="text-gray-500">{o.plan.name ?? 'Plan'} {fmtCost(o.plan.monthlyUSD)}/mo · run-rate {fmtCost(monthlyRunRate)}/mo → </span>
                        <span className={`font-semibold ${roi! >= 1 ? 'text-emerald-500' : 'text-yellow-500'}`}>{roi!.toFixed(1)}× plan value</span>
                      </div>
                    ) : (
                      <div className="text-[10px] text-gray-700 pl-4 mt-0.5">Set plan.monthlyUSD in orgs.json to see ROI vs subscription</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Token totals */}
          <div className="bg-gray-900 rounded-lg p-5">
            <h3 className="text-sm text-gray-200 font-medium mb-3">Tokens (all-time)</h3>
            <div className="space-y-2.5">
              {([
                ['Output', combined.out, 'what the models wrote'],
                ['Input (fresh)', combined.inp, 'uncached prompt tokens'],
                ['Cache reads', combined.cache, 'context served from cache at ~0.1× price'],
              ] as const).map(([label, value, sub]) => (
                <div key={label} className="flex items-baseline justify-between">
                  <div>
                    <span className="text-sm text-gray-300">{label}</span>
                    <span className="text-xs text-gray-600 ml-2">{sub}</span>
                  </div>
                  <span className="text-sm text-white font-semibold">{fmtTokens(value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Most expensive sessions */}
        <div className="bg-gray-900 rounded-lg p-5">
          <h3 className="text-sm text-gray-200 font-medium mb-3">Most expensive sessions</h3>
          {topSessions.length === 0
            ? <p className="text-xs text-gray-600">No usage recorded</p>
            : <div className="space-y-0.5">
                {topSessions.map(s => (
                  <button
                    key={s.sessionId}
                    onClick={() => s.liveId ? onAttachLive(s.liveId) : onSelectHistory(s.sessionId, s.cwd, s.orgId)}
                    className="w-full flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-800/70 text-left"
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: orgColor(s.orgId) }} />
                    <span className="text-sm text-gray-200 truncate flex-1" title={s.name}>{s.name}</span>
                    {s.liveId && <span className="text-[10px] text-blue-500/80 flex-shrink-0">live</span>}
                    <span className="text-xs text-gray-600 flex-shrink-0 w-20 text-right">{fmtTokens(s.tokens.output)} out</span>
                    <span className="text-sm text-emerald-500 font-medium flex-shrink-0 w-16 text-right">{fmtCost(s.cost)}</span>
                  </button>
                ))}
              </div>
          }
        </div>
      </div>

      {tooltip && (
        <div
          className="absolute z-30 pointer-events-none bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.lines.map((line, i) => (
            <p key={i} className={i === 0 ? 'text-xs text-gray-400' : 'text-xs text-white font-medium'}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
