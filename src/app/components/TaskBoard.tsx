'use client'
import { useCallback, useEffect, useState } from 'react'
import type { Task } from '@/lib/taskStore'
import type { LiveSessionInfo } from '@/hooks/useTerminal'
import type { Pipeline } from '@/lib/pipelines'
import { isRunning, shortPr, prSteps, DEFAULT_AUTO, stepOf } from '@/lib/pipelineView'
import type { SlackChannel } from '@/lib/slackBridge'
import { SlackChannelPicker } from './SlackChannelPicker'

type Col = 'todo' | 'running' | 'review' | 'pr' | 'merge' | 'done'
const COLS: [Col, string, string][] = [
  ['todo', 'To do', 'Not started yet'],
  ['running', 'In progress', 'A session is working on it'],
  ['review', 'Your review', 'Check the changes, then open the PR'],
  ['pr', 'PR in review', 'Reviewers and CI; fixes go back to the session'],
  ['merge', 'Ready to merge', 'Approved, green, no open threads'],
  ['done', 'Done', 'Merged or finished'],
]

// The column comes from the task's session and its Ship it pipeline, so cards move on their own.
function columnOf(t: Task, s: LiveSessionInfo | undefined, pipe: Pipeline | undefined): Col {
  if (t.done || pipe?.phase === 'done') return 'done'
  if (!t.liveId) return 'todo'
  const open = pipe?.prs.filter(x => x.state !== 'done') ?? []
  if (open.length) return open.some(x => x.state === 'ready') ? 'merge' : 'pr'
  return s?.status === 'thinking' ? 'running' : 'review'
}

export function TaskBoard({ orgId, folders, liveSessions, pipelines, demoTasks, onStart, onOpenSession, onReview, onAutomate, onAct, onDismiss }: {
  orgId: string // active org ('all' shows every org)
  folders: string[]
  liveSessions: LiveSessionInfo[]
  pipelines: Pipeline[]
  demoTasks?: Task[] // /demo only: show these instead of fetching /api/tasks
  onStart: (t: Task) => void
  onOpenSession: (liveId: string) => void
  onReview: (liveId: string) => void
  onAutomate: (liveId: string) => void // opens the full pipeline page
  onAct: (pipelineId: string, liveId: string, prUrl: string | null) => void // your click: send a pipeline suggestion
  onDismiss: (pipelineId: string, prUrl: string | null) => void
}) {
  const [fetched, setTasks] = useState<Task[]>([])
  const tasks = demoTasks ?? fetched
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [cwd, setCwd] = useState('general')
  const [worktree, setWorktree] = useState(false)
  const [ship, setShip] = useState(true)
  const [chText, setChText] = useState('')
  const [channel, setChannel] = useState<SlackChannel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<Col | null>(null)

  const load = useCallback(() => { if (demoTasks) return; fetch('/api/tasks').then(r => r.json()).then(setTasks).catch(() => {}) }, [demoTasks])
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [load])

  async function patch(id: string, body: object) {
    await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    load()
  }
  async function add() {
    const r = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, details, cwd, worktree: cwd !== 'general' && worktree, ship: cwd !== 'general' && ship, slackChannel: chText.replace(/^#/, '').trim() ? { id: channel?.id ?? '', name: chText.replace(/^#/, '').trim() } : null, orgId: orgId === 'all' ? 'default' : orgId }) })
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Could not add the task'); return }
    setTitle(''); setDetails(''); setWorktree(false); setAdding(false); setError(null); load()
  }
  async function remove(id: string) {
    await fetch(`/api/tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); load()
  }
  function drop(col: Col) {
    const t = tasks.find(x => x.id === dragId)
    setDragId(null); setOver(null)
    if (!t) return
    if (col === 'done' && !t.done) patch(t.id, { done: true })
    else if (col !== 'done' && t.done) patch(t.id, { done: false })
  }

  const shown = tasks.filter(t => orgId === 'all' || t.orgId === orgId)
  const pipeOf = (t: Task) => t.liveId ? [...pipelines].reverse().find(p => p.liveId === t.liveId) : undefined
  const input = 'w-full bg-gray-950 border border-gray-700 focus:border-blue-500 rounded-md px-2.5 py-1.5 text-sm outline-none placeholder-gray-600'

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      <header className="px-6 pt-5 pb-3 flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">Board</h1>
        <span className="text-xs text-gray-500">{shown.filter(t => !t.done).length} open · cards move on their own as sessions work</span>
      </header>
      <div className="flex-1 grid grid-flow-col auto-cols-[minmax(210px,1fr)] gap-3 px-6 pb-6 min-h-0 overflow-x-auto">
        {COLS.map(([col, label, hint]) => {
          const items = shown.filter(t => columnOf(t, liveSessions.find(s => s.id === t.liveId), pipeOf(t)) === col)
            .sort((a, b) => col === 'done' ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : a.createdAt - b.createdAt)
          return (
            <section key={col} onDragOver={e => { e.preventDefault(); setOver(col) }} onDragLeave={() => setOver(o => o === col ? null : o)} onDrop={() => drop(col)}
              className={`flex flex-col min-h-0 rounded-xl border bg-gray-900/40 transition-colors ${over === col ? 'border-blue-500/60 bg-blue-950/20' : 'border-gray-800'}`}>
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800">
                <h2 className="text-sm font-semibold" title={hint}>{label}</h2>
                <span className="text-xs text-gray-500 tabular-nums">{items.length}</span>
                {col === 'todo' && !adding && <button onClick={() => setAdding(true)} className="ml-auto text-xs px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-500">+ Task</button>}
              </div>
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                {col === 'todo' && adding && (
                  <div className="rounded-lg border border-blue-800/60 bg-gray-900 p-3 space-y-2">
                    <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Title, e.g. Add retries to webhook delivery" className={input}
                      onKeyDown={e => { if (e.key === 'Enter' && title.trim()) add(); if (e.key === 'Escape') setAdding(false) }} />
                    <textarea value={details} onChange={e => setDetails(e.target.value)} rows={3} placeholder="Details for the agent (optional)" className={input} />
                    <select value={cwd} onChange={e => setCwd(e.target.value)} className={input} title="Where the session works">
                      <option value="general">Just chat (no folder)</option>
                      {folders.map(f => <option key={f} value={f}>{f.split('/').at(-1)}  ·  {f}</option>)}
                    </select>
                    {cwd !== 'general' && (
                      <>
                        <label className="flex items-center gap-2 text-xs text-gray-300" title="New branch + separate copy of the repo, so parallel tasks don't collide">
                          <input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} /> Isolated copy (new branch + worktree)
                        </label>
                        <label className="flex items-start gap-2 text-xs text-gray-300" title="After your review: opens the PR, sends review comments and CI failures back to the session, and asks you before merging">
                          <input type="checkbox" checked={ship} onChange={e => setShip(e.target.checked)} className="mt-0.5" /> <span>Ship it when done <span className="text-gray-500">(PR, review fixes, CI fixes; you merge)</span></span>
                        </label>
                        {ship && <SlackChannelPicker value={chText} onChange={(v, c) => { setChText(v); setChannel(c) }} className={input} />}
                      </>
                    )}
                    {error && <p className="text-xs text-red-400">{error}</p>}
                    <div className="flex gap-2">
                      <button onClick={add} disabled={!title.trim()} className="text-xs px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40">Add</button>
                      <button onClick={() => { setAdding(false); setError(null) }} className="text-xs px-2 py-1 text-gray-400 hover:text-white">Cancel</button>
                    </div>
                  </div>
                )}
                {items.map(t => {
                  const s = liveSessions.find(x => x.id === t.liveId)
                  const pipe = pipeOf(t)
                  const auto = { ...DEFAULT_AUTO, ...pipe?.config.auto }
                  const prs = Array.from(new Set([...(s?.prUrl ? [s.prUrl] : []), ...(pipe?.prs.map(x => x.url) ?? [])]))
                  return (
                    <article key={t.id} draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setOver(null) }}
                      className={`group rounded-lg border bg-gray-900 p-3 cursor-grab active:cursor-grabbing ${dragId === t.id ? 'opacity-50' : ''} ${col === 'review' ? 'border-amber-800/50' : 'border-gray-800'}`}>
                      <div className="flex items-start gap-2">
                        <p className={`text-sm font-medium flex-1 ${t.done ? 'text-gray-400 line-through' : 'text-gray-100'}`}>{t.title}</p>
                        <button onClick={() => remove(t.id)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs" title="Delete task (the session, if any, keeps running)">✕</button>
                      </div>
                      {t.details && <p className="text-xs text-gray-400 mt-1 line-clamp-3 whitespace-pre-wrap">{t.details}</p>}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{t.cwd === 'general' ? 'chat' : t.cwd.split('/').at(-1)}</span>
                        {s?.worktree && <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300">⑂ {s.worktree.branch.replace(/^polyergon\//, '')}</span>}
                        {s?.status === 'thinking' && col !== 'done' && <span className="flex items-center gap-1 text-blue-300"><span className="w-2.5 h-2.5 rounded-full border-2 border-blue-300 border-t-transparent animate-spin motion-reduce:animate-none" />working</span>}
                        {col === 'review' && (s ? <span className="text-emerald-300">waiting for you</span> : <span className="text-gray-500">session closed</span>)}
                        {pipe && isRunning(pipe) && <button onClick={() => s && onAutomate(s.id)} className="text-blue-300 hover:underline" title="Open the full pipeline">⚡ Ship it</button>}
                        {!pipe?.prs.length && prs.map(u => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{shortPr(u)}</a>)}
                      </div>
                      {/* PR progress: steps, CI, open threads, and what's next */}
                      {pipe?.prs.filter(x => col === 'done' || x.state !== 'done').map(x => (
                        <div key={x.url} className="mt-2 rounded-md bg-gray-950/70 border border-gray-800 px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                            <a href={x.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{shortPr(x.url).split('/').at(-1)}</a>
                            <span className="flex items-center">
                              {prSteps(x, !!pipe.config.slackChannel).map((st, i) => (
                                <span key={st.label} className="flex items-center" title={st.label}>
                                  {i > 0 && <span className={`w-2.5 h-px ${st.done || st.current ? 'bg-blue-500/70' : 'bg-gray-700'}`} />}
                                  <span className={`w-2 h-2 rounded-full ${st.done ? 'bg-emerald-400' : st.current ? 'bg-blue-400' : 'bg-gray-700'}`} />
                                </span>
                              ))}
                            </span>
                            <span className={`ml-auto flex items-center gap-1 whitespace-nowrap ${x.view?.checks === 'failing' ? 'text-red-400' : x.view?.checks === 'passing' ? 'text-emerald-400' : x.view?.checks === 'pending' ? 'text-amber-300' : 'text-gray-500'}`}>{x.view?.checks === 'pending' && <span className="w-2.5 h-2.5 rounded-full border-2 border-amber-300 border-t-transparent animate-spin motion-reduce:animate-none" />}CI {x.view?.checks === 'pending' ? 'running' : x.view?.checks ?? '…'}</span>
                          </div>
                          {(x.view?.isDraft || !!x.view?.unresolved) && <p className="text-[11px] text-amber-300 mt-0.5">{[x.view?.isDraft && 'draft', x.view?.unresolved && `${x.view.unresolved} unresolved thread${x.view.unresolved > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</p>}
                          {x.suggestion && (x.suggestion.kind === 'merge' && !auto.merge
                            ? <div className="flex gap-1.5 mt-1.5"><button onClick={() => s && onAct(pipe.id, s.id, x.url)} className="text-xs px-2.5 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500">Merge</button><button onClick={() => onDismiss(pipe.id, x.url)} className="text-xs px-1.5 text-gray-500 hover:text-gray-200">Not yet</button></div>
                            : x.suggestion.kind !== 'merge' && x.suggestion.kind !== 'open-pr' && auto[stepOf(x.suggestion.kind)] && (x.suggestion.kind === 'review' ? x.reviewRounds : x.ciFixes) < pipe.config.maxRounds
                              ? <p className="text-[11px] text-blue-300/80 mt-1">{x.suggestion.kind === 'review' ? 'Review comments' : 'CI failure'} going to the session…</p>
                              : <div className="flex gap-1.5 mt-1.5 items-center"><span className="text-[11px] text-amber-300 flex-1">{x.suggestion.kind === 'review' ? 'Review comments' : x.suggestion.kind === 'ci' ? 'CI failing' : 'Ready'}</span><button onClick={() => s && onAct(pipe.id, s.id, x.url)} className="text-xs px-2 py-0.5 rounded-md bg-amber-600 hover:bg-amber-500">Send to session</button></div>)}
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {col === 'todo' && <button onClick={() => onStart(t)} className="text-xs px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500">Start</button>}
                        {col === 'review' && pipe?.suggestion?.kind === 'open-pr' && s && <button onClick={() => onAct(pipe.id, s.id, null)} className="text-xs px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500" title="Ask the session to commit, push and open the PR">Open PR</button>}
                        {s && <button onClick={() => onOpenSession(s.id)} className="text-xs px-2 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Open session</button>}
                        {s && col === 'review' && (s.gitRoot || prs.length > 0) && <button onClick={() => onReview(s.id)} className="text-xs px-2 py-1 rounded-md border border-emerald-800 text-emerald-300 hover:bg-emerald-950/40">± Review</button>}
                        {s && col === 'review' && !!s.gitRoot && !(pipe && isRunning(pipe)) && (s.backend ?? 'claude') === 'claude' && <button onClick={() => onAutomate(s.id)} className="text-xs px-2 py-1 rounded-md border border-gray-700 hover:bg-gray-800" title="Open the PR, get it reviewed, fix feedback and CI">⚡ Ship it</button>}
                        {s && (col === 'pr' || col === 'merge') && <button onClick={() => onReview(s.id)} className="text-xs px-2 py-1 rounded-md border border-gray-700 hover:bg-gray-800">± Diff</button>}
                        {!t.done && t.liveId && <button onClick={() => patch(t.id, { done: true })} className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-emerald-300">✓ Done</button>}
                        {t.done && <button onClick={() => patch(t.id, { done: false })} className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-gray-200">Reopen</button>}
                      </div>
                    </article>
                  )
                })}
                {!items.length && !(col === 'todo' && adding) && (
                  <p className="text-xs text-gray-600 text-center py-6">{col === 'todo' ? 'Add a task, then Start it to open a session' : col === 'done' ? 'Drag finished cards here' : hint}</p>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
