'use client'
import { useState } from 'react'

export interface ComboOption { id: string; label: string; hint?: string }

// Text box with a filtered dropdown (top 8 matches, ↑/↓/Enter/Esc).
// Every typed word must appear in the label; prefix matches rank first.
export function Combobox({ options, value, onChange, onPick, onEnter, placeholder, className }: {
  options: ComboOption[]
  value: string
  onChange: (text: string) => void
  onPick: (option: ComboOption) => void
  onEnter?: () => void
  placeholder?: string
  className: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const words = value.toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean)
  const matches = options
    .filter(o => words.every(w => o.label.toLowerCase().includes(w)))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(words[0] ?? '')) - Number(!b.label.toLowerCase().startsWith(words[0] ?? '')))
    .slice(0, 8)

  function pick(o: ComboOption) { onPick(o); setOpen(false) }

  return (
    <div className="relative flex-1">
      <input
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'Enter') {
            if (open && matches[active] && value.trim()) { e.preventDefault(); pick(matches[active]) }
            else onEnter?.()
          }
        }}
      />
      {open && value.trim() && matches.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-md shadow-xl overflow-hidden">
          {matches.map((o, i) => (
            <li key={o.id || o.label}
              onMouseDown={e => { e.preventDefault(); pick(o) }}
              onMouseEnter={() => setActive(i)}
              className={`px-2.5 py-1.5 text-sm cursor-pointer flex items-center gap-2 ${i === active ? 'bg-blue-600/80 text-white' : 'text-gray-200'}`}>
              <span className="truncate flex-1">{o.label}</span>
              {o.hint && <span className="text-[11px] opacity-60 flex-shrink-0">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
