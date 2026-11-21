import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DATA_DIR } from './dataDir'
import { liveSessionStore } from './liveSessionStore'
import { sendWhenReady } from './ptyManager'
import { orgRegistry } from './orgRegistry'
import { newChannelRequests, draftChannelReply, NEEDS_OWNER, replyInThread, timeFromPermalink, type SlackChannel } from './slackBridge'

// "Slack channel watcher" automations: every few minutes, find new unanswered
// questions in a channel and draft replies (optionally from a forked copy of a
// session, which never touches the live session). Drafts wait for your Send,
// unless the watcher is set to answer automatically.

export interface WatchItem {
  permalink: string
  author: string
  text: string
  time: string
  state: 'drafting' | 'pending' | 'sending' | 'sent' | 'dismissed' | 'failed' | 'delegated'
  draft: string | null
  error?: string
}

export interface SlackWatcher {
  id: string
  channel: SlackChannel
  liveId: string | null // session whose knowledge the drafts use
  orgId: string // whose Slack workspace/connector
  mode: 'approve' | 'auto'
  intervalMin: number
  status: 'running' | 'stopped'
  lastRunAt: number
  checking: boolean
  items: WatchItem[]
  log: WatchLog[]
  createdAt: number
  // Extra knowledge for drafts: one source per line (links, file/folder paths, #channels, notes)
  knowledge?: string
  // How to answer (tone, what to never promise, who to tag...)
  instructions?: string
  checkedOnce?: boolean // first check looks back BACKLOG_MS
}

export type WatcherEvent = { type: 'slack-watchers'; items: SlackWatcher[]; notify?: { title: string; body: string } }

const FILE = join(DATA_DIR, 'slack-watchers.json')

// Audit trail: what the watcher did, with the text and Slack link when there is one
export interface WatchLog { t: number; text: string; detail?: string; link?: string }

class SlackWatcherEngine {
  private items: SlackWatcher[] = []
  private listeners = new Set<(ev: WatcherEvent) => void>()
  private started = false

  start() {
    if (this.started) return
    this.started = true
    try { this.items = JSON.parse(readFileSync(FILE, 'utf-8')).map((w: SlackWatcher) => ({ ...w, checking: false })) } catch { this.items = [] }
    setInterval(() => this.items.filter(w => w.status === 'running' && Date.now() - w.lastRunAt >= w.intervalMin * 60_000).forEach(w => this.run(w.id)), 60_000)
  }

  on(fn: (ev: WatcherEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  list() { return this.items }

  private save(notify?: WatcherEvent['notify']) {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(this.items, null, 2))
    this.listeners.forEach(fn => fn({ type: 'slack-watchers', items: this.items, notify }))
  }
  private log(w: SlackWatcher, text: string, notify?: WatcherEvent['notify'], extra: Omit<WatchLog, 't' | 'text'> = {}) {
    w.log = [...w.log, { t: Date.now(), text, ...extra }].slice(-200)
    this.save(notify)
  }

  create(input: { channel: SlackChannel; liveId: string | null; mode: 'approve' | 'auto'; intervalMin: number; orgId: string; knowledge?: string; instructions?: string }): SlackWatcher | { error: string } {
    if (!input.channel?.name) return { error: 'Pick a channel' }
    if (input.liveId && !liveSessionStore.get(input.liveId)?.claudeSessionId) return { error: 'That session has no Claude conversation yet' }
    const w: SlackWatcher = {
      id: randomUUID(), channel: input.channel, liveId: input.liveId, orgId: (input.liveId && liveSessionStore.get(input.liveId)?.orgId) || input.orgId, mode: input.mode === 'auto' ? 'auto' : 'approve',
      intervalMin: Math.min(60, Math.max(2, Math.round(input.intervalMin) || 5)), status: 'running',
      lastRunAt: Date.now(), checking: false, items: [], log: [], createdAt: Date.now(),
      knowledge: String(input.knowledge ?? '').slice(0, 4000), instructions: String(input.instructions ?? '').slice(0, 4000),
    }
    this.items = [...this.items, w]
    this.log(w, `Watching #${w.channel.name} for new questions (every ${w.intervalMin} min)`)
    return w
  }

  // Edit: everything but the channel
  update(id: string, patch: { liveId?: string | null; mode?: 'approve' | 'auto'; intervalMin?: number; knowledge?: string; instructions?: string }): { error: string } | null {
    const w = this.items.find(x => x.id === id)
    if (!w) return { error: 'Not found' }
    if (patch.liveId && !liveSessionStore.get(patch.liveId)?.claudeSessionId) return { error: 'That session has no Claude conversation yet' }
    if (patch.liveId !== undefined) w.liveId = patch.liveId || null
    if (patch.mode) w.mode = patch.mode === 'auto' ? 'auto' : 'approve'
    if (patch.intervalMin !== undefined) w.intervalMin = Math.min(60, Math.max(2, Math.round(patch.intervalMin) || 5))
    if (patch.knowledge !== undefined) w.knowledge = String(patch.knowledge).slice(0, 4000)
    if (patch.instructions !== undefined) w.instructions = String(patch.instructions).slice(0, 4000)
    this.log(w, 'You edited the watcher', undefined, { detail: [`Mode: ${w.mode === 'auto' ? 'answer automatically' : 'you approve'}`, `Every ${w.intervalMin} min`, w.knowledge ? `Knowledge:\n${w.knowledge}` : '', w.instructions ? `Instructions:\n${w.instructions}` : ''].filter(Boolean).join('\n') })
    return null
  }

  setSession(id: string, liveId: string | null) {
    const w = this.items.find(x => x.id === id)
    if (!w) return
    if (liveId && !liveSessionStore.get(liveId)?.claudeSessionId) return
    w.liveId = liveId
    this.log(w, liveId ? 'Drafts now use a session\'s knowledge' : 'Drafts now use general knowledge')
  }

  stop(id: string) {
    const w = this.items.find(x => x.id === id)
    if (w && w.status === 'running') { w.status = 'stopped'; this.log(w, 'Stopped by you') }
  }

  private static BACKLOG_MS = 24 * 60 * 60_000

  // Check the channel now (also runs on the interval).
  async run(id: string) {
    const w = this.items.find(x => x.id === id)
    if (!w || w.status !== 'running' || w.checking) return
    // First check: last 24h too, so questions already waiting are caught. Later: since last check (small overlap; dedupe below)
    const since = new Date(w.checkedOnce ? w.lastRunAt - 2 * 60_000 : w.createdAt - SlackWatcherEngine.BACKLOG_MS).toISOString()
    w.checking = true; w.lastRunAt = Date.now(); this.save()
    try {
      const seen = new Set(w.items.map(i => i.permalink))
      const fresh = (await newChannelRequests(w.channel, since, w.orgId)).filter(r => !seen.has(r.permalink))
      if (fresh.length) {
        w.items = [...fresh.map(r => ({ ...r, state: 'drafting' as const, draft: null })), ...w.items].slice(0, 100)
        this.log(w, `Found ${fresh.length} question${fresh.length > 1 ? 's' : ''} in #${w.channel.name}`, undefined, { detail: fresh.map(r => `${r.author}: ${r.text}`).join('\n\n') })
        for (const r of fresh) await this.draft(w, r.permalink)
      } else {
        // One rolling line, not one per check
        const line = `Checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: no new questions`
        if (w.log.at(-1)?.text.startsWith('Checked ')) w.log = w.log.slice(0, -1)
        this.log(w, line)
      }
      w.checkedOnce = true
    } catch (e) {
      this.log(w, `Check failed: ${(e as Error).message}`)
    } finally {
      w.checking = false; this.save()
    }
  }

  private ctxFor(w: SlackWatcher) {
    const s = w.liveId ? liveSessionStore.get(w.liveId) : null
    return s?.claudeSessionId ? { resumeId: s.claudeSessionId, cwd: s.cwd, configDir: orgRegistry.get(s.orgId)?.configDir ?? null } : null
  }

  private async draft(w: SlackWatcher, permalink: string) {
    const it = w.items.find(i => i.permalink === permalink)
    if (!it) return
    try {
      const raw = await draftChannelReply(it, w.channel.name, this.ctxFor(w), w.orgId, { knowledge: w.knowledge, instructions: w.instructions })
      const needsYou = raw.startsWith(NEEDS_OWNER)
      it.draft = needsYou ? raw.slice(NEEDS_OWNER.length).trim() : raw
      // Auto-answer only messages posted after you started the watcher; older backlog waits for your approval
      const backlog = !(Date.parse(timeFromPermalink(it.permalink) || '') >= w.createdAt) // unknown time counts as backlog
      if (w.mode === 'auto' && !backlog && needsYou && w.liveId) {
        this.delegate(w.id, it.permalink, true)
      } else if (w.mode === 'auto' && !backlog && !needsYou) {
        await replyInThread(it.permalink, it.draft, w.orgId)
        it.state = 'sent'
        this.log(w, `Answered ${it.author} automatically`, undefined, { detail: it.draft, link: it.permalink })
      } else {
        it.state = 'pending'
        this.log(w, `Drafted a reply to ${it.author}${backlog && w.mode === 'auto' ? ' (older message: waits for your OK)' : ''}${needsYou && w.mode === 'auto' ? ' (needs your answer: not posted)' : ''}`, { title: `#${w.channel.name}: reply ready`, body: `${it.author}: ${it.text.slice(0, 80)}` }, { detail: it.draft, link: it.permalink })
      }
    } catch (e) {
      it.state = 'failed'; it.error = (e as Error).message
      this.log(w, `Couldn't draft for ${it.author}`, undefined, { detail: it.error, link: it.permalink })
    }
  }

  // Your click: post the (possibly edited) draft in the thread.
  async send(id: string, permalink: string, text: string): Promise<{ error: string } | null> {
    const w = this.items.find(x => x.id === id)
    const it = w?.items.find(i => i.permalink === permalink)
    if (!w || !it) return { error: 'Not found' }
    // Only one send per question: a second click while posting (or after) does nothing
    if (it.state !== 'pending' && it.state !== 'failed') return { error: it.state === 'sent' ? 'Already answered' : 'Already sending' }
    const body = (text || it.draft || '').trim()
    if (!body) return { error: 'Nothing to send' }
    const before = it.state
    it.state = 'sending'; this.save()
    try {
      await replyInThread(permalink, body.slice(0, 4000), w.orgId)
      it.draft = body; it.state = 'sent'
      this.log(w, `You sent a reply to ${it.author}`, undefined, { detail: body, link: permalink })
      return null
    } catch (e) { it.state = before; this.save(); return { error: (e as Error).message } }
  }

  // Hand the request to the linked session: it does the work (runs the checks)
  // and posts the real result in the thread itself.
  delegate(id: string, permalink: string, auto = false): { error: string } | null {
    const w = this.items.find(x => x.id === id)
    const it = w?.items.find(i => i.permalink === permalink)
    if (!w || !it) return { error: 'Not found' }
    if (!w.liveId || !liveSessionStore.get(w.liveId)) return { error: 'Link a session to this watcher first' }
    if (it.state === 'delegated' || it.state === 'sending') return { error: 'Already handed off' }
    const text = it.text.replace(/\s+/g, ' ').slice(0, 1500)
    sendWhenReady(w.liveId,
      `Slack request in #${w.channel.name} from ${it.author} (${it.permalink}): "${text}". ` +
      'Do the work needed to answer it (run the checks, read the code or logs). Then reply in that Slack thread with the Slack connector, with the actual results. ' +
      'Report only what you verified; if something failed or you could not check it, say so plainly. Do not promise to do it later.')
    it.state = 'delegated'
    this.log(w, `${auto ? 'Needed real work: sent' : 'You sent'} ${it.author}'s request to the session`, undefined, { detail: it.text, link: it.permalink })
    return null
  }

  dismiss(id: string, permalink: string) {
    const w = this.items.find(x => x.id === id)
    const it = w?.items.find(i => i.permalink === permalink)
    if (w && it) { it.state = 'dismissed'; this.log(w, `You dismissed ${it.author}'s question`, undefined, { link: permalink }) }
  }

  redraft(id: string, permalink: string) {
    const w = this.items.find(x => x.id === id)
    const it = w?.items.find(i => i.permalink === permalink)
    if (w && it) { it.state = 'drafting'; it.error = undefined; this.save(); this.draft(w, permalink) }
  }
}

declare global { var __slackWatchers: SlackWatcherEngine | undefined }
export const slackWatchers: SlackWatcherEngine = global.__slackWatchers ?? (global.__slackWatchers = new SlackWatcherEngine())
