'use client'
import { useEffect, useState } from 'react'
import type { SlackMention } from '@/lib/slackBridge'

function ago(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const m = Math.round((Date.now() - t) / 60000)
  return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}

const REACTIONS: [string, string][] = [['thumbsup', '👍'], ['eyes', '👀'], ['white_check_mark', '✅'], ['pray', '🙏'], ['heart', '❤️'], ['joy', '😂'], ['raised_hands', '🙌'], ['fire', '🔥']]

const COLORS = ['bg-rose-600', 'bg-amber-600', 'bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-pink-600', 'bg-teal-600']
const colorFor = (name: string) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]

function Card({ m, onGone, onAgent }: { m: SlackMention; onGone: () => void; onAgent: (m: SlackMention) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'draft' | 'send' | 'done' | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [picker, setPicker] = useState(false)
  const [reacted, setReacted] = useState<string[]>([])

  async function act(action: 'draft' | 'reply' | 'done' | 'react', extra: object = {}) {
    setBusy(action === 'reply' ? 'send' : action === 'react' ? null : action); setError('')
    const r = await fetch('/api/slack/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, permalink: m.permalink, ...extra }) })
    const d = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) { setError(d.error ?? 'Failed'); return null }
    return d
  }

  return (
    <div className={`relative rounded-xl border border-gray-800 bg-gray-900/60 p-4 flex flex-col transition-opacity ${m.checked === false ? 'opacity-80' : ''}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {m.checked === false && <span className="absolute top-3 right-3 text-[10px] text-gray-500 animate-pulse">checking…</span>}
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ${colorFor(m.author)}`}>{(m.author || '?')[0].toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-100 truncate">{m.author}</p>
          <p className="text-[11px] text-gray-500 truncate">{m.isDm ? 'Direct message' : `#${m.channel}`} · {ago(m.time)}</p>
        </div>
        {m.checked !== false && <a href={m.permalink} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 hover:underline flex-shrink-0">Open in Slack</a>}
      </div>
      <p dir="auto" onClick={() => setExpanded(e => !e)} className={`text-sm text-gray-300 mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed cursor-pointer ${expanded ? '' : 'line-clamp-5'}`}>{m.text}</p>

      {open && (
        <div className="mt-3 space-y-2">
          <textarea dir="auto" value={text} onChange={e => setText(e.target.value)} rows={4} autoFocus placeholder="Write a reply…"
            className="w-full bg-gray-950 border border-gray-800 focus:border-gray-600 rounded-md px-2.5 py-2 text-sm text-gray-100 outline-none resize-y placeholder-gray-600" />
          <div className="flex gap-2">
            <button onClick={async () => { const d = await act('draft'); if (d?.text) setText(d.text) }} disabled={!!busy}
              className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800 disabled:opacity-40">{busy === 'draft' ? 'Drafting…' : '✨ Draft with Claude'}</button>
            <button onClick={async () => { if (await act('reply', { text })) onGone() }} disabled={!!busy || !text.trim()}
              className="ml-auto text-xs px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">{busy === 'send' ? 'Sending…' : 'Send in thread'}</button>
          </div>
        </div>
      )}

      {reacted.length > 0 && <p className="text-xs text-gray-400 mt-2">You reacted {reacted.join(' ')}</p>}
      {picker && (
        <div className="flex gap-1 mt-2 bg-gray-950 border border-gray-800 rounded-lg p-1 w-fit">
          {REACTIONS.map(([name, glyph]) => (
            <button key={name} title={`:${name}:`} onClick={async () => { setPicker(false); setReacted(r => [...r, glyph]); if (!(await act('react', { emoji: name }))) setReacted(r => r.filter(g => g !== glyph)) }}
              className="w-8 h-8 rounded-md text-lg hover:bg-gray-800">{glyph}</button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      <div className="flex items-center gap-1.5 pt-3 whitespace-nowrap">
        {!open && <button onClick={() => setOpen(true)} className="text-xs px-3 h-7 rounded-md bg-blue-600 hover:bg-blue-500 text-white">Reply</button>}
        <button onClick={() => setPicker(p => !p)} className="text-sm w-8 h-7 rounded-md border border-gray-700 hover:bg-gray-800 flex items-center justify-center disabled:opacity-40" title="React with an emoji">🙂</button>
        <button onClick={() => onAgent(m)} className="text-sm w-8 h-7 rounded-md border border-gray-700 hover:bg-gray-800 flex items-center justify-center disabled:opacity-40" title="Send an agent: a Claude session reads the thread, looks into it and drafts a reply for you">🤖</button>
        <button onClick={async () => { if (await act('done', { react: true })) onGone() }} disabled={!!busy}
          className="text-sm w-8 h-7 rounded-md border border-gray-700 hover:bg-gray-800 flex items-center justify-center disabled:opacity-40 ml-auto" title="Done: adds a ✅ reaction in Slack and hides it here">{busy === 'done' ? '…' : '✅'}</button>
        <button onClick={async () => { if (await act('done', { react: false })) onGone() }} disabled={!!busy}
          className="text-xs w-7 h-7 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800" title="Hide here only; nothing is posted to Slack">✕</button>
      </div>
    </div>
  )
}

// Slack messages that tag you and are still open, as cards.
export function SlackInbox({ onSendAgent }: { onSendAgent: (m: SlackMention) => void }) {
  const [data, setData] = useState<{ items: SlackMention[]; fetchedAt: number; refreshing: boolean; stage: 'idle' | 'searching' | 'checking'; startedAt: number; error: string | null } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'dm' | 'channels'>('all')

  const load = (refresh = false) => fetch(`/api/slack/inbox${refresh ? '?refresh=1' : ''}`).then(r => r.json()).then(setData).catch(() => {})
  useEffect(() => {
    fetch('/api/slack/inbox').then(r => r.json()).then(d => { setData(d); if (!d.fetchedAt || Date.now() - d.fetchedAt > 15 * 60_000) load(true) }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // While a refresh runs on the server, check back every 3s and tick the timer
  useEffect(() => {
    if (!data?.refreshing) return
    const poll = setInterval(() => load(), 3000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [data?.refreshing]) // eslint-disable-line react-hooks/exhaustive-deps
  const secs = data?.refreshing ? Math.max(0, Math.round((now - data.startedAt) / 1000)) : 0

  const items = (data?.items ?? []).filter(m => !hidden.has(m.permalink) && (filter === 'all' || (filter === 'dm') === m.isDm))
  const chip = (on: boolean) => `px-2.5 py-1 rounded-md text-xs ${on ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      <div className="px-6 pt-5 pb-4 flex flex-wrap items-center gap-3 flex-shrink-0">
        <h1 className="text-lg font-semibold">Slack</h1>
        <span className="text-xs text-gray-500">{data ? `${items.length} waiting on you` : 'Loading…'}</span>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5">
          <button onClick={() => setFilter('all')} className={chip(filter === 'all')}>All</button>
          <button onClick={() => setFilter('channels')} className={chip(filter === 'channels')}>Mentions</button>
          <button onClick={() => setFilter('dm')} className={chip(filter === 'dm')}>DMs</button>
        </div>
        <span className="ml-auto text-[11px] text-gray-500">
          {!data?.refreshing && data?.fetchedAt ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <button onClick={() => load(true)} disabled={data?.refreshing} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800 disabled:opacity-40">↻ Refresh</button>
      </div>

      {data?.refreshing && (
        <div className="mx-6 mb-4 rounded-lg border border-blue-900/60 bg-blue-950/30 px-4 py-2.5 flex items-center gap-4 text-xs flex-shrink-0">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          <span className={data.stage === 'searching' ? 'text-blue-200 font-medium' : 'text-gray-500'}>{data.stage === 'searching' ? '1. Finding your mentions and DMs…' : '✓ Found your mentions and DMs'}</span>
          <span className={data.stage === 'checking' ? 'text-blue-200 font-medium' : 'text-gray-600'}>2. Checking which you already answered{data.stage === 'checking' ? '…' : ''}</span>
          <span className="ml-auto text-gray-500 tabular-nums">{secs}s</span>
        </div>
      )}
      {data?.error && !data.refreshing && (
        <div className="mx-6 mb-4 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-2.5 flex items-center gap-3 text-xs text-red-300 flex-shrink-0">
          <span className="flex-1">Couldn&apos;t read Slack: {data.error}</span>
          <button onClick={() => load(true)} className="px-2.5 py-1 rounded-md border border-red-800 hover:bg-red-900/40">Retry</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {data && !data.refreshing && items.length === 0 && (
          <p className="text-sm text-gray-500 text-center mt-20">{data.fetchedAt ? 'Nothing waiting on you. 🎉' : 'Click Refresh to check Slack.'}</p>
        )}
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {data?.refreshing && items.length === 0 && Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 animate-pulse">
              <div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-full bg-gray-800" /><span className="h-3 w-32 rounded bg-gray-800" /></div>
              <div className="mt-4 space-y-2"><div className="h-2.5 rounded bg-gray-800" /><div className="h-2.5 rounded bg-gray-800 w-5/6" /><div className="h-2.5 rounded bg-gray-800 w-2/3" /></div>
            </div>
          ))}
          {items.map(m => <Card key={m.permalink} m={m} onGone={() => setHidden(h => new Set(h).add(m.permalink))} onAgent={onSendAgent} />)}
        </div>
      </div>
    </div>
  )
}
