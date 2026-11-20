import { DATA_DIR } from './dataDir'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export interface Note {
  id: string
  text: string
  createdAt: number
  orgId?: string
  // Optional reminder: fire a popup at this epoch-ms time. `done` marks it fired
  // (or dismissed) so it doesn't re-alert. (Reminder UI is a later feature; the
  // fields live here so the store shape is stable.)
  remindAt?: number
  reminderDone?: boolean
}

// Server-side persistence for notes — origin/browser/machine-independent, so
// they don't vanish when the app's hostname changes (localhost vs polyergon).

const DEFAULT_FILE = join(DATA_DIR, 'notes.json')

export class NotesStore {
  private notes: Note[] = []
  private file: string
  private dir: string

  constructor(file: string = DEFAULT_FILE) {
    this.file = file
    this.dir = join(file, '..')
    this.load()
  }

  private load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8'))
      if (Array.isArray(parsed)) this.notes = parsed
    } catch {
      this.notes = []
    }
  }

  all(): Note[] {
    return [...this.notes]
  }

  // Replace the whole list (the client owns ordering — newest first).
  replace(notes: Note[]) {
    if (!Array.isArray(notes)) return
    this.notes = notes.filter(n => n && typeof n.id === 'string' && typeof n.text === 'string')
    this.persist()
  }

  // Import notes from the client's localStorage the first time — only adds ids
  // we don't already have, so it can't clobber server-side edits.
  merge(incoming: Note[]) {
    if (!Array.isArray(incoming)) return
    const have = new Set(this.notes.map(n => n.id))
    let changed = false
    for (const n of incoming) {
      if (n && typeof n.id === 'string' && !have.has(n.id)) {
        this.notes.push(n); have.add(n.id); changed = true
      }
    }
    if (changed) {
      this.notes.sort((a, b) => b.createdAt - a.createdAt) // newest first
      this.persist()
    }
  }

  private persist() {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.notes))
    } catch {}
  }
}

declare global { var __notesStore: NotesStore | undefined }
export const notesStore: NotesStore =
  global.__notesStore ?? (global.__notesStore = new NotesStore())
