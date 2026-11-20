'use client'
import { useEffect, useRef, useState } from 'react'
import type { Note } from '@/lib/notesStore'
import type { Org } from '@/lib/orgRegistry'

function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}

const titleOf = (n: Note) => n.text.split('\n').find(l => l.trim())?.trim() || 'Untitled'

// Full-page notes: list on the left, editor on the right. Edits save as you type.
export function NotesPage({ notes, setNotes, orgs, activeOrgId, selected, onSelect }: {
  notes: Note[]
  setNotes: (updater: (prev: Note[]) => Note[]) => void
  orgs: Org[]
  activeOrgId: string
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const [q, setQ] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const inOrg = (orgId?: string) => activeOrgId === 'all' || (orgId ?? 'default') === activeOrgId
  const s = q.toLowerCase()
  const shown = notes.filter(n => inOrg(n.orgId) && (!s || n.text.toLowerCase().includes(s)))
  const note = notes.find(n => n.id === selected) ?? null

  useEffect(() => { setConfirmDelete(false) }, [selected])

  function create() {
    const n: Note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: '', createdAt: Date.now(), ...(activeOrgId !== 'all' ? { orgId: activeOrgId } : {}) }
    setNotes(prev => [n, ...prev])
    onSelect(n.id)
    setTimeout(() => editorRef.current?.focus(), 50)
  }
  const patch = (p: Partial<Note>) => note && setNotes(prev => prev.map(n => n.id === note.id ? { ...n, ...p } : n))

  return (
    <div className="absolute inset-0 flex bg-gray-950 text-gray-100">
      <div className="w-[340px] flex-shrink-0 border-r border-gray-800 flex flex-col min-h-0">
        <div className="px-4 pt-5 pb-3 border-b border-gray-800 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Notes</h1>
            <button onClick={create} className="text-xs font-medium bg-blue-600 hover:bg-blue-500 rounded-md px-3 py-1.5">+ New note</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search notes"
            className="w-full bg-gray-900 border border-gray-800 focus:border-gray-600 rounded-md px-2.5 py-1.5 text-sm outline-none placeholder-gray-600" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {shown.length === 0 && <p className="text-xs text-gray-500 p-4">{q ? 'No notes match.' : 'No notes yet.'}</p>}
          {shown.map(n => (
            <button key={n.id} onClick={() => onSelect(n.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-800/60 ${selected === n.id ? 'bg-gray-800' : 'hover:bg-gray-900'}`}>
              <p className="text-sm font-medium truncate">{titleOf(n)}</p>
              <p className="text-xs text-gray-500 truncate mt-0.5">{n.text.split('\n').filter(l => l.trim()).slice(1).join(' ') || ' '}</p>
              <p className="text-[11px] text-gray-600 mt-1">
                {new Date(n.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {n.remindAt && !n.reminderDone && <span className="text-amber-400"> · ⏰ {new Date(n.remindAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        {note ? (
          <>
            <div className="px-8 py-3 border-b border-gray-800 flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
              <span>{new Date(note.createdAt).toLocaleString()}</span>
              <label className={`flex items-center gap-1.5 ${note.remindAt && !note.reminderDone ? 'text-amber-400' : ''}`}>
                ⏰ Remind me
                <input type="datetime-local" value={note.remindAt ? toLocalInput(note.remindAt) : ''}
                  onChange={e => patch({ remindAt: e.target.value ? new Date(e.target.value).getTime() : undefined, reminderDone: false })}
                  className="bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-xs text-gray-200 [color-scheme:dark]" />
                {note.remindAt && <button onClick={() => patch({ remindAt: undefined, reminderDone: false })} className="text-gray-500 hover:text-white">clear</button>}
              </label>
              {note.orgId && note.orgId !== 'default' && <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 text-[10px]">{orgs.find(o => o.id === note.orgId)?.name ?? 'org'}</span>}
              <span className="ml-auto">
                {confirmDelete
                  ? <span className="flex items-center gap-2">Delete this note?
                      <button onClick={() => { setNotes(prev => prev.filter(n => n.id !== note.id)); onSelect(null) }} className="px-2 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white">Delete</button>
                      <button onClick={() => setConfirmDelete(false)} className="hover:text-white">Cancel</button></span>
                  : <button onClick={() => setConfirmDelete(true)} className="text-red-400 hover:text-red-300">Delete</button>}
              </span>
            </div>
            <textarea ref={editorRef} value={note.text} onChange={e => patch({ text: e.target.value })}
              placeholder="Start typing. The first line is the title."
              className="flex-1 w-full resize-none bg-transparent px-8 py-6 text-[15px] leading-relaxed text-gray-100 outline-none placeholder-gray-600" />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Pick a note, or create a new one.</div>
        )}
      </div>
    </div>
  )
}
