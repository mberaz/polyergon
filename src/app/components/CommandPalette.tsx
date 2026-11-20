'use client'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface PaletteItem {
  id: string
  group: string
  label: string
  hint?: string
  run: () => void
}

// ⌘K / Ctrl+K: search everything and jump to it. Every typed word must appear
// in the label or hint; at most 6 results per group.
export function CommandPalette({ items, onOpenChange }: { items: () => PaletteItem[]; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    onOpenChange?.(open)
    if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => (open ? items() : []), [open, items])
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const perGroup = new Map<string, number>()
    return all.filter(it => {
      const hay = `${it.label} ${it.hint ?? ''} ${it.group}`.toLowerCase()
      if (!words.every(w => hay.includes(w))) return false
      const n = perGroup.get(it.group) ?? 0
      if (n >= (words.length ? 6 : 4)) return false
      perGroup.set(it.group, n + 1)
      return true
    })
  }, [all, q])

  if (!open) return null
  const choose = (it: PaletteItem | undefined) => { if (!it) return; setOpen(false); it.run() }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl h-fit max-h-[70vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setActive(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search sessions, meetings, notes, skills, actions…"
          className="w-full bg-transparent px-4 py-3.5 text-base text-white outline-none border-b border-gray-800 placeholder-gray-500"
        />
        <div className="overflow-y-auto py-1">
          {results.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No results</p>}
          {results.map((it, i) => (
            <div key={`${it.group}:${it.id}`}>
              {(i === 0 || results[i - 1].group !== it.group) && (
                <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{it.group}</p>
              )}
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(it)}
                className={`w-full text-left px-4 py-2 flex items-center gap-3 ${i === active ? 'bg-blue-600/80 text-white' : 'text-gray-200'}`}
              >
                <span className="truncate flex-1 text-sm">{it.label}</span>
                {it.hint && <span className="text-[11px] opacity-60 flex-shrink-0 truncate max-w-[40%]">{it.hint}</span>}
              </button>
            </div>
          ))}
        </div>
        <p className="px-4 py-2 border-t border-gray-800 text-[11px] text-gray-500">↑ ↓ to move · Enter to open · Esc to close · ⌘K to toggle</p>
      </div>
    </div>
  )
}
