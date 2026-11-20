'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { Note } from '@/lib/notesStore'

// Notes live on the SERVER (not browser localStorage) so they're the same
// across hostnames (localhost vs polyergon), browsers, and machines. On first
// mount we migrate any notes still in the old localStorage keys up to the
// server, then always read/write the server copy.
const LEGACY_LIST_KEY = 'claude-notes-list'
const LEGACY_STRING_KEY = 'claude-notes' // even older single-textarea notes

export function useNotes(): {
  notes: Note[]
  setNotes: (updater: Note[] | ((prev: Note[]) => Note[])) => void
  loaded: boolean
} {
  const [notes, setNotesState] = useState<Note[]>([])
  const [loaded, setLoaded] = useState(false)
  const notesRef = useRef(notes)
  notesRef.current = notes

  useEffect(() => {
    let cancelled = false
    async function init() {
      // Gather legacy localStorage notes to migrate.
      const legacy: Note[] = []
      try {
        const list = JSON.parse(localStorage.getItem(LEGACY_LIST_KEY) ?? '[]')
        if (Array.isArray(list)) legacy.push(...list)
      } catch {}
      try {
        const raw = localStorage.getItem(LEGACY_STRING_KEY)
        if (raw) {
          const s = JSON.parse(raw)
          if (typeof s === 'string' && s.trim()) legacy.push({ id: `migrated-${Date.now()}`, text: s, createdAt: Date.now() })
        }
      } catch {}
      if (legacy.length) {
        try {
          await fetch('/api/notes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: legacy }) })
        } catch {}
      }
      try {
        const res = await fetch('/api/notes')
        const data = await res.json() as { notes?: Note[] }
        if (!cancelled) { setNotesState(data.notes ?? []); setLoaded(true) }
      } catch {
        if (!cancelled) setLoaded(true)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // Saves the whole list, debounced so typing in the editor isn't a POST per key.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setNotes = useCallback((updater: Note[] | ((prev: Note[]) => Note[])) => {
    const next = typeof updater === 'function' ? (updater as (p: Note[]) => Note[])(notesRef.current) : updater
    notesRef.current = next
    setNotesState(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: notesRef.current }) }).catch(() => {})
    }, 300)
  }, [])

  return { notes, setNotes, loaded }
}
