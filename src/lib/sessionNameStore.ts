import { DATA_DIR } from './dataDir'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// Server-side persistence for user-chosen session names, keyed by session id
// (both the app's internal live id and the CLI's claudeSessionId are stored, so
// a name resolves whichever key a card looks it up by). Lives on the server —
// not browser localStorage — so names are the same across hostnames, browsers,
// and machines. This is what makes localhost:3030 and polyergon:3030 agree.

const DEFAULT_FILE = join(DATA_DIR, 'session-names.json')

export class SessionNameStore {
  private names: Record<string, string> = {}
  private file: string
  private dir: string

  constructor(file: string = DEFAULT_FILE) {
    this.file = file
    this.dir = join(file, '..')
    this.load()
  }

  private load() {
    try {
      this.names = JSON.parse(readFileSync(this.file, 'utf-8'))
    } catch {
      this.names = {}
    }
  }

  all(): Record<string, string> {
    return { ...this.names }
  }

  set(key: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    this.names[key] = trimmed
    this.persist()
  }

  // Bulk import (used to migrate existing browser localStorage names in). Only
  // fills keys we don't already have, so a stale client copy can't clobber a
  // name already set on the server.
  merge(incoming: Record<string, string>) {
    let changed = false
    for (const [k, v] of Object.entries(incoming)) {
      if (typeof v === 'string' && v.trim() && !this.names[k]) {
        this.names[k] = v.trim()
        changed = true
      }
    }
    if (changed) this.persist()
  }

  remove(key: string) {
    if (key in this.names) { delete this.names[key]; this.persist() }
  }

  private persist() {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.names))
    } catch {}
  }
}

declare global { var __sessionNameStore: SessionNameStore | undefined }
export const sessionNameStore: SessionNameStore =
  global.__sessionNameStore ?? (global.__sessionNameStore = new SessionNameStore())
