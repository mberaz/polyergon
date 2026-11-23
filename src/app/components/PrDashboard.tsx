'use client'
import { useState, useMemo } from 'react'
import type { PrInbox, InboxPr } from '@/lib/ghInbox'
import type { Org } from '@/lib/orgRegistry'
import { repoInOrg } from '@/lib/orgFilter'

// Categorical slots validated against the gray-900 card surface (#111827):
// CVD ΔE ≥ 9.4, normal-vision ΔE ≥ 26.5, contrast ≥ 3:1 — dataviz-skill run
const C = {
  needsReview: '#3987e5',
  returned: '#d95926',
  waiting: '#199e70',
  muted: '#898781',
}
// Ordinal blue ramp (dark-safe band, light→dark = young→old)
const AGE_RAMP = ['#86b6ef', '#5598e7', '#3987e5', '#256abf', '#184f95']

const DAY = 86_400_000
const WEEK = 7 * DAY

type SectKey = 'needsReview' | 'returned' | 'waiting'

interface Props {
  inbox: PrInbox
  orgs: Org[]
  activeOrgId: string
  refreshing: boolean
  onRefresh: () => void
  onAttachLive: (id: string) => void
  onSelectHistory: (sessionId: string, cwd: string | null) => void
  onReviewWithClaude: (url: string) => void
}

interface Tooltip { x: number; y: number; lines: string[] }
// mine: open PRs you authored (Returned to you + Waiting on others, drafts included)
interface Filter { section?: SectKey; mine?: boolean; repo?: string; ageBucket?: string; weekStart?: number }
const MINE: SectKey[] = ['returned', 'waiting']

const SECT_META: { key: SectKey; label: string; color: string }[] = [
  { key: 'needsReview', label: 'Needs your review', color: C.needsReview },
  { key: 'returned', label: 'Returned to you', color: C.returned },
  { key: 'waiting', label: 'Waiting on others', color: C.waiting },
]

const AGE_DEFS = [
  { label: '<2d', min: 0, max: 2 * DAY },
  { label: '2–7d', min: 2 * DAY, max: 7 * DAY },
  { label: '1–2w', min: 7 * DAY, max: 14 * DAY },
  { label: '2–4w', min: 14 * DAY, max: 28 * DAY },
  { label: '>4w', min: 28 * DAY, max: Infinity },
]

function ageLabel(ms: number): string {
  const days = Math.floor(ms / DAY)
  if (days < 1) return 'today'
  if (days < 14) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function StatTile({ label, value, accent, selected, onClick }: {
  label: string; value: number; accent?: string; selected?: boolean; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-gray-900 rounded-lg px-5 py-4 flex-1 min-w-[140px] text-left transition-all ${
        onClick ? 'hover:bg-gray-800/80 cursor-pointer' : 'cursor-default'
      } ${selected ? 'ring-2 ring-blue-500' : ''}`}
    >
      <div className="flex items-center gap-2">
        {accent && <span className="w-2 h-2 rounded-full" style={{ background: accent }} />}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-4xl font-semibold text-white mt-1.5">{value}</p>
    </button>
  )
}

export function PrDashboard({ inbox, orgs, activeOrgId, refreshing, onRefresh, onAttachLive, onSelectHistory, onReviewWithClaude }: Props) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [filter, setFilter] = useState<Filter | null>(null)

  const inOrg = (p: InboxPr) => repoInOrg(p.repo, activeOrgId, orgs)
  const orgName = activeOrgId === 'all' ? null : orgs.find(o => o.id === activeOrgId)?.name ?? null

  const openPrs = useMemo(
    () => [
      ...inbox.sections.needsReview.filter(inOrg).map(p => ({ ...p, sect: 'needsReview' as const })),
      ...inbox.sections.returned.filter(inOrg).map(p => ({ ...p, sect: 'returned' as const })),
      ...inbox.sections.waiting.filter(inOrg).map(p => ({ ...p, sect: 'waiting' as const })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inbox, activeOrgId, orgs]
  )
  const mergedWindow = useMemo(
    () => (inbox.mergedWindow ?? []).filter(inOrg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inbox, activeOrgId, orgs]
  )

  const byRepo = useMemo(() => {
    const map = new Map<string, { needsReview: number; returned: number; waiting: number }>()
    for (const p of openPrs) {
      const key = p.repo.split('/').at(-1) ?? p.repo
      if (!map.has(key)) map.set(key, { needsReview: 0, returned: 0, waiting: 0 })
      map.get(key)![p.sect]++
    }
    return Array.from(map.entries())
      .map(([repo, counts]) => ({ repo, ...counts, total: counts.needsReview + counts.returned + counts.waiting }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [openPrs])

  const ageBuckets = useMemo(() => {
    const now = Date.now()
    return AGE_DEFS.map(d => ({
      label: d.label,
      count: openPrs.filter(p => {
        const age = now - (p.createdAt || now)
        return age >= d.min && age < d.max
      }).length,
    }))
  }, [openPrs])

  const mergedByWeek = useMemo(() => inbox.mergedByWeek.map(w => ({
    ...w,
    count: mergedWindow.filter(p => p.closedAt && p.closedAt >= w.weekStart && p.closedAt < w.weekStart + WEEK).length,
  })), [inbox.mergedByWeek, mergedWindow])

  const maxWeek = Math.max(1, ...mergedByWeek.map(w => w.count))
  const maxAge = Math.max(1, ...ageBuckets.map(b => b.count))
  const maxRepo = Math.max(1, ...byRepo.map(r => r.total))
  const mergedLast7 = mergedWindow.filter(p => (p.closedAt ?? 0) >= Date.now() - 7 * DAY).length

  // --- The drill-down list ---
  const listItems = useMemo(() => {
    if (filter?.weekStart !== undefined) {
      return mergedWindow.filter(p => p.closedAt && p.closedAt >= filter.weekStart! && p.closedAt < filter.weekStart! + WEEK)
    }
    let items = openPrs
    if (filter?.section) items = items.filter(p => p.sect === filter.section)
    if (filter?.mine) items = items.filter(p => MINE.includes(p.sect))
    if (filter?.repo) items = items.filter(p => (p.repo.split('/').at(-1) ?? p.repo) === filter.repo)
    if (filter?.ageBucket) {
      const def = AGE_DEFS.find(d => d.label === filter.ageBucket)!
      const now = Date.now()
      items = items.filter(p => {
        const age = now - (p.createdAt || now)
        return age >= def.min && age < def.max
      })
    }
    if (!filter) return [...items].sort((a, b) => a.createdAt - b.createdAt).slice(0, 5) // default: oldest 5
    return [...items].sort((a, b) => a.createdAt - b.createdAt)
  }, [filter, openPrs, mergedWindow])

  const filterChips: { label: string; clear: () => void }[] = []
  if (filter?.section) filterChips.push({ label: SECT_META.find(s => s.key === filter.section)!.label, clear: () => setFilter(f => ({ ...f, section: undefined })) })
  if (filter?.mine) filterChips.push({ label: 'Opened by me', clear: () => setFilter(f => ({ ...f, mine: undefined })) })
  if (filter?.repo) filterChips.push({ label: filter.repo, clear: () => setFilter(f => ({ ...f, repo: undefined })) })
  if (filter?.ageBucket) filterChips.push({ label: `age ${filter.ageBucket}`, clear: () => setFilter(f => ({ ...f, ageBucket: undefined })) })
  if (filter?.weekStart !== undefined) filterChips.push({
    label: `merged week of ${new Date(filter.weekStart).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
    clear: () => setFilter(null),
  })
  const normalizedFilter = filterChips.length === 0 ? null : filter
  const isFiltered = filterChips.length > 0

  function toggleSection(key: SectKey) {
    setFilter(f => f?.section === key ? { ...f, section: undefined, weekStart: undefined } : { ...f, section: key, mine: undefined, weekStart: undefined })
  }

  function toggleMine() {
    setFilter(f => f?.mine ? { ...f, mine: undefined, weekStart: undefined } : { ...f, mine: true, section: undefined, weekStart: undefined })
  }

  function showTip(e: React.MouseEvent, lines: string[]) {
    const host = (e.currentTarget as Element).closest('[data-dash-root]')?.getBoundingClientRect()
    if (!host) return
    setTooltip({ x: e.clientX - host.left + 12, y: e.clientY - host.top + 12, lines })
  }

  function openPr(p: InboxPr) {
    if (p.liveId) onAttachLive(p.liveId)
    else if (p.sessionId) onSelectHistory(p.sessionId, p.cwd)
    else window.open(p.url, '_blank', 'noopener')
  }

  return (
    <div data-dash-root className="absolute inset-0 overflow-y-auto bg-gray-950">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-white font-semibold text-lg flex items-center gap-2">
              PR Dashboard
              {orgName && <span className="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 text-xs font-medium">{orgName}</span>}
            </h2>
            <p className="text-xs text-gray-600">Your GitHub workload · updated {new Date(inbox.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · click any tile or bar to drill in</p>
          </div>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded px-3 py-1.5 text-xs font-medium"
          >{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {/* KPI row — clickable */}
        <div className="flex gap-3 flex-wrap mb-6">
          {SECT_META.map(s => (
            <StatTile
              key={s.key}
              label={s.label}
              value={openPrs.filter(p => p.sect === s.key).length}
              accent={s.color}
              selected={normalizedFilter?.section === s.key}
              onClick={() => toggleSection(s.key)}
            />
          ))}
          <StatTile
            label="Opened by me"
            value={openPrs.filter(p => MINE.includes(p.sect)).length}
            selected={!!normalizedFilter?.mine}
            onClick={toggleMine}
          />
          <StatTile label="Merged · 7d" value={mergedLast7} />
        </div>

        {/* Open PRs by repo — stacked horizontal bars, segments clickable */}
        <div className="bg-gray-900 rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm text-gray-200 font-medium">Open PRs by repo</h3>
            <div className="flex items-center gap-3">
              {SECT_META.map(s => (
                <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {byRepo.map(row => (
              <div key={row.repo} className="flex items-center gap-3">
                <button
                  className={`text-xs w-44 truncate text-right flex-shrink-0 hover:text-white ${normalizedFilter?.repo === row.repo ? 'text-white font-medium' : 'text-gray-400'}`}
                  title={`Filter to ${row.repo}`}
                  onClick={() => setFilter(f => f?.repo === row.repo ? { ...f, repo: undefined, weekStart: undefined } : { ...f, repo: row.repo, weekStart: undefined })}
                >{row.repo}</button>
                <div className="flex-1 flex items-center h-4" style={{ gap: 2 }}>
                  {SECT_META.map(s => row[s.key] > 0 && (
                    <button
                      key={s.key}
                      className="h-4 rounded-[4px] hover:brightness-125"
                      style={{ width: `${(row[s.key] / maxRepo) * 100}%`, background: s.color, minWidth: 6 }}
                      onMouseMove={e => showTip(e, [`${row.repo} — ${s.label}`, `${row[s.key]} PR${row[s.key] === 1 ? '' : 's'} · click to drill in`])}
                      onMouseLeave={() => setTooltip(null)}
                      onClick={() => { setTooltip(null); setFilter({ section: s.key, repo: row.repo }) }}
                    />
                  ))}
                  <span className="text-xs text-gray-500 ml-1.5">{row.total}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* Age distribution — buckets clickable */}
          <div className="bg-gray-900 rounded-lg p-5">
            <h3 className="text-sm text-gray-200 font-medium mb-3">Age of open PRs</h3>
            <div className="flex items-end justify-between gap-2 h-32">
              {ageBuckets.map((b, i) => (
                <button key={b.label} className="flex-1 flex flex-col items-center justify-end h-full group" onClick={() => setFilter(f => f?.ageBucket === b.label ? { ...f, ageBucket: undefined } : { ...f, ageBucket: b.label, weekStart: undefined })}>
                  {b.count > 0 && <span className="text-xs text-gray-400 mb-1">{b.count}</span>}
                  <div
                    className="w-full rounded-t-[4px] group-hover:brightness-125"
                    style={{ height: `${(b.count / maxAge) * 82}%`, background: AGE_RAMP[i], minHeight: b.count > 0 ? 4 : 0 }}
                    onMouseMove={e => showTip(e, [`${b.label} old`, `${b.count} open PR${b.count === 1 ? '' : 's'} · click to drill in`])}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  <span className={`text-[10px] mt-1.5 ${normalizedFilter?.ageBucket === b.label ? 'text-white font-medium' : ''}`} style={normalizedFilter?.ageBucket === b.label ? {} : { color: C.muted }}>{b.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Merged per week — weeks clickable */}
          <div className="bg-gray-900 rounded-lg p-5">
            <h3 className="text-sm text-gray-200 font-medium mb-3">Merged per week</h3>
            <div className="flex items-end justify-between gap-2 h-32">
              {mergedByWeek.map((w, i) => {
                const isLast = i === mergedByWeek.length - 1
                const label = new Date(w.weekStart).toLocaleDateString([], { month: 'short', day: 'numeric' })
                const selected = normalizedFilter?.weekStart === w.weekStart
                return (
                  <button key={w.weekStart} className="flex-1 flex flex-col items-center justify-end h-full group" onClick={() => setFilter(f => f?.weekStart === w.weekStart ? null : { weekStart: w.weekStart })}>
                    {(w.count === maxWeek || isLast) && w.count > 0 && (
                      <span className="text-xs text-gray-400 mb-1">{w.count}</span>
                    )}
                    <div
                      className="w-full rounded-t-[4px] group-hover:brightness-125"
                      style={{ height: `${(w.count / maxWeek) * 82}%`, background: C.needsReview, opacity: selected || isLast ? 1 : 0.85, minHeight: w.count > 0 ? 4 : 0 }}
                      onMouseMove={e => showTip(e, [`Week of ${label}`, `${w.count} merged · click to drill in`])}
                      onMouseLeave={() => setTooltip(null)}
                    />
                    <span className={`text-[10px] mt-1.5 whitespace-nowrap ${selected ? 'text-white font-medium' : ''}`} style={selected ? {} : { color: C.muted }}>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Drill-down list */}
        <div className="bg-gray-900 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h3 className="text-sm text-gray-200 font-medium">
              {isFiltered ? `${listItems.length} PR${listItems.length === 1 ? '' : 's'}` : 'Oldest open PRs'}
            </h3>
            {filterChips.map(chip => (
              <button
                key={chip.label}
                onClick={chip.clear}
                className="flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-full px-2.5 py-0.5"
              >{chip.label} <span className="text-gray-500">×</span></button>
            ))}
            {isFiltered && (
              <button onClick={() => setFilter(null)} className="text-xs text-gray-600 hover:text-gray-400">clear all</button>
            )}
          </div>
          {listItems.length === 0
            ? <p className="text-xs text-gray-600">Nothing matches 🎉</p>
            : <div className="space-y-0.5">
                {listItems.map(p => {
                  const meta = 'sect' in p ? SECT_META.find(s => s.key === (p as { sect: SectKey }).sect) : null
                  const num = p.url.match(/\/pull\/(\d+)/)?.[1]
                  return (
                    <div key={p.url} className="group/row flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-800/70">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta?.color ?? '#6b21a8' }} title={meta?.label ?? 'Merged'} />
                      <button onClick={() => openPr(p)} className="text-sm text-gray-200 truncate flex-1 text-left hover:text-white" title={p.title}>
                        {p.title}
                      </button>
                      {(p.liveId || p.sessionId) && <span className="text-[10px] text-blue-500/80 flex-shrink-0">session</span>}
                      <span className="text-xs text-gray-600 flex-shrink-0 w-40 truncate text-right">{p.repo.split('/').at(-1)}#{num}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0 w-10 text-right">
                        {p.closedAt ? ageLabel(Date.now() - p.closedAt) : ageLabel(Date.now() - p.createdAt)}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
                        {!p.closedAt && (
                          <button
                            onClick={() => onReviewWithClaude(p.url)}
                            className="text-xs bg-blue-600/80 hover:bg-blue-500 text-white rounded px-2 py-0.5"
                            title="Start a Claude session that reviews this PR (cr <url>)"
                          >Review</button>
                        )}
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 hover:text-white px-1"
                          title="Open on GitHub"
                        >↗</a>
                      </div>
                    </div>
                  )
                })}
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
