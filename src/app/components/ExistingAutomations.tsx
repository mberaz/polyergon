'use client'
import { useEffect, useState } from 'react'
import type { ExistingLoop, ExistingHook } from '@/lib/existingAutomations'

const every = (s: number | null) => !s ? null : s < 3600 ? `every ${Math.round(s / 60)} min` : `every ${Math.round(s / 3600)} h`
const shortLabel = (l: string) => l.replace(/^com\.[^.]+\.(loop\.)?/, '')

function LoopCard({ l, onRun }: { l: ExistingLoop; onRun: () => Promise<string | null> }) {
  const [show, setShow] = useState<'none' | 'prompt' | 'log'>('none')
  const [log, setLog] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  async function openLog() {
    setShow(show === 'log' ? 'none' : 'log')
    const d = await fetch(`/api/automations/existing?log=${encodeURIComponent(l.label)}`).then(r => r.json()).catch(() => ({ log: '' }))
    setLog(d.log)
  }
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 flex flex-col">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${l.running ? 'bg-blue-400 animate-pulse' : l.lastExit ? 'bg-red-400' : 'bg-emerald-500'}`} />
        <span className="text-sm font-medium">🔁 {shortLabel(l.label)}</span>
        <span className="text-xs text-gray-500">{every(l.everySec) ?? (l.calendar ? 'on a schedule' : '')}</span>
        {l.model && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{l.model.replace(/^claude-/, '')}</span>}
      </div>
      <p className="text-xs text-gray-500 mt-1.5">
        {l.running ? <span className="text-blue-300">Running now</span> : l.lastExit ? <span className="text-red-400">Last run failed (exit {l.lastExit})</span> : 'Idle'}
        {l.lastRun && <> · last run {l.lastRun.at.slice(5, 16)}</>}
      </p>
      {l.lastRun?.output && <p className="text-xs text-gray-300 mt-2 whitespace-pre-wrap line-clamp-3 bg-gray-950/60 rounded px-2 py-1.5 font-mono">{l.lastRun.output}</p>}
      {show === 'prompt' && l.prompt && <pre className="text-[11px] text-gray-300 mt-2 whitespace-pre-wrap bg-gray-950 border border-gray-800 rounded p-2 max-h-60 overflow-y-auto">{l.prompt}</pre>}
      {show === 'log' && <pre className="text-[11px] text-gray-300 mt-2 whitespace-pre-wrap bg-gray-950 border border-gray-800 rounded p-2 max-h-60 overflow-y-auto">{log || 'Loading…'}</pre>}
      {msg && <p className="text-xs text-gray-400 mt-2">{msg}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={async () => setMsg(await onRun())} disabled={l.running} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800 disabled:opacity-40">▶ Run now</button>
        {l.prompt && <button onClick={() => setShow(show === 'prompt' ? 'none' : 'prompt')} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Prompt</button>}
        {l.logFile && <button onClick={openLog} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Log</button>}
      </div>
      <p className="text-[10px] text-gray-600 mt-2 font-mono truncate" title={l.command}>{l.label}</p>
    </div>
  )
}

// Loops and hooks that already run on this Mac, outside Polyergon.
export function ExistingAutomations({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const [data, setData] = useState<{ loops: ExistingLoop[]; hooks: ExistingHook[] } | null>(null)
  const load = () => fetch('/api/automations/existing').then(r => r.json()).then(setData).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t) }, [])
  if (!data || (!data.loops.length && !data.hooks.length)) return null

  async function run(label: string) {
    const r = await fetch('/api/automations/existing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run', label }) })
    setTimeout(load, 1500)
    return r.ok ? 'Started.' : (await r.json().catch(() => ({}))).error ?? 'Could not start'
  }

  return (
    <section>
      <button onClick={onToggle} aria-expanded={!collapsed} className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 hover:text-gray-200">
        <span className="w-3 text-gray-500">{collapsed ? '▸' : '▾'}</span>Already running on this Mac{collapsed && <span className="normal-case font-normal text-gray-500"> · {data.loops.length}</span>}
      </button>
      {!collapsed && <>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {data.loops.map(l => <LoopCard key={l.label} l={l} onRun={() => run(l.label)} />)}
      </div>
      {data.hooks.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-gray-400 cursor-pointer">Claude Code hooks ({data.hooks.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.hooks.map((h, i) => (
              <li key={i} className="text-xs text-gray-400 flex gap-2"><span className="text-gray-200 w-40 flex-shrink-0">{h.event}{h.matcher && h.matcher !== '*' ? ` (${h.matcher})` : ''}</span><span className="text-gray-500 flex-shrink-0">{h.org}</span><code className="truncate text-gray-500">{h.command}</code></li>
            ))}
          </ul>
        </details>
      )}
      </>}
    </section>
  )
}
