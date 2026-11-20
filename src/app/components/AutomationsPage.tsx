'use client'
import { useEffect, useState } from 'react'
import type { Pipeline } from '@/lib/pipelines'
import type { SlackWatcher, WatchItem, WatchLog } from '@/lib/slackWatchers'
import { isRunning, pipelineSummary } from '@/lib/pipelineView'
import { PrCard } from './AutomateDialog'
import { Combobox, type ComboOption } from './Combobox'
import { ExistingAutomations } from './ExistingAutomations'

function WatchCard({ it, onSend, onDismiss, onRedraft }: { it: WatchItem; onSend: (text: string) => void; onDismiss: () => void; onRedraft: () => void }) {
  const [text, setText] = useState(it.draft ?? '')
  const [editing, setEditing] = useState(false)
  const [clicked, setClicked] = useState(false) // one click = one post
  useEffect(() => { setClicked(false) }, [it.state])
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-gray-200">{it.author}</span>
        <a href={it.permalink} target="_blank" rel="noreferrer" className="ml-auto text-blue-400 hover:underline">Open in Slack</a>
      </div>
      <p dir="auto" className="text-sm text-gray-300 mt-1.5 line-clamp-4 whitespace-pre-wrap [overflow-wrap:anywhere]">{it.text}</p>
      {it.state === 'drafting' && <p className="text-xs text-gray-500 mt-2 animate-pulse">Drafting a reply…</p>}
      {it.state === 'failed' && <p className="text-xs text-red-400 mt-2">Draft failed: {it.error} <button onClick={onRedraft} className="underline">Try again</button></p>}
      {it.state === 'sent' && <p className="text-xs text-emerald-400 mt-2">✓ Answered: <span className="text-gray-400">{it.draft}</span></p>}
      {it.state === 'sending' && <p className="text-xs text-blue-300 mt-2 animate-pulse">Posting in Slack…</p>}
      {it.state === 'pending' && (
        <div className="mt-2 rounded-md bg-blue-950/40 border border-blue-900/50 p-2">
          <p className="text-[10px] font-semibold text-blue-300/80 uppercase tracking-wide mb-1">💡 Draft reply</p>
          {editing
            ? <textarea dir="auto" value={text} onChange={e => setText(e.target.value)} rows={4} className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-100 outline-none" />
            : <p dir="auto" className="text-xs text-blue-100/90 whitespace-pre-wrap">{it.draft}</p>}
          <div className="flex gap-2 mt-2">
            <button onClick={() => { setClicked(true); onSend(editing ? text : it.draft ?? '') }} disabled={clicked} className="text-xs px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">{clicked ? 'Posting…' : 'Send in thread'}</button>
            {!editing && <button onClick={() => { setText(it.draft ?? ''); setEditing(true) }} className="text-xs px-2 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Edit</button>}
            <button onClick={onRedraft} className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-white">Redraft</button>
            <button onClick={onDismiss} className="ml-auto text-xs px-2 py-1 rounded-md text-gray-500 hover:text-white">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Every automation in one place, plus a gallery to create new ones.
// Collapsible audit trail, newest first; each entry expands to the text it handled
function WatchAudit({ log }: { log: WatchLog[] }) {
  if (!log.length) return null
  const time = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <details className="mt-3 group">
      <summary className="text-xs text-gray-400 hover:text-gray-200 cursor-pointer select-none list-none">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span> Activity log ({log.length})
      </summary>
      <ol className="mt-2 border-l border-gray-800 ml-1.5 pl-3 space-y-1.5">
        {[...log].reverse().map((e, i) => (
          <li key={e.t + ':' + i} className="text-xs">
            <span className="text-gray-500 tabular-nums mr-2">{time(e.t)}</span>
            <span className="text-gray-300">{e.text}</span>
            {e.link && <a href={e.link} target="_blank" rel="noreferrer" className="ml-2 text-blue-400 hover:underline">Slack ↗</a>}
            {e.detail && (
              <details className="mt-1">
                <summary className="text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer">show text</summary>
                <p dir="auto" className="mt-1 whitespace-pre-wrap text-gray-400 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5 [overflow-wrap:anywhere]">{e.detail}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}

export function AutomationsPage({ pipelines, watchers, sessions, nameOf, onOpen, onStop, onNewWatcher, onEditWatcher, watcherCmd, showMacLoops }: {
  showMacLoops: boolean // the Mac's launchd loops run with ~/.claude (Default)
  pipelines: Pipeline[]
  watchers: SlackWatcher[]
  sessions: ComboOption[] // live sessions with a Claude conversation
  nameOf: (liveId: string) => string
  onOpen: (liveId: string) => void
  onStop: (id: string) => void
  onNewWatcher: () => void
  onEditWatcher: (w: SlackWatcher) => void
  watcherCmd: (type: string, body?: object) => void
}) {
  const [shipFor, setShipFor] = useState('')
  const sorted = [...pipelines].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || b.updatedAt - a.updatedAt)
  const liveWatchers = [...watchers].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))
  const card = 'rounded-xl border border-gray-800 bg-gray-900/50 p-4 flex flex-col gap-2'
  const running = pipelines.filter(isRunning).length + watchers.filter(w => w.status === 'running').length

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      <div className="px-6 pt-5 pb-3 flex items-baseline gap-3 flex-shrink-0">
        <h1 className="text-lg font-semibold">Automations</h1>
        <span className="text-xs text-gray-500">{running} running</span>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Create an automation</p>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            <div className={card}>
              <p className="text-sm font-medium">🚢 Ship it</p>
              <p className="text-xs text-gray-400">Watches a session&apos;s PRs: posts them for review in Slack, tracks reviewers and CI, and suggests fixes for you to send.</p>
              <Combobox options={sessions} value={shipFor} onChange={setShipFor} onPick={o => { setShipFor(''); onOpen(o.id) }} placeholder="Pick a session to start…"
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs outline-none placeholder-gray-500" />
            </div>
            <div className={card}>
              <p className="text-sm font-medium">👂 Slack channel watcher</p>
              <p className="text-xs text-gray-400">Finds new unanswered questions in a channel and drafts replies, optionally with a session&apos;s knowledge. You approve or let it answer.</p>
              <button onClick={onNewWatcher} className="mt-auto text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 w-fit">Set up</button>
            </div>
            {[
              ['📰 Daily digest', 'Every morning: your open PRs, Slack mentions and meetings in one summary.'],
              ['⏰ Review nudges', 'Pings reviewers in Slack when a PR has waited for review over a day.'],
            ].map(([t, d]) => (
              <div key={t} className={`${card} opacity-60`}>
                <p className="text-sm font-medium">{t} <span className="text-[10px] text-gray-500 font-normal">soon</span></p>
                <p className="text-xs text-gray-400">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {showMacLoops && <ExistingAutomations />}

        {liveWatchers.map(w => {
          const open = w.items.filter(i => i.state === 'pending' || i.state === 'drafting' || i.state === 'sending' || i.state === 'failed')
          const chip = 'text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400 whitespace-nowrap'
          const sources = (w.knowledge ?? '').split('\n').map(x => x.trim()).filter(Boolean)
          return (
            <section key={w.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.status === 'running' ? 'bg-emerald-400' : 'bg-gray-600'}`} title={w.status === 'running' ? 'Running' : 'Stopped'} />
                    <span className="text-sm font-semibold">Slack watcher · #{w.channel.name}</span>
                    {w.checking && <span className="text-[11px] text-blue-300 animate-pulse">checking…</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <select value={w.liveId ?? ''} onChange={e => watcherCmd('watcher-set-session', { id: w.id, liveId: e.target.value || null })}
                      title="Session whose knowledge drafts use (a copy; the session is never touched)"
                      className="text-[11px] bg-gray-900 border border-gray-700 rounded-full px-2 py-0.5 text-gray-300 max-w-[240px]">
                      <option value="">🧠 General knowledge</option>
                      {w.liveId && !sessions.some(o => o.id === w.liveId) && <option value={w.liveId}>🧠 {nameOf(w.liveId)}</option>}
                      {sessions.map(o => <option key={o.id} value={o.id}>🧠 {o.label}</option>)}
                    </select>
                    <span className={`${chip} ${w.mode === 'auto' ? 'border-amber-700/60 text-amber-300' : ''}`}>{w.mode === 'auto' ? 'Answers automatically' : 'You approve each reply'}</span>
                    <span className={chip}>Every {w.intervalMin} min</span>
                    <span className={chip} title={sources.join('\n') || 'No extra sources. Edit to add links, folders, channels or notes.'}>📚 {sources.length} source{sources.length === 1 ? '' : 's'}</span>
                    {w.instructions && <span className={chip} title={w.instructions}>📝 Rules</span>}
                  </div>
                </div>
                <span className="flex gap-2 flex-shrink-0">
                  {w.status === 'running' && <button onClick={() => watcherCmd('watcher-run', { id: w.id })} disabled={w.checking} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800 disabled:opacity-40">Check now</button>}
                  <button onClick={() => onEditWatcher(w)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Edit</button>
                  {w.status === 'running' && <button onClick={() => watcherCmd('watcher-stop', { id: w.id })} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-red-400 hover:bg-red-950/40">Stop</button>}
                </span>
              </div>
              <div className="mt-3">
              {open.length
                ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
                    {open.map(it => <WatchCard key={it.permalink} it={it}
                      onSend={text => watcherCmd('watcher-send', { id: w.id, permalink: it.permalink, text })}
                      onDismiss={() => watcherCmd('watcher-dismiss', { id: w.id, permalink: it.permalink })}
                      onRedraft={() => watcherCmd('watcher-redraft', { id: w.id, permalink: it.permalink })} />)}
                  </div>
                : <p className="text-xs text-gray-500">Nothing waiting on you. Last: {w.log.at(-1)?.text ?? 'no checks yet'}</p>}
              </div>
              <WatchAudit log={w.log} />
            </section>
          )
        })}

        {sorted.map(p => (
          <section key={p.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-2 h-2 rounded-full ${isRunning(p) ? 'bg-blue-400 animate-pulse' : 'bg-gray-600'}`} />
              <button onClick={() => onOpen(p.liveId)} className="text-sm font-medium hover:underline truncate">🚢 {nameOf(p.liveId)}</button>
              <span className="text-xs text-gray-500 truncate">{pipelineSummary(p)}</span>
              <span className="ml-auto flex gap-2 flex-shrink-0">
                <button onClick={() => onOpen(p.liveId)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Open</button>
                {isRunning(p) && <button onClick={() => onStop(p.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-red-400 hover:bg-red-950/40">Stop</button>}
              </span>
            </div>
            {p.prs.length > 0
              ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))' }}>{p.prs.map(t => <PrCard key={t.url} t={t} slackSet={!!p.config.slackChannel} max={p.config.maxRounds} />)}</div>
              : <p className="text-xs text-gray-500">{p.log.at(-1)?.text}</p>}
          </section>
        ))}
      </div>
    </div>
  )
}
