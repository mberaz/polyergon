import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { DATA_DIR } from './dataDir'

// Tasks for the board. Read from disk on every call: the server and the API
// routes load separate module copies, so both must see the same file.
export interface Task {
  id: string
  title: string
  details: string
  cwd: string // folder to work in, or 'general' for a plain chat
  worktree: boolean // run in its own branch + worktree
  ship: boolean // run Ship it for the session (PR, reviews, CI; you merge)
  slackChannel?: { id: string; name: string } | null // where Ship it posts the PR for review
  orgId: string
  liveId: string | null // session started for it
  done: boolean
  createdAt: number
  doneAt?: number
}

const FILE = join(DATA_DIR, 'tasks.json')

export function listTasks(file = FILE): Task[] {
  try { const t = JSON.parse(readFileSync(file, 'utf-8')); return Array.isArray(t) ? t : [] } catch { return [] }
}

function save(tasks: Task[], file: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(tasks, null, 2))
}

export function addTask(input: Pick<Task, 'title' | 'details' | 'cwd' | 'worktree' | 'orgId'> & Partial<Pick<Task, 'ship' | 'slackChannel'>>, file = FILE): Task {
  const t: Task = { id: randomUUID(), title: input.title.trim().slice(0, 200), details: input.details.trim().slice(0, 20000), cwd: input.cwd || 'general', worktree: !!input.worktree, ship: input.ship ?? input.cwd !== 'general', slackChannel: input.slackChannel ?? null, orgId: input.orgId || 'default', liveId: null, done: false, createdAt: Date.now() }
  save([...listTasks(file), t], file)
  return t
}

export function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'details' | 'cwd' | 'worktree' | 'liveId' | 'done' | 'ship' | 'slackChannel'>>, file = FILE): Task | null {
  const tasks = listTasks(file)
  const t = tasks.find(x => x.id === id)
  if (!t) return null
  Object.assign(t, patch, patch.done === true && !t.doneAt ? { doneAt: Date.now() } : {}, patch.done === false ? { doneAt: undefined } : {})
  save(tasks, file)
  return t
}

export function removeTask(id: string, file = FILE) {
  save(listTasks(file).filter(t => t.id !== id), file)
}
