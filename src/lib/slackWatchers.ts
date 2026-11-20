import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DATA_DIR } from './dataDir'
import { liveSessionStore } from './liveSessionStore'
import { orgRegistry } from './orgRegistry'
import { newChannelRequests, draftChannelReply, replyInThread, type SlackChannel } from './slackBridge'

// "Slack channel watcher" automations: every few minutes, find new unanswered
// questions in a channel and draft replies (optionally from a forked copy of a
// session, which never touches the live session). Drafts wait for your Send,
// unless the watcher is set to answer automatically.

export interface WatchItem {
  permalink: string
  author: string
  text: string
  time: string
  state: 'drafting' | 'pending' | 'sent' | 'dismissed' | 'failed'
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
  log: { t: number; text: string }[]
  createdAt: number
}

export type WatcherEvent = { type: 'slack-watchers'; items: SlackWatcher[]; notify?: { title: string; body: string } }

const FILE = join(DATA_DIR, 'slack-watchers.json')

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
  private log(w: SlackWatcher, text: string, notify?: WatcherEvent['notify']) {
    w.log = [...w.log, { t: Date.now(), text }].slice(-60)
    this.save(notify)
  }

  create(input: { channel: SlackChannel; liveId: string | null; mode: 'approve' | 'auto'; intervalMin: number; orgId: string }): SlackWatcher | { error: string } {
    if (!input.channel?.name) return { error: 'Pick a channel' }
    if (input.liveId && !liveSessionStore.get(input.liveId)?.claudeSessionId) return { error: 'That session has no Claude conversation yet' }
    const w: SlackWatcher = {
      id: randomUUID(), channel: input.channel, liveId: input.liveId, orgId: (input.liveId && liveSessionStore.get(input.liveId)?.orgId) || input.orgId, mode: input.mode === 'auto' ? 'auto' : 'approve',
      intervalMin: Math.min(60, Math.max(2, Math.round(input.intervalMin) || 5)), status: 'running',
      lastRunAt: Date.now(), checking: false, items: [], log: [], createdAt: Date.now(),
    }
    this.items = [...this.items, w]
    this.log(w, `Watching #${w.channel.name} for new questions (every ${w.intervalMin} min)`)
    return w
  }

  stop(id: string) {
    const w = this.items.find(x => x.id === id)
    if (w && w.status === 'running') { w.status = 'stopped'; this.log(w, 'Stopped by you') }
  }

  // Check the channel now (also runs on the interval).
  async run(id: string) {
    const w = this.items.find(x => x.id === id)
    if (!w || w.status !== 'running' || w.checking) return
    const since = new Date(w.lastRunAt - 2 * 60_000).toISOString() // small overlap; dedupe below
    w.checking = true; w.lastRunAt = Date.now(); this.save()
    try {
      const seen = new Set(w.items.map(i => i.permalink))
      const fresh = (await newChannelRequests(w.channel, since, w.orgId)).filter(r => !seen.has(r.permalink))
      if (fresh.length) {
        w.items = [...fresh.map(r => ({ ...r, state: 'drafting' as const, draft: null })), ...w.items].slice(0, 100)
        this.log(w, `${fresh.length} new question${fresh.length > 1 ? 's' : ''} in #${w.channel.name}`)
        for (const r of fresh) await this.draft(w, r.permalink)
      }
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
      it.draft = await draftChannelReply(it, w.channel.name, this.ctxFor(w), w.orgId)
      if (w.mode === 'auto') {
        await replyInThread(it.permalink, it.draft, w.orgId)
        it.state = 'sent'
        this.log(w, `Answered ${it.author} automatically`)
      } else {
        it.state = 'pending'
        this.log(w, `Draft ready for ${it.author}`, { title: `#${w.channel.name}: reply ready`, body: `${it.author}: ${it.text.slice(0, 80)}` })
      }
    } catch (e) {
      it.state = 'failed'; it.error = (e as Error).message
      this.save()
    }
  }

  // Your click: post the (possibly edited) draft in the thread.
  async send(id: string, permalink: string, text: string): Promise<{ error: string } | null> {
    const w = this.items.find(x => x.id === id)
    const it = w?.items.find(i => i.permalink === permalink)
    if (!w || !it) return { error: 'Not found' }
    const body = (text || it.draft || '').trim()
    if (!body) return { error: 'Nothing to send' }
    try {
      await replyInThread(permalink, body.slice(0, 4000), w.orgId)
      it.draft = body; it.state = 'sent'
      this.log(w, `You answered ${it.author}`)
      return null
    } catch (e) { return { error: (e as Error).message } }
  }

  dismiss(id: string, permalink: string) {
    const it = this.items.find(x => x.id === id)?.items.find(i => i.permalink === permalink)
    if (it) { it.state = 'dismissed'; this.save() }
  }

  redraft(id: string, permalink: string) {
    const w = this.items.find(x => x.id === id)
    const it = w?.items.find(i => i.permalink === permalink)
    if (w && it) { it.state = 'drafting'; it.error = undefined; this.save(); this.draft(w, permalink) }
  }
}

declare global { var __slackWatchers: SlackWatcherEngine | undefined }
export const slackWatchers: SlackWatcherEngine = global.__slackWatchers ?? (global.__slackWatchers = new SlackWatcherEngine())
