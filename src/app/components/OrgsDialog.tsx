'use client'
import { useState } from 'react'
import type { Org } from '@/lib/orgRegistry'

type Draft = { name: string; configDir: string; model: string; githubOrgs: string }
const toDraft = (o?: Org): Draft => ({ name: o?.name ?? '', configDir: o?.configDir ?? '', model: o?.model ?? '', githubOrgs: (o?.githubOrgs ?? []).join(', ') })

// Add, edit and remove orgs. An org = its own Claude config folder (account),
// default model, and the GitHub owners whose PRs belong to it.
export function OrgsDialog({ orgs, onClose, onChanged }: { orgs: Org[]; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(toDraft())
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  function open(id: string | 'new') {
    setEditing(id); setError(null)
    setDraft(toDraft(id === 'new' ? undefined : orgs.find(o => o.id === id)))
  }

  async function save() {
    setError(null)
    const isDefault = editing === 'default'
    const body = {
      name: draft.name,
      ...(isDefault ? {} : { configDir: draft.configDir.trim() }),
      model: draft.model,
      githubOrgs: draft.githubOrgs.split(',').map(s => s.trim()).filter(Boolean),
    }
    const r = editing === 'new'
      ? await fetch('/api/orgs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`/api/orgs/${editing}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error ?? 'Could not save'); return }
    // POST only takes name/folder/model; set GitHub owners with a follow-up edit
    if (editing === 'new' && body.githubOrgs.length) {
      await fetch(`/api/orgs/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ githubOrgs: body.githubOrgs }) })
    }
    setEditing(null); onChanged()
  }

  async function remove(id: string) {
    setConfirmId(null)
    const r = await fetch(`/api/orgs/${id}`, { method: 'DELETE' })
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Could not remove'); return }
    if (editing === id) setEditing(null)
    onChanged()
  }

  const input = 'w-full bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm text-white outline-none placeholder-gray-500 mt-1'
  const form = (
    <div className="space-y-3 bg-gray-950/60 border border-gray-800 rounded-lg p-3 mt-2">
      <label className="block text-xs text-gray-400">Name
        <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Acme" className={input} />
      </label>
      {editing !== 'default' && (
        <label className="block text-xs text-gray-400">Claude config folder
          <input value={draft.configDir} onChange={e => setDraft({ ...draft, configDir: e.target.value })} placeholder="/Users/you/.claude-acme" className={`${input} font-mono`} />
          <span className="text-[11px] text-gray-500">Each folder is a separate Claude login. Run <code>CLAUDE_CONFIG_DIR=&lt;folder&gt; claude</code> once to sign in.</span>
        </label>
      )}
      <label className="block text-xs text-gray-400">Default model (optional)
        <input value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} placeholder="claude-opus-5-5" className={`${input} font-mono`} />
      </label>
      <label className="block text-xs text-gray-400">GitHub orgs for the PR inbox (optional, comma-separated)
        <input value={draft.githubOrgs} onChange={e => setDraft({ ...draft, githubOrgs: e.target.value })} placeholder="acme, acme-labs" className={input} />
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
        <button onClick={save} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500">{editing === 'new' ? 'Add org' : 'Save'}</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Orgs</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>
        <ul className="space-y-2">
          {orgs.map(o => (
            <li key={o.id} className="rounded-lg border border-gray-800 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{o.name}</p>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{o.configDir ?? '~/.claude (Claude Code default)'}{o.model ? ` · ${o.model}` : ''}{o.githubOrgs?.length ? ` · GitHub: ${o.githubOrgs.join(', ')}` : ''}</p>
                </div>
                <button onClick={() => open(o.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Edit</button>
                {o.id !== 'default' && (confirmId === o.id
                  ? <><button onClick={() => remove(o.id)} className="text-xs px-2 py-1 rounded-md bg-red-600 hover:bg-red-500">Remove</button><button onClick={() => setConfirmId(null)} className="text-xs text-gray-400">Cancel</button></>
                  : <button onClick={() => setConfirmId(o.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-red-400 hover:bg-red-950/40">Remove</button>)}
              </div>
              {editing === o.id && form}
            </li>
          ))}
        </ul>
        {editing === 'new' ? form : (
          <button onClick={() => open('new')} className="mt-3 w-full text-sm py-2 rounded-lg border border-dashed border-gray-700 text-gray-300 hover:bg-gray-800">+ Add org</button>
        )}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        <p className="text-[11px] text-gray-500 mt-4">Removing an org keeps its sessions and meetings; they still show under All. Changes apply to sessions started after you save.</p>
      </div>
    </div>
  )
}
