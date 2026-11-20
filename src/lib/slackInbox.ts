import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './dataDir'
import { fetchMentions, isAnswered, slackMe, draftReply, type SlackMention } from './slackBridge'

// Cached inbox + the items you marked done (hidden even if Slack still lists them).
type Stage = 'idle' | 'searching' | 'checking' | 'suggesting'
interface Progress { stage: Stage; startedAt: number; error: string | null }
interface InboxFile { items: SlackMention[]; fetchedAt: number; done: string[]; progress?: Progress }
const FILE = join(DATA_DIR, 'slack-inbox.json')

function read(): InboxFile {
  try { return { items: [], fetchedAt: 0, done: [], ...JSON.parse(readFileSync(FILE, 'utf-8')) } } catch { return { items: [], fetchedAt: 0, done: [] } }
}
function write(f: InboxFile) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(f, null, 2))
}

// Refresh progress lives in the file, not module memory: dev-mode recompiles
// (and the server's separate module copy) would otherwise lose it.
const STALE_MS = 15 * 60_000
const IDLE: Progress = { stage: 'idle', startedAt: 0, error: null }
function progressOf(f: InboxFile): Progress {
  const p = f.progress ?? IDLE
  return p.stage !== 'idle' && Date.now() - p.startedAt > STALE_MS ? { ...IDLE, error: p.error } : p
}
function setProgress(patch: Partial<Progress>) {
  const f = read()
  write({ ...f, progress: { ...progressOf(f), ...patch } })
}

export function getInbox() {
  const f = read()
  const done = new Set(f.done)
  const progress = progressOf(f)
  return { items: f.items.filter(i => !done.has(i.permalink)), fetchedAt: f.fetchedAt, refreshing: progress.stage !== 'idle', ...progress }
}

// Two steps so cards appear fast: find mentions (~15s), then drop the answered ones.
export async function refreshInbox(): Promise<void> {
  if (progressOf(read()).stage !== 'idle') return
  setProgress({ stage: 'searching', startedAt: Date.now(), error: null })
  try {
    const found = await fetchMentions()
    // Keep what we already know is open; new ones start unchecked
    const known = new Map(read().items.filter(i => i.checked).map(i => [i.permalink, i]))
    write({ ...read(), items: found.map(m => known.get(m.permalink) ?? m), fetchedAt: Date.now() })
    setProgress({ stage: 'checking' })
    // Re-check every card (you may have answered since), 4 at a time; answered
    // ones disappear as each check lands. A failed check keeps the card.
    const me = await slackMe()
    const queue = [...found]
    const checker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        let answered = false
        try { answered = await isAnswered(m, me) } catch { /* keep it */ }
        const f = read()
        write({ ...f, items: answered ? f.items.filter(i => i.permalink !== m!.permalink) : f.items.map(i => (i.permalink === m!.permalink ? { ...i, checked: true } : i)) })
      }
    }
    await Promise.all([checker(), checker(), checker(), checker()])
    // Step 3: a suggested reply per card, 4 at a time, saved as each one lands
    setProgress({ stage: 'suggesting' })
    const todo = read().items.filter(i => !i.suggestion)
    const worker = async () => {
      for (let m = todo.shift(); m; m = todo.shift()) {
        try {
          const suggestion = await draftReply(m.permalink)
          const f = read()
          write({ ...f, items: f.items.map(i => (i.permalink === m!.permalink ? { ...i, suggestion } : i)) })
        } catch { /* leave this card without a suggestion */ }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  } catch (e) {
    setProgress({ error: (e as Error).message })
  } finally {
    setProgress({ stage: 'idle' })
  }
}

export function markDone(permalink: string) {
  const f = read()
  if (!f.done.includes(permalink)) write({ ...f, done: [...f.done, permalink].slice(-500) })
}
