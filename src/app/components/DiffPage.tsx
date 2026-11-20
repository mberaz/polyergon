'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile, DiffLine, DiffResult } from '@/lib/diffReview'

interface Comment { path: string; line: string; code: string; text: string }
const keyOf = (path: string, l: DiffLine) => `${path}:${l.newNo != null ? l.newNo : `-${l.oldNo}`}`
const STATUS: Record<DiffFile['status'], [string, string]> = {
  added: ['A', 'text-emerald-400'], deleted: ['D', 'text-red-400'], modified: ['M', 'text-amber-300'], renamed: ['R', 'text-blue-300'],
}

// Review what a session changed, comment on lines, then send it all back in one message.
export function DiffPage({ sessionName, liveId, hasRepo, prUrls, onSend, onOpenSession }: {
  sessionName: string
  liveId: string
  hasRepo: boolean // session folder is a git repo: offer its local changes
  prUrls: string[] // the session's PRs: offer each PR's diff
  onSend: (text: string) => void
  onOpenSession: () => void
}) {
  const [data, setData] = useState<DiffResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [comments, setComments] = useState<Record<string, Comment>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [general, setGeneral] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sent, setSent] = useState<'feedback' | 'approve' | null>(null)
  const refs = useRef<Record<string, HTMLElement | null>>({})
  // What to review: 'local' (the session folder) or a PR url
  const [source, setSource] = useState<string>(hasRepo || !prUrls.length ? 'local' : prUrls[0])

  useEffect(() => {
    setLoading(true)
    fetch(source === 'local' ? `/api/diff?id=${encodeURIComponent(liveId)}` : `/api/diff?pr=${encodeURIComponent(source)}`).then(r => r.json()).then(d => {
      if (d.error) { setError(d.error); setData(null) } else { setData(d); setError(null); setCollapsed(new Set(d.files.filter((f: DiffFile) => f.lines.length > 600).map((f: DiffFile) => f.path))) }
    }).catch(() => setError('Could not load the changes')).finally(() => setLoading(false))
  }, [liveId, source, reload])

  const totals = useMemo(() => (data?.files ?? []).reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }), [data])
  const list = Object.values(comments)

  function saveComment(k: string, path: string, l: DiffLine) {
    if (draft.trim()) setComments(c => ({ ...c, [k]: { path, line: l.newNo != null ? String(l.newNo) : `old ${l.oldNo}`, code: l.text.trim().slice(0, 120), text: draft.trim() } }))
    setEditing(null); setDraft('')
  }

  function sendFeedback() {
    const items = list.map((c, i) => `${i + 1}. ${c.path}:${c.line}${c.code ? ` (\`${c.code}\`)` : ''}\n   ${c.text.replace(/\n/g, '\n   ')}`)
    const where = source === 'local' ? (data ? ` (branch ${data.branch})` : '') : ` in ${source}`
    const text = `Review feedback on your changes${where}:\n\n${items.join('\n')}${general.trim() ? `\n\nOverall: ${general.trim()}` : ''}\n\nPlease address each point, then tell me what you changed.`
    onSend(text); setSent('feedback'); setComments({}); setGeneral('')
  }
  function approve() {
    onSend(source === 'local'
      ? `I reviewed your changes${data ? ` on ${data.branch}` : ''} and they look good.${general.trim() ? ` ${general.trim()}` : ''} Commit anything uncommitted with a clear message and push the branch.`
      : `I reviewed ${source} and it looks good.${general.trim() ? ` ${general.trim()}` : ''} Make sure everything is pushed.`)
    setSent('approve'); setGeneral('')
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-gray-800 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-gray-500">Review changes</p>
          <h1 className="text-lg font-semibold truncate">{sessionName}</h1>
          {data && <p className="text-xs text-gray-400 mt-0.5"><span className="font-mono text-gray-300">{data.branch}</span> vs {data.baseLabel} · {data.files.length} file{data.files.length === 1 ? '' : 's'} · <span className="text-emerald-400">+{totals.add}</span> <span className="text-red-400">−{totals.del}</span></p>}
        </div>
        {(hasRepo ? 1 : 0) + prUrls.length > 1 && (
          <select value={source} onChange={e => { setSource(e.target.value); setComments({}); setSent(null) }}
            className="text-sm bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5" title="What to review">
            {hasRepo && <option value="local">Local changes</option>}
            {prUrls.map(u => <option key={u} value={u}>PR {u.replace('https://github.com/', '').replace('/pull/', '#')}</option>)}
          </select>
        )}
        <button onClick={() => setReload(n => n + 1)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800">Refresh</button>
        <button onClick={onOpenSession} className="text-sm px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800">Open session</button>
      </header>

      {loading && !data ? <p className="p-8 text-sm text-gray-500 animate-pulse">Reading the changes…</p>
        : error ? <p className="p-8 text-sm text-amber-300">{error}</p>
        : data && !data.files.length ? <p className="p-8 text-sm text-gray-400">No changes yet since {data.baseLabel}.</p>
        : data && (
        <div className="flex-1 flex min-h-0">
          <nav className="w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto py-2 hidden md:block">
            {data.files.map(f => (
              <button key={f.path} onClick={() => refs.current[f.path]?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-900 flex items-center gap-2 min-w-0" title={f.path}>
                <span className={`font-mono w-3 ${STATUS[f.status][1]}`}>{STATUS[f.status][0]}</span>
                <span className="truncate flex-1 text-gray-300" dir="rtl">{f.path}</span>
                {list.some(c => c.path === f.path) && <span className="text-amber-300">●</span>}
                <span className="text-emerald-400/80 tabular-nums">+{f.additions}</span><span className="text-red-400/80 tabular-nums">−{f.deletions}</span>
              </button>
            ))}
            {data.truncated && <p className="px-3 py-2 text-[11px] text-amber-300/80">Very large diff: only the first part is shown.</p>}
          </nav>

          <main className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
            {data.files.map(f => (
              <section key={f.path} ref={el => { refs.current[f.path] = el }} className="rounded-xl border border-gray-800 overflow-hidden">
                <button onClick={() => setCollapsed(c => { const n = new Set(c); n.has(f.path) ? n.delete(f.path) : n.add(f.path); return n })}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800 text-left sticky top-0 z-10">
                  <span className="text-gray-500 text-xs">{collapsed.has(f.path) ? '▸' : '▾'}</span>
                  <span className="font-mono text-xs text-gray-200 truncate flex-1">{f.path}</span>
                  <span className="text-[11px] text-emerald-400">+{f.additions}</span><span className="text-[11px] text-red-400">−{f.deletions}</span>
                </button>
                {!collapsed.has(f.path) && (f.binary ? <p className="px-4 py-3 text-xs text-gray-500">Binary or large file, not shown.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono border-collapse">
                      <tbody>
                        {f.lines.map((l, i) => {
                          if (l.kind === 'hunk') return <tr key={i}><td colSpan={3} className="px-3 py-1 bg-blue-950/30 text-blue-300/70">{l.text}</td></tr>
                          const k = keyOf(f.path, l), c = comments[k]
                          const bg = l.kind === 'add' ? 'bg-emerald-950/40' : l.kind === 'del' ? 'bg-red-950/40' : ''
                          return [
                            <tr key={i} className={`group ${bg}`}>
                              <td className="w-10 text-right pr-2 text-gray-600 select-none align-top">{l.oldNo ?? ''}</td>
                              <td className="w-10 text-right pr-2 text-gray-600 select-none align-top relative">
                                <button onClick={() => { setEditing(k); setDraft(c?.text ?? '') }} title="Comment on this line"
                                  className="absolute -left-1 top-0 w-4 h-4 rounded bg-blue-600 text-white leading-4 text-[11px] opacity-0 group-hover:opacity-100">+</button>
                                {l.newNo ?? ''}
                              </td>
                              <td className={`pl-2 pr-4 whitespace-pre ${l.kind === 'add' ? 'text-emerald-100' : l.kind === 'del' ? 'text-red-100' : 'text-gray-300'}`}><span className="select-none text-gray-600 mr-1">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</span>{l.text}</td>
                            </tr>,
                            (editing === k || c) && (
                              <tr key={`${i}c`}><td colSpan={3} className="px-3 py-2 bg-gray-900 border-y border-gray-800 font-sans">
                                {editing === k ? (
                                  <div className="max-w-2xl space-y-2">
                                    <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder="What should change here?"
                                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveComment(k, f.path, l); if (e.key === 'Escape') setEditing(null) }}
                                      className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 rounded-md px-2.5 py-2 text-sm outline-none" />
                                    <div className="flex gap-2">
                                      <button onClick={() => saveComment(k, f.path, l)} className="text-xs px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500">Add comment</button>
                                      <button onClick={() => setEditing(null)} className="text-xs px-2 py-1 text-gray-400 hover:text-white">Cancel</button>
                                      <span className="text-[11px] text-gray-500 self-center">⌘↵ to add</span>
                                    </div>
                                  </div>
                                ) : c && (
                                  <div className="flex items-start gap-2 max-w-2xl rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2">
                                    <p className="text-sm text-amber-100 whitespace-pre-wrap flex-1">{c.text}</p>
                                    <button onClick={() => { setEditing(k); setDraft(c.text) }} className="text-xs text-gray-400 hover:text-white">Edit</button>
                                    <button onClick={() => setComments(cs => { const n = { ...cs }; delete n[k]; return n })} className="text-xs text-gray-400 hover:text-red-300">Delete</button>
                                  </div>
                                )}
                              </td></tr>
                            ),
                          ]
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </section>
            ))}
          </main>
        </div>
      )}

      {data && data.files.length > 0 && (
        <footer className="border-t border-gray-800 px-6 py-3 flex items-center gap-3 flex-wrap bg-gray-950">
          <input value={general} onChange={e => setGeneral(e.target.value)} placeholder="Overall comment (optional)"
            className="flex-1 min-w-[240px] bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm outline-none" />
          {sent && <span className="text-xs text-emerald-400">{sent === 'approve' ? 'Approval sent to the session' : 'Feedback sent to the session'}</span>}
          <button onClick={sendFeedback} disabled={!list.length && !general.trim()}
            title="Sends your line comments to the session as one message (when it's idle)"
            className="text-sm px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 font-medium whitespace-nowrap">Send feedback{list.length ? ` (${list.length})` : ''}</button>
          <button onClick={approve} title="Tells the session the changes look good: commit and push"
            className="text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium whitespace-nowrap">Approve</button>
        </footer>
      )}
    </div>
  )
}
