'use client'
import { useEffect, useState } from 'react'
import type { SkillInfo } from '@/lib/skillsReader'
import { Markdown } from './Markdown'
import { SkillDialog } from './SkillDialog'
import { MarketplaceDialog } from './MarketplaceDialog'

// Full-page Skills: installed list + detail/editor, and the marketplace.
export function SkillsPage({ selected, onSelect, onChanged }: { selected: string | null; onSelect: (name: string | null) => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'installed' | 'marketplace'>('installed')
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'user' | 'plugin'>('all')
  const [detail, setDetail] = useState<{ skill: SkillInfo; raw: string } | null>(null)
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('view')
  const [reload, setReload] = useState(0)

  useEffect(() => { fetch('/api/skills').then(r => r.json()).then(d => setSkills(d.skills ?? [])).catch(() => setSkills([])) }, [reload])
  useEffect(() => {
    setMode('view'); setDetail(null)
    if (selected) fetch(`/api/skills/view?name=${encodeURIComponent(selected)}`).then(r => r.ok ? r.json() : null).then(setDetail).catch(() => {})
  }, [selected, reload])

  const changed = () => { setReload(n => n + 1); onChanged() }
  const s = q.toLowerCase()
  const shown = (skills ?? []).filter(sk => (filter === 'all' || sk.source === filter) && (!s || sk.name.toLowerCase().includes(s) || sk.description.toLowerCase().includes(s)))
  const body = detail?.raw.replace(/^---[\s\S]*?\n---\s*/, '') ?? ''
  const chip = (on: boolean) => `px-2.5 py-1 rounded-md text-xs ${on ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`
  const tabBtn = (key: typeof tab, label: string) => (
    <button onClick={() => setTab(key)} className={`px-1 pb-2.5 pt-1 text-sm border-b-2 ${tab === key ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>{label}</button>
  )

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      <div className="px-6 pt-5 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold">Skills</h1>
          <button onClick={() => { setTab('installed'); onSelect(null); setMode('new') }} className="text-xs font-medium bg-blue-600 hover:bg-blue-500 rounded-md px-3 py-1.5">+ New skill</button>
        </div>
        <div className="flex gap-5">
          {tabBtn('installed', `Installed${skills ? ` · ${skills.length}` : ''}`)}
          {tabBtn('marketplace', 'Marketplace')}
        </div>
      </div>

      {tab === 'marketplace' ? (
        <div className="flex-1 min-h-0 px-6 py-4"><MarketplaceDialog inline onClose={() => {}} onInstalled={changed} /></div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="w-[380px] flex-shrink-0 border-r border-gray-800 flex flex-col min-h-0">
            <div className="p-3 space-y-2 border-b border-gray-800">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search skills"
                className="w-full bg-gray-900 border border-gray-800 focus:border-gray-600 rounded-md px-2.5 py-1.5 text-sm outline-none placeholder-gray-600" />
              <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5 w-fit">
                <button onClick={() => setFilter('all')} className={chip(filter === 'all')}>All</button>
                <button onClick={() => setFilter('user')} className={chip(filter === 'user')}>Mine</button>
                <button onClick={() => setFilter('plugin')} className={chip(filter === 'plugin')}>From plugins</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {skills === null && <p className="text-xs text-gray-500 p-4">Loading…</p>}
              {shown.map(sk => (
                <button key={sk.path} onClick={() => onSelect(sk.name)}
                  className={`w-full text-left px-4 py-2.5 border-b border-gray-800/60 ${selected === sk.name ? 'bg-gray-800' : 'hover:bg-gray-900'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate flex-1">{sk.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${sk.source === 'user' ? 'bg-blue-900/50 text-blue-300' : 'bg-gray-800 text-gray-400'}`}>{sk.source === 'plugin' ? sk.plugin ?? 'plugin' : 'mine'}</span>
                  </div>
                  {sk.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{sk.description}</p>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
            {mode === 'new' ? (
              <div className="max-w-3xl"><SkillDialog inline editing={null} onClose={() => setMode('view')} onSaved={changed} /></div>
            ) : mode === 'edit' && detail ? (
              <div className="max-w-3xl"><SkillDialog inline editing={detail.skill.name} onClose={() => setMode('view')} onSaved={changed} /></div>
            ) : detail ? (
              <div className="max-w-3xl">
                <div className="flex items-start justify-between gap-4 mb-1">
                  <h2 className="text-xl font-semibold font-mono">{detail.skill.name}</h2>
                  {detail.skill.source === 'user'
                    ? <button onClick={() => setMode('edit')} className="text-xs border border-gray-700 hover:bg-gray-800 rounded-md px-3 py-1.5 flex-shrink-0">Edit</button>
                    : <span className="text-xs text-gray-500 flex-shrink-0">From plugin {detail.skill.plugin} · read-only</span>}
                </div>
                <p className="text-sm text-gray-400 mb-1">{detail.skill.description}</p>
                <p className="text-[11px] text-gray-600 font-mono mb-6 truncate">{detail.skill.path}</p>
                <Markdown text={body} />
              </div>
            ) : (
              <div className="text-sm text-gray-500 mt-20 text-center">Pick a skill to read it, or create a new one.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
