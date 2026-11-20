'use client'
import { useEffect, useState } from 'react'
import type { Meeting } from '@/lib/meetingStore'
import type { Note } from '@/lib/notesStore'
import type { Pipeline } from '@/lib/pipelines'
import type { SlackWatcher } from '@/lib/slackWatchers'
import type { PrInbox } from '@/lib/ghInbox'
import type { UsageReport } from '@/lib/usageStore'
import { isRunning } from '@/lib/pipelineView'
import { withOrg } from '@/lib/activeOrg'
import type { Settings } from '@/lib/settingsStore'
import { UpdatesCard } from './UpdatesSignup'

interface LiveLite { id: string; status: string; orgId?: string | null; claudeSessionId: string | null }

// Home: what needs you right now, today's numbers, and shortcuts. Per org.
export function HomePage({ orgName, live, nameOf, meetings, notes, pipelines, watchers, inbox, usageOrg, onAttach, onOpen, onNewSession, onRecord }: {
  orgName: string
  live: LiveLite[]
  nameOf: (id: string) => string
  meetings: Meeting[]
  notes: Note[]
  pipelines: Pipeline[]
  watchers: SlackWatcher[]
  inbox: PrInbox | null
  usageOrg: { today: number; week: number } | null
  onAttach: (id: string) => void
  onOpen: (view: 'slack' | 'automations' | 'prdash' | 'meetinglib' | 'notes' | 'usagedash' | { meetingId: string }) => void
  onNewSession: () => void
  onRecord: () => void
}) {
  const [slackWaiting, setSlackWaiting] = useState<number | null>(null)
  // Greeting, dates and counts depend on the clock and live data: render in the browser only
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [askUpdates, setAskUpdates] = useState(false)
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then((s: Settings) => setAskUpdates(s.updates?.asked === false)).catch(() => {})
  }, [])
  useEffect(() => {
    fetch(withOrg('/api/slack/inbox')).then(r => r.json()).then(d => setSlackWaiting(d.error && !d.items?.length ? null : (d.items?.length ?? null))).catch(() => {})
  }, [orgName])

  if (!mounted) return <div className="absolute inset-0 bg-gray-950" />
  const waiting = live.filter(s => s.status === 'waiting')
  const thinking = live.filter(s => s.status === 'thinking')
  const suggestions = pipelines.reduce((n, p) => n + (p.suggestion ? 1 : 0) + p.prs.filter(t => t.suggestion).length, 0)
  const ready = pipelines.flatMap(p => p.prs.filter(t => t.state === 'ready'))
  const drafts = watchers.reduce((n, w) => n + w.items.filter(i => i.state === 'pending').length, 0)
  const reviewReqs = inbox?.sections.needsReview.length ?? 0
  const returned = inbox?.sections.returned.length ?? 0
  const upcoming = notes.filter(n => n.remindAt && !n.reminderDone && n.remindAt > Date.now()).sort((a, b) => a.remindAt! - b.remindAt!).slice(0, 4)
  const recentMeetings = [...meetings].sort((a, b) => b.startedAt - a.startedAt).slice(0, 4)
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const todo: { key: string; text: string; sub?: string; tone: string; go: () => void }[] = [
    ...waiting.slice(0, 6).map(s => ({ key: `w-${s.id}`, text: nameOf(s.id), sub: 'waiting for your input', tone: 'text-amber-300', go: () => onAttach(s.id) })),
    ...(returned ? [{ key: 'ret', text: `${returned} PR${returned > 1 ? 's' : ''} back with you`, sub: 'changes requested or CI failing', tone: 'text-red-300', go: () => onOpen('prdash') }] : []),
    ...(reviewReqs ? [{ key: 'rev', text: `${reviewReqs} review request${reviewReqs > 1 ? 's' : ''}`, sub: 'PRs waiting for your review', tone: 'text-amber-300', go: () => onOpen('prdash') }] : []),
    ...(ready.length ? [{ key: 'ready', text: `${ready.length} PR${ready.length > 1 ? 's' : ''} ready to merge`, sub: 'approved, CI green', tone: 'text-emerald-300', go: () => onOpen('automations') }] : []),
    ...(suggestions ? [{ key: 'sug', text: `${suggestions} automation suggestion${suggestions > 1 ? 's' : ''}`, sub: 'review and send to the session', tone: 'text-amber-300', go: () => onOpen('automations') }] : []),
    ...(drafts ? [{ key: 'drafts', text: `${drafts} Slack draft${drafts > 1 ? 's' : ''} to approve`, sub: 'from channel watchers', tone: 'text-blue-300', go: () => onOpen('automations') }] : []),
    ...(slackWaiting ? [{ key: 'slack', text: `${slackWaiting} Slack message${slackWaiting > 1 ? 's' : ''} waiting on you`, sub: 'mentions and DMs not answered', tone: 'text-blue-300', go: () => onOpen('slack') }] : []),
  ]

  const stat = (label: string, value: string | number, sub: string, go?: () => void) => (
    <button onClick={go} disabled={!go} className="text-left rounded-xl border border-gray-800 bg-gray-900/50 p-4 hover:enabled:border-gray-600 transition-colors">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-100 mt-1 tabular-nums">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </button>
  )

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">{hello}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · <span className="text-purple-300">{orgName}</span></p>
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={onNewSession} className="text-sm px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500">+ New session</button>
            <button onClick={onRecord} className="text-sm px-3 py-1.5 rounded-md border border-gray-700 hover:bg-gray-800">● Record meeting</button>
            <span className="text-xs text-gray-500 self-center hidden md:inline">⌘K to search</span>
          </div>
        </div>

        {askUpdates && <UpdatesCard onClose={() => setAskUpdates(false)} />}

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          {stat('Sessions', live.length, `${thinking.length} working · ${waiting.length} waiting`)}
          {stat('Spend today', usageOrg ? `$${usageOrg.today.toFixed(2)}` : '—', usageOrg ? `$${usageOrg.week.toFixed(0)} this week` : 'API-equivalent', () => onOpen('usagedash'))}
          {stat('Pull requests', (inbox?.sections.waiting.length ?? 0) + returned, `${returned} need you · ${inbox?.sections.mergedRecent.length ?? 0} merged this week`, () => onOpen('prdash'))}
          {stat('Automations', pipelines.filter(isRunning).length + watchers.filter(w => w.status === 'running').length, 'running', () => onOpen('automations'))}
          {stat('Slack', slackWaiting ?? '—', 'waiting on you', () => onOpen('slack'))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Needs you</p>
            {todo.length === 0
              ? <p className="text-sm text-gray-500 py-6 text-center">You&apos;re all caught up. 🎉</p>
              : <ul className="divide-y divide-gray-800/70">
                  {todo.map(t => (
                    <li key={t.key}>
                      <button onClick={t.go} className="w-full text-left py-2.5 flex items-center gap-3 hover:bg-gray-800/30 rounded px-2 -mx-2">
                        <span className={`text-sm font-medium truncate ${t.tone}`}>{t.text}</span>
                        {t.sub && <span className="text-xs text-gray-500 truncate">{t.sub}</span>}
                        <span className="ml-auto text-gray-600">→</span>
                      </button>
                    </li>
                  ))}
                </ul>}
            {thinking.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Working now</p>
                <div className="flex flex-wrap gap-1.5">
                  {thinking.slice(0, 12).map(s => (
                    <button key={s.id} onClick={() => onAttach(s.id)} className="text-xs px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 max-w-[220px] truncate">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse mr-1.5" />{nameOf(s.id)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-6">
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center mb-2"><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent meetings</p>
                <button onClick={() => onOpen('meetinglib')} className="ml-auto text-xs text-blue-400 hover:underline">All</button></div>
              {recentMeetings.length === 0 ? <p className="text-xs text-gray-500">No recordings yet.</p> : (
                <ul className="space-y-1.5">
                  {recentMeetings.map(m => (
                    <li key={m.id}><button onClick={() => onOpen({ meetingId: m.id })} className="w-full text-left flex gap-2 text-sm hover:text-white text-gray-300">
                      {m.status === 'recording' && <span className="w-2 h-2 mt-1.5 rounded-full bg-red-500 animate-pulse" />}
                      <span className="truncate">{m.title}</span>
                      <span className="ml-auto text-xs text-gray-500 flex-shrink-0">{new Date(m.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center mb-2"><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reminders</p>
                <button onClick={() => onOpen('notes')} className="ml-auto text-xs text-blue-400 hover:underline">Notes</button></div>
              {upcoming.length === 0 ? <p className="text-xs text-gray-500">No upcoming reminders.</p> : (
                <ul className="space-y-1.5">
                  {upcoming.map(n => (
                    <li key={n.id} className="flex gap-2 text-sm text-gray-300">
                      <span className="truncate">{n.text.split('\n').find(l => l.trim()) ?? 'Note'}</span>
                      <span className="ml-auto text-xs text-amber-400 flex-shrink-0">⏰ {new Date(n.remindAt!).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
