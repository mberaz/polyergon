'use client'
import { useState, useEffect } from 'react'
import type { LibraryEntry, MeetingStatus } from '@/lib/meetingStore'
import type { Org } from '@/lib/orgRegistry'
import { SendToSlackDialog } from './SendToSlackDialog'

interface Props {
  orgs: Org[]
  activeOrgId: string
  refreshKey: string // changes when the meeting list changes, to refetch
  onOpen: (id: string) => void
  onDeleted: () => void
}

function when(ms: number): string {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' })
}

function lengthMs(m: LibraryEntry): number {
  return m.endedAt ? m.endedAt - m.startedAt : 0
}

function fmtLength(ms: number): string {
  if (!ms) return '—'
  const min = Math.max(1, Math.round(ms / 60000))
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`
}

function mb(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

// Wraps every query word in the text with <mark>.
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <>{text.split(re).map((part, i) => i % 2 ? <mark key={i} className="bg-amber-400/25 text-amber-100 rounded-sm px-0.5">{part}</mark> : part)}</>
}

const STATUS_STYLE: Record<MeetingStatus, string> = {
  recording: 'bg-red-500/15 text-red-300 ring-red-500/30',
  ended: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
  interrupted: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
}

const RANGES = [['all', 'Any time'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']] as const
type SortKey = 'when' | 'length'

export function MeetingsLibrary({ orgs, activeOrgId, refreshKey, onOpen, onDeleted }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'all' | MeetingStatus>('all')
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('all')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'when', desc: true })
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [slackFor, setSlackFor] = useState<LibraryEntry | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setSearching(true)
    fetch(`/api/meetings/library?q=${encodeURIComponent(debounced)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setEntries(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [debounced, refreshKey, reload])

  async function remove(id: string) {
    setConfirmId(null)
    const r = await fetch(`/api/meetings/${id}`, { method: 'DELETE' })
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Could not delete'); return }
    setError(null)
    setReload(n => n + 1)
    onDeleted()
  }

  const words = debounced.toLowerCase().split(/\s+/).filter(Boolean)
  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86400000
  const shown = (entries ?? [])
    .filter(m =>
      (activeOrgId === 'all' || (m.orgId ?? 'default') === activeOrgId) &&
      (status === 'all' || m.status === status) &&
      m.startedAt >= since)
    .sort((a, b) => {
      const d = sort.key === 'when' ? a.startedAt - b.startedAt : lengthMs(a) - lengthMs(b)
      return sort.desc ? -d : d
    })

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs transition-colors ${active ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'}`
  const th = 'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap'
  const sortHeader = (key: SortKey, label: string, align = '') => (
    <th className={`${th} ${align}`}>
      <button onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : true }))} className="hover:text-gray-300 uppercase tracking-wider">
        {label}{sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
      </button>
    </th>
  )

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      {slackFor && <SendToSlackDialog meetingId={slackFor.id} title={slackFor.title} onClose={() => setSlackFor(null)} />}
      <div className="px-6 pt-5 pb-4 flex flex-col gap-3 flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Recordings</h1>
          <span className="text-xs text-gray-500">{entries ? `${shown.length} of ${entries.length}` : 'Loading…'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <span className="absolute left-3 top-2 text-gray-500 text-sm">⌕</span>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search titles, summaries, notes and transcripts"
              className="w-full bg-gray-900 border border-gray-800 focus:border-gray-600 rounded-lg pl-8 pr-24 py-2 text-sm outline-none placeholder-gray-600"
            />
            {searching && <span className="absolute right-3 top-2.5 text-xs text-gray-500">searching…</span>}
          </div>
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5">
            {(['all', 'ended', 'interrupted', 'recording'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} className={chip(status === s)}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5">
            {RANGES.map(([v, label]) => (
              <button key={v} onClick={() => setRange(v)} className={chip(range === v)}>{label}</button>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-900 z-10 border-b border-gray-800">
              <tr className="text-left">
                {sortHeader('when', 'When')}
                <th className={th}>Meeting</th>
                {sortHeader('length', 'Length', 'text-right')}
                <th className={`${th} text-right`}>Decisions</th>
                <th className={`${th} text-right`}>Action items</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {shown.map(m => {
                const org = m.orgId !== 'default' ? orgs.find(o => o.id === m.orgId)?.name : null
                return (
                  <tr key={m.id} onClick={() => onOpen(m.id)} className="border-b border-gray-800/70 last:border-0 hover:bg-gray-800/40 cursor-pointer group">
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap align-top tabular-nums">{when(m.startedAt)}</td>
                    <td className="px-4 py-3 align-top max-w-0 w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        {m.status === 'recording' && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                        <span className="font-medium text-gray-100 truncate"><Highlight text={m.title} words={words} /></span>
                        {org && <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 text-[10px] font-medium flex-shrink-0">{org}</span>}
                      </div>
                      {m.match
                        ? <p className="text-xs text-gray-400 mt-1 truncate"><Highlight text={m.match} words={words} /></p>
                        : m.snippet && <p className="text-xs text-gray-500 mt-1 truncate">{m.snippet}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap align-top tabular-nums" title={`Audio: ${m.audio.chunks} chunks · ${mb(m.audio.bytes)}`}>{fmtLength(lengthMs(m))}</td>
                    <td className="px-4 py-3 text-right text-gray-300 align-top tabular-nums">{m.counts.decisions || <span className="text-gray-600">—</span>}</td>
                    <td className="px-4 py-3 text-right text-gray-300 align-top tabular-nums">{m.counts.actionItems || <span className="text-gray-600">—</span>}</td>
                    <td className="px-4 py-3 align-top">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset capitalize ${STATUS_STYLE[m.status]}`}>{m.status}</span>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                      {confirmId === m.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Delete?</span>
                          <button onClick={() => remove(m.id)} className="text-xs px-2 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white">Delete</button>
                          <button onClick={() => setConfirmId(null)} className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-white">Cancel</button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          <button onClick={() => onOpen(m.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800">Open</button>
                          <button onClick={() => setSlackFor(m)} disabled={!m.snippet} title={m.snippet ? 'Send the summary to a Slack channel' : 'No summary yet'}
                            className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent">Slack</button>
                          <button
                            onClick={() => setConfirmId(m.id)} disabled={m.status === 'recording'}
                            className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-red-400 hover:bg-red-950/40 disabled:opacity-30 disabled:hover:bg-transparent"
                          >Delete</button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {entries && shown.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-16">{debounced ? `No recordings match “${debounced}”` : 'No recordings for these filters'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
