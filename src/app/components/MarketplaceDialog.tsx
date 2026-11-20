'use client'
import { useEffect, useState } from 'react'
import type { MarketplacePlugin } from '@/lib/marketplace'

// Browse plugins (skill bundles) from your Claude Code marketplaces and install them.
export function MarketplaceDialog({ onClose, onInstalled, inline = false }: { onClose: () => void; onInstalled: () => void; inline?: boolean }) {
  const [plugins, setPlugins] = useState<MarketplacePlugin[] | null>(null)
  const [q, setQ] = useState('')
  const [market, setMarket] = useState('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null)

  const load = () => fetch('/api/skills/marketplace').then(r => r.json()).then(d => setPlugins(d.plugins ?? [])).catch(() => setPlugins([]))
  useEffect(() => { load() }, [])

  async function install(p: MarketplacePlugin) {
    const id = `${p.name}@${p.marketplace}`
    setBusy(id); setMsg(null)
    const r = await fetch('/api/skills/marketplace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.name, marketplace: p.marketplace }) })
    const d = await r.json().catch(() => ({}))
    setBusy(null)
    setMsg({ id, ok: r.ok, text: r.ok ? 'Installed. New sessions will have it.' : d.error ?? 'Install failed' })
    if (r.ok) { load(); onInstalled() }
  }

  const markets = Array.from(new Set((plugins ?? []).map(p => p.marketplace))).sort()
  const s = q.toLowerCase()
  const shown = (plugins ?? []).filter(p => (market === 'all' || p.marketplace === market) && (!s || p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s)))

  return (
    <div className={inline ? 'h-full' : 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4'} onClick={inline ? undefined : onClose}>
      <div className={inline ? 'h-full flex flex-col text-white' : 'w-full max-w-2xl h-[80vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl p-5 text-white'} onClick={e => e.stopPropagation()}>
        {!inline && (
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold">Skills marketplace</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
          </div>
        )}
        <p className="text-xs text-gray-500 mb-3">Plugins from the marketplaces your Claude Code knows. A plugin can bundle skills, commands and tools, and runs as you. Install only ones you trust.</p>
        <div className="flex gap-2 mb-3">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search plugins"
            className="flex-1 bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm outline-none placeholder-gray-500" />
          <select value={market} onChange={e => setMarket(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-md px-2 text-xs">
            <option value="all">All marketplaces</option>
            {markets.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {plugins === null && <p className="text-xs text-gray-500">Loading…</p>}
          {plugins && shown.length === 0 && <p className="text-xs text-gray-500">No plugins match.</p>}
          {shown.map(p => {
            const id = `${p.name}@${p.marketplace}`
            return (
              <div key={id} className="rounded-lg border border-gray-800 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 flex-shrink-0">{p.marketplace}</span>
                  {p.category && <span className="text-[10px] text-gray-500 flex-shrink-0">{p.category}</span>}
                  <span className="ml-auto flex-shrink-0">
                    {p.installed
                      ? <span className="text-[11px] text-emerald-400">✓ Installed</span>
                      : <button onClick={() => install(p)} disabled={!!busy} className="text-xs px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40">{busy === id ? 'Installing…' : 'Install'}</button>}
                  </span>
                </div>
                {p.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description}</p>}
                {msg?.id === id && <p className={`text-xs mt-1 ${msg.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{msg.text}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
