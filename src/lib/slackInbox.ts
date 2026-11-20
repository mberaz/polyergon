import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './dataDir'
import { fetchMentions, openOnly, type SlackMention } from './slackBridge'

// Cached inbox + the items you marked done (hidden even if Slack still lists them).
interface InboxFile { items: SlackMention[]; fetchedAt: number; done: string[] }
const FILE = join(DATA_DIR, 'slack-inbox.json')

function read(): InboxFile {
  try { return { items: [], fetchedAt: 0, done: [], ...JSON.parse(readFileSync(FILE, 'utf-8')) } } catch { return { items: [], fetchedAt: 0, done: [] } }
}
function write(f: InboxFile) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(f, null, 2))
}

// Live progress of the current refresh (module state; this route's copy only)
const progress: { stage: 'idle' | 'searching' | 'checking'; startedAt: number; error: string | null } = { stage: 'idle', startedAt: 0, error: null }

export function getInbox() {
  const f = read()
  const done = new Set(f.done)
  return { items: f.items.filter(i => !done.has(i.permalink)), fetchedAt: f.fetchedAt, refreshing: progress.stage !== 'idle', ...progress }
}

// Two steps so cards appear fast: find mentions (~15s), then drop the answered ones.
export async function refreshInbox(): Promise<void> {
  if (progress.stage !== 'idle') return
  Object.assign(progress, { stage: 'searching', startedAt: Date.now(), error: null })
  try {
    const found = await fetchMentions()
    // Keep what we already know is open; new ones start unchecked
    const known = new Map(read().items.filter(i => i.checked).map(i => [i.permalink, i]))
    write({ ...read(), items: found.map(m => known.get(m.permalink) ?? m), fetchedAt: Date.now() })
    progress.stage = 'checking'
    // Re-check all of them: you may have answered in Slack since last time
    const open = await openOnly(found.map(m => m.permalink))
    write({ ...read(), items: read().items.filter(i => open.has(i.permalink)).map(i => ({ ...i, checked: true })), fetchedAt: Date.now() })
  } catch (e) {
    progress.error = (e as Error).message
  } finally {
    progress.stage = 'idle'
  }
}

export function markDone(permalink: string) {
  const f = read()
  if (!f.done.includes(permalink)) write({ ...f, done: [...f.done, permalink].slice(-500) })
}
