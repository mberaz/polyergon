import { DATA_DIR } from './dataDir'
import { writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'

export type SessionStatus = 'thinking' | 'waiting' | 'idle'

export interface LiveSession {
  id: string
  cwd: string
  gitRoot: string | null
  claudeSessionId: string | null
  status: SessionStatus
  createdAt: number
  prUrl: string | null
  // Remote Control link for the CURRENT pty (new per spawn; not persisted)
  rcUrl?: string | null
  orgId: string
  // Which agent CLI this session runs on and the model it was launched with —
  // persisted so a resume/restart re-spawns identically. Optional for entries
  // saved before these fields existed (default to claude + app default model).
  backend?: string
  model?: string | null
  // Remote Control opt-in (persisted; honored on every re-spawn)
  rc?: boolean
  // Session runs in its own git worktree (branch + folder), see worktrees.ts
  worktree?: { repo: string; path: string; branch: string }
}

const DEFAULT_PERSIST_DIR = DATA_DIR
const DEFAULT_PERSIST_FILE = join(DEFAULT_PERSIST_DIR, 'live-sessions.json')

type SavedSession = Pick<LiveSession, 'id' | 'cwd' | 'gitRoot' | 'claudeSessionId' | 'createdAt' | 'prUrl' | 'orgId' | 'backend' | 'model' | 'rc' | 'worktree'>

export class LiveSessionStore {
  private sessions = new Map<string, LiveSession>()
  private persistDir: string
  private persistFile: string

  // persistFile defaults to the real on-disk location; tests must pass an
  // isolated path so they never touch the user's actual session state.
  constructor(persistFile: string = DEFAULT_PERSIST_FILE) {
    this.persistFile = persistFile
    this.persistDir = join(persistFile, '..')
  }

  add(session: LiveSession) {
    this.sessions.set(session.id, session)
    this.persist()
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id)
  }

  list(): LiveSession[] {
    return Array.from(this.sessions.values())
  }

  setStatus(id: string, status: SessionStatus) {
    const s = this.sessions.get(id)
    if (s) s.status = status
  }

  setClaudeSessionId(id: string, claudeSessionId: string) {
    const s = this.sessions.get(id)
    if (s) { s.claudeSessionId = claudeSessionId; this.persist() }
  }

  setRcUrl(id: string, rcUrl: string | null) {
    const s = this.sessions.get(id)
    if (s) s.rcUrl = rcUrl
  }

  setPrUrl(id: string, prUrl: string) {
    const s = this.sessions.get(id)
    if (s && s.prUrl !== prUrl) { s.prUrl = prUrl; this.persist() }
  }

  remove(id: string) {
    this.sessions.delete(id)
    this.persist()
  }

  private persist() {
    try {
      if (!existsSync(this.persistDir)) mkdirSync(this.persistDir, { recursive: true })
      const saved: SavedSession[] = Array.from(this.sessions.values()).map(s => ({
        id: s.id, cwd: s.cwd, gitRoot: s.gitRoot, claudeSessionId: s.claudeSessionId, createdAt: s.createdAt, prUrl: s.prUrl, orgId: s.orgId, backend: s.backend, model: s.model, rc: s.rc, worktree: s.worktree,
      }))
      writeFileSync(this.persistFile, JSON.stringify(saved))
    } catch {}
  }

  // Keeps the last 5 boot-time copies so a bad restore is recoverable.
  static backupSaved(persistFile: string = DEFAULT_PERSIST_FILE) {
    try {
      if (!existsSync(persistFile)) return
      const dir = dirname(persistFile)
      copyFileSync(persistFile, join(dir, `live-sessions.boot-${Date.now()}.json`))
      readdirSync(dir).filter(f => f.startsWith('live-sessions.boot-')).sort().slice(0, -5)
        .forEach(f => unlinkSync(join(dir, f)))
    } catch {}
  }

  static loadSaved(persistFile: string = DEFAULT_PERSIST_FILE): SavedSession[] {
    try {
      return JSON.parse(readFileSync(persistFile, 'utf-8'))
    } catch {
      return []
    }
  }
}

declare global { var __liveSessionStore: LiveSessionStore | undefined }
export const liveSessionStore: LiveSessionStore =
  global.__liveSessionStore ?? (global.__liveSessionStore = new LiveSessionStore())
