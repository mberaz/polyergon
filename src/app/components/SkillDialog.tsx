'use client'
import { withOrg } from '@/lib/activeOrg'
import { useEffect, useState } from 'react'

// Create or edit a user skill (~/.claude/skills/<name>/SKILL.md).
// editing = existing skill name, or null for a new one.
export function SkillDialog({ editing, onClose, onSaved, inline = false }: { editing: string | null; onClose: () => void; onSaved: () => void; inline?: boolean }) {
  const [mode, setMode] = useState<'form' | 'raw'>(editing ? 'raw' : 'form')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!editing) return
    fetch(withOrg(`/api/skills/${editing}`)).then(r => r.json()).then(d => setRaw(d.raw ?? '')).catch(() => setError('Could not load the skill'))
  }, [editing])

  function importFile(file: File | undefined) {
    if (!file) return
    file.text().then(text => { setRaw(text); setMode('raw') })
  }

  async function save() {
    setBusy(true); setError(null)
    const body = mode === 'raw' ? { raw } : { name: name.trim().toLowerCase().replace(/\s+/g, '-'), description, instructions }
    const r = await fetch(editing ? `/api/skills/${editing}` : '/api/skills', {
      method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setError(d.error ?? 'Could not save'); return }
    onSaved(); onClose()
  }

  async function remove() {
    if (!editing) return
    const r = await fetch(withOrg(`/api/skills/${editing}`), { method: 'DELETE' })
    if (!r.ok) { setError('Could not delete'); return }
    onSaved(); onClose()
  }

  const field = 'w-full bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm text-white outline-none placeholder-gray-500'
  const tab = (m: typeof mode, label: string) => (
    <button onClick={() => setMode(m)} className={`px-2.5 py-1 rounded-md text-xs ${mode === m ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
  )

  return (
    <div className={inline ? '' : 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4'} onClick={inline ? undefined : onClose}>
      <div className={inline ? 'text-white' : 'w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 text-white'} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold">{editing ? `Edit skill: ${editing}` : 'New skill'}</h2>
          {!inline && <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>}
        </div>
        <p className="text-xs text-gray-500 mb-4">Saved to <code>~/.claude/skills/&lt;name&gt;/SKILL.md</code>. Claude Code loads it in sessions started after you save.</p>

        <div className="flex items-center gap-1 mb-4 bg-gray-950/60 border border-gray-800 rounded-lg p-0.5 w-fit">
          {!editing && tab('form', 'Write it')}
          {tab('raw', editing ? 'SKILL.md' : 'Paste SKILL.md')}
          <label className="px-2.5 py-1 rounded-md text-xs text-gray-400 hover:text-gray-200 cursor-pointer">
            Import file…
            <input type="file" accept=".md,text/markdown,text/plain" className="hidden" onChange={e => importFile(e.target.files?.[0])} />
          </label>
        </div>

        {mode === 'form' ? (
          <div className="space-y-3">
            <label className="block text-xs text-gray-400">Name
              <input value={name} onChange={e => setName(e.target.value)} placeholder="release-notes" className={`${field} mt-1 font-mono`} />
            </label>
            <label className="block text-xs text-gray-400">When should Claude use it?
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Use when writing release notes from merged PRs" className={`${field} mt-1`} />
            </label>
            <label className="block text-xs text-gray-400">Instructions (markdown)
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={12}
                placeholder={'# Release notes\n\n1. List PRs merged since the last tag\n2. Group them by area\n3. …'} className={`${field} mt-1 font-mono text-xs resize-y`} />
            </label>
          </div>
        ) : (
          <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={inline ? 26 : 18} spellCheck={false}
            placeholder={'---\nname: release-notes\ndescription: Use when writing release notes\n---\n\n# Instructions…'}
            className={`${field} font-mono text-xs resize-y`} />
        )}

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex items-center gap-2 mt-4">
          {editing && (confirmDelete
            ? <span className="flex items-center gap-2 text-xs"><span className="text-gray-400">Delete this skill?</span>
                <button onClick={remove} className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500">Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-gray-400 hover:text-white">Cancel</button></span>
            : <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-400 hover:text-red-300">Delete skill</button>)}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Cancel</button>
            <button onClick={save} disabled={busy} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40">{busy ? 'Saving…' : 'Save skill'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
