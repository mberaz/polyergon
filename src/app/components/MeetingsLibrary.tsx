'use client'
import { useState, useEffect } from 'react'
import type { LibraryEntry, MeetingStatus } from '@/lib/meetingStore'
import type { Org } from '@/lib/orgRegistry'

interface Props {
  orgs: Org[]
  activeOrgId: string
  refreshKey: string // changes when the meeting list changes, to refetch
  onOpen: (id: string) => void
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
function relative(ms: number): string {
  const diff = (ms - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]]
  let v = diff
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit)
    v /= size
  }
  return ''
}

function duration(m: LibraryEntry): string {
  if (!m.endedAt) return '—'
  const min = Math.max(1, Math.round((m.endedAt - m.startedAt) / 60000))
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
}

function mb(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`
}

// Wraps every query word in the text with <mark>.
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <>{text.split(re).map((part, i) => i % 2 ? <mark key={i} className="bg-amber-500/30 text-amber-100 rounded px-0.5">{part}</mark> : part)}</>
}

const STATUS_STYLE: Record<MeetingStatus, string> = {
  recording: 'bg-red-900/50 text-red-300',
  ended: 'bg-green-900/40 text-green-300',
  interrupted: 'bg-yellow-900/40 text-yellow-300',
}

const RANGES = [['all', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']] as const

export function MeetingsLibrary({ orgs, activeOrgId, refreshKey, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'all' | MeetingStatus>('all')
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('all')
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [searching, setSearching] = useState(false)

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
  }, [debounced, refreshKey])

  const words = debounced.toLowerCase().split(/\s+/).filter(Boolean)
  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86400000
  const shown = (entries ?? []).filter(m =>
    (activeOrgId === 'all' || (m.orgId ?? 'default') === activeOrgId) &&
    (status === 'all' || m.status === status) &&
    m.startedAt >= since)

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? 'bg-gray-700 border-gray-500 text-gray-100' : 'border-gray-800 text-gray-400 hover:border-gray-600'}`

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      <div className="px-6 pt-5 pb-3 border-b border-gray-800 flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Recordings</h1>
          <span className="text-xs text-gray-500">{entries ? `${shown.length} of ${entries.length}` : 'Loading…'}</span>
        </div>
        <div className="relative">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search titles, summaries, notes and transcripts…"
            className="w-full bg-gray-900 border border-gray-800 focus:border-gray-600 rounded-lg px-3 py-2 text-sm outline-none placeholder-gray-600"
          />
          {searching && <span className="absolute right-3 top-2.5 text-xs text-gray-500">searching…</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', 'ended', 'interrupted', 'recording'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={chip(status === s)}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</button>
          ))}
          <span className="w-px bg-gray-800 mx-1" />
          {RANGES.map(([v, label]) => (
            <button key={v} onClick={() => setRange(v)} className={chip(range === v)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries && shown.length === 0 && (
          <p className="text-sm text-gray-500 text-center mt-16">{debounced ? `No recordings match “${debounced}”` : 'No recordings for these filters'}</p>
        )}
        <ul className="divide-y divide-gray-800/70">
          {shown.map(m => {
            const org = m.orgId !== 'default' ? orgs.find(o => o.id === m.orgId)?.name : null
            return (
              <li key={m.id}>
                <button onClick={() => onOpen(m.id)} className="w-full text-left px-6 py-3.5 hover:bg-gray-900 transition-colors flex gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {m.status === 'recording' && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                      <span className="text-sm font-medium truncate"><Highlight text={m.title} words={words} /></span>
                      {org && <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 text-[10px] font-medium flex-shrink-0">{org}</span>}
                    </div>
                    {m.snippet && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{m.snippet}</p>}
                    {m.match && <p className="text-xs text-gray-500 mt-1 italic line-clamp-2"><Highlight text={m.match} words={words} /></p>}
                    <div className="flex gap-3 mt-1.5 text-[11px] text-gray-500">
                      {m.counts.topics > 0 && <span>📝 {m.counts.topics} topics</span>}
                      {m.counts.decisions > 0 && <span>✓ {m.counts.decisions} decisions</span>}
                      {m.counts.actionItems > 0 && <span>▸ {m.counts.actionItems} action items</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 text-xs text-gray-400">
                    <span title={new Date(m.startedAt).toLocaleString()}>{relative(m.startedAt)}</span>
                    <span className="text-gray-500">{duration(m)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLE[m.status]}`}>{m.status}</span>
                      <span className="text-gray-600 cursor-help" title={`Audio: ${m.audio.chunks} chunks · ${mb(m.audio.bytes)}`}>ⓘ</span>
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
