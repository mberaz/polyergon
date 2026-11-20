import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './dataDir'
import { fetchMentions, isAnswered, slackMe, draftReply, orgFile, type SlackMention } from './slackBridge'
import { DEFAULT_ORG_ID } from './orgRegistry'

// Cached inbox + the items you marked done (hidden even if Slack still lists them).
type Stage = 'idle' | 'searching' | 'checking' | 'suggesting'
interface Progress { stage: Stage; startedAt: number; error: string | null }
interface InboxFile { items: SlackMention[]; fetchedAt: number; done: string[]; progress?: Progress }

// One inbox file per org (each org has its own Slack workspace)
function read(orgId: string): InboxFile {
  try { return { items: [], fetchedAt: 0, done: [], ...JSON.parse(readFileSync(orgFile('slack-inbox', orgId), 'utf-8')) } } catch { return { items: [], fetchedAt: 0, done: [] } }
}
function write(orgId: string, f: InboxFile) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(orgFile('slack-inbox', orgId), JSON.stringify(f, null, 2))
}

// Refresh progress lives in the file, not module memory: dev-mode recompiles
// (and the server's separate module copy) would otherwise lose it.
const STALE_MS = 15 * 60_000
const IDLE: Progress = { stage: 'idle', startedAt: 0, error: null }
function progressOf(f: InboxFile): Progress {
  const p = f.progress ?? IDLE
  return p.stage !== 'idle' && Date.now() - p.startedAt > STALE_MS ? { ...IDLE, error: p.error } : p
}
function setProgress(orgId: string, patch: Partial<Progress>) {
  const f = read(orgId)
  write(orgId, { ...f, progress: { ...progressOf(f), ...patch } })
}

export function getInbox(orgId: string = DEFAULT_ORG_ID) {
  const f = read(orgId)
  const done = new Set(f.done)
  const progress = progressOf(f)
  return { items: f.items.filter(i => !done.has(i.permalink)), fetchedAt: f.fetchedAt, refreshing: progress.stage !== 'idle', ...progress }
}

// Two steps so cards appear fast: find mentions (~15s), then drop the answered ones.
export async function refreshInbox(orgId: string = DEFAULT_ORG_ID): Promise<void> {
  if (progressOf(read(orgId)).stage !== 'idle') return
  setProgress(orgId, { stage: 'searching', startedAt: Date.now(), error: null })
  try {
    const found = await fetchMentions(7, orgId)
    // Keep what we already know is open; new ones start unchecked
    const known = new Map(read(orgId).items.filter(i => i.checked).map(i => [i.permalink, i]))
    write(orgId, { ...read(orgId), items: found.map(m => known.get(m.permalink) ?? m), fetchedAt: Date.now() })
    setProgress(orgId, { stage: 'checking' })
    // Re-check every card (you may have answered since), 4 at a time; answered
    // ones disappear as each check lands. A failed check keeps the card.
    const me = await slackMe(orgId)
    const queue = [...found]
    const checker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        let answered = false
        try { answered = await isAnswered(m, me, orgId) } catch { /* keep it */ }
        const f = read(orgId)
        write(orgId, { ...f, items: answered ? f.items.filter(i => i.permalink !== m!.permalink) : f.items.map(i => (i.permalink === m!.permalink ? { ...i, checked: true } : i)) })
      }
    }
    await Promise.all([checker(), checker(), checker(), checker()])
    // Step 3: a suggested reply per card, 4 at a time, saved as each one lands
    setProgress(orgId, { stage: 'suggesting' })
    const todo = read(orgId).items.filter(i => !i.suggestion)
    const worker = async () => {
      for (let m = todo.shift(); m; m = todo.shift()) {
        try {
          const suggestion = await draftReply(m.permalink, orgId)
          const f = read(orgId)
          write(orgId, { ...f, items: f.items.map(i => (i.permalink === m!.permalink ? { ...i, suggestion } : i)) })
        } catch { /* leave this card without a suggestion */ }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  } catch (e) {
    setProgress(orgId, { error: (e as Error).message })
  } finally {
    setProgress(orgId, { stage: 'idle' })
  }
}

export function markDone(permalink: string, orgId: string = DEFAULT_ORG_ID) {
  const f = read(orgId)
  if (!f.done.includes(permalink)) write(orgId, { ...f, done: [...f.done, permalink].slice(-500) })
}
