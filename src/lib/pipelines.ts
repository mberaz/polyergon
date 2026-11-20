import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { DATA_DIR } from './dataDir'
import { liveSessionStore } from './liveSessionStore'
import { writeToSession, onAnyStatusChange, onAnyPrUrlChange } from './ptyManager'
import { summarizeChecks } from './ghPrStatus'
import { postToSlack, type SlackChannel } from './slackBridge'
import type { PrCheckStatus } from './prTypes'

const execFileAsync = promisify(execFile)

// Session automations ("⚡ Automate" on a card). One template for now, "Ship it":
//   coding → open PR → post to Slack → loop { address review feedback | fix CI }
//   → approved + green → tell the user it's ready to merge. Never merges.

export type PipelinePhase =
  | 'waiting-for-session' // session still working; act when it goes quiet
  | 'opening-pr'          // asked the session to open a PR; waiting for its URL
  | 'in-review'           // PR open; watching reviews and CI
  | 'working'             // asked the session to address feedback / fix CI
  | 'ready'               // approved + CI green: user merges
  | 'done'                // merged or closed
  | 'needs-you'           // a limit was hit or something failed
  | 'stopped'

export interface PipelineConfig {
  slackChannel: SlackChannel | null
  maxRounds: number // review rounds + CI fixes, each
}

export interface Pipeline {
  id: string
  liveId: string
  template: 'ship-it'
  config: PipelineConfig
  phase: PipelinePhase
  prUrl: string | null
  reviewRounds: number
  ciFixes: number
  seenFeedback: number // review + comment count already handled
  actedAt: number // when we last sent the session work
  log: { t: number; text: string }[]
  createdAt: number
  updatedAt: number
}

export type PipelineEvent = { type: 'pipelines'; items: Pipeline[]; notify?: { title: string; body: string } }

const FILE = join(DATA_DIR, 'pipelines.json')
const POLL_MS = 2 * 60_000
const SETTLE_MS = 20_000 // a session must be quiet this long after we sent it work
const ACTIVE: PipelinePhase[] = ['waiting-for-session', 'opening-pr', 'in-review', 'working']

const PROMPTS = {
  openPr: 'Your work looks finished. Commit it, push the branch, and open a pull request with a clear title and description. Print the PR URL when done.',
  review: (url: string) => `There is new review feedback on ${url}. Read it with gh (reviews and comments), address each point, push the fixes, and reply on the PR to say what changed.`,
  ci: (url: string) => `CI is failing on ${url}. Find the failing checks with gh, fix the cause, and push.`,
}

interface PrSnapshot { state: string; reviewDecision: string | null; checks: PrCheckStatus; feedback: number; title: string }

// Review + comment count from people other than the PR author.
async function prSnapshot(url: string): Promise<PrSnapshot | null> {
  try {
    const env = { ...process.env }
    delete env.GITHUB_TOKEN; delete env.GH_TOKEN
    const { stdout } = await execFileAsync('gh', ['pr', 'view', url, '--json', 'state,reviewDecision,statusCheckRollup,author,reviews,comments,title'], { timeout: 15000, env })
    const j = JSON.parse(stdout)
    const author = j.author?.login
    const others = (xs: { author?: { login?: string } }[] = []) => xs.filter(x => x.author?.login && x.author.login !== author).length
    return { state: j.state, reviewDecision: j.reviewDecision ?? null, checks: summarizeChecks(j.statusCheckRollup ?? []), feedback: others(j.reviews) + others(j.comments), title: j.title ?? '' }
  } catch { return null }
}

class PipelineEngine {
  private items: Pipeline[] = []
  private listeners = new Set<(ev: PipelineEvent) => void>()
  private busy = new Set<string>()
  private started = false

  start() {
    if (this.started) return
    this.started = true
    try { this.items = JSON.parse(readFileSync(FILE, 'utf-8')) } catch { this.items = [] }
    onAnyStatusChange(id => this.items.filter(p => p.liveId === id).forEach(p => this.step(p.id)))
    onAnyPrUrlChange(id => this.items.filter(p => p.liveId === id).forEach(p => this.step(p.id)))
    setInterval(() => this.items.filter(p => ACTIVE.includes(p.phase)).forEach(p => this.step(p.id, true)), POLL_MS)
    this.items.filter(p => ACTIVE.includes(p.phase)).forEach(p => this.step(p.id, true))
  }

  on(fn: (ev: PipelineEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  list(): Pipeline[] { return this.items }

  private save(notify?: PipelineEvent['notify']) {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(this.items, null, 2))
    this.listeners.forEach(fn => fn({ type: 'pipelines', items: this.items, notify }))
  }

  private update(p: Pipeline, patch: Partial<Pipeline>, logText?: string, notify?: PipelineEvent['notify']) {
    Object.assign(p, patch, { updatedAt: Date.now() })
    if (logText) p.log = [...p.log, { t: Date.now(), text: logText }].slice(-50)
    this.save(notify)
  }

  create(liveId: string, config: PipelineConfig): Pipeline | { error: string } {
    const s = liveSessionStore.get(liveId)
    if (!s) return { error: 'Session not found' }
    if (s.backend === 'copilot') return { error: 'Automations support Claude sessions only for now' }
    if (this.items.some(p => p.liveId === liveId && ACTIVE.includes(p.phase))) return { error: 'This session already has a running automation' }
    const p: Pipeline = {
      id: randomUUID(), liveId, template: 'ship-it',
      config: { slackChannel: config.slackChannel, maxRounds: Math.min(10, Math.max(1, Math.round(config.maxRounds) || 3)) },
      phase: s.prUrl ? 'in-review' : 'waiting-for-session', prUrl: s.prUrl ?? null,
      reviewRounds: 0, ciFixes: 0, seenFeedback: -1, actedAt: 0,
      log: [{ t: Date.now(), text: s.prUrl ? `Started. Watching existing PR ${s.prUrl}` : 'Started. Waiting for the session to finish its current work' }],
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    // Keep only the latest few finished runs per session
    this.items = [...this.items.filter(x => x.liveId !== liveId || ACTIVE.includes(x.phase)).slice(-50), p]
    this.save()
    this.step(p.id, true)
    return p
  }

  stop(id: string) {
    const p = this.items.find(x => x.id === id)
    if (p && ACTIVE.includes(p.phase)) this.update(p, { phase: 'stopped' }, 'Stopped by you')
  }

  // Advances one pipeline. Serialized per pipeline; safe to call often.
  async step(id: string, poll = false) {
    if (this.busy.has(id)) return
    this.busy.add(id)
    try { await this.advance(id, poll) } catch (e) {
      const p = this.items.find(x => x.id === id)
      if (p) this.update(p, { phase: 'needs-you' }, `Error: ${(e as Error).message}`, { title: 'Automation needs you', body: (e as Error).message })
    } finally { this.busy.delete(id) }
  }

  private async advance(id: string, poll: boolean) {
    const p = this.items.find(x => x.id === id)
    if (!p || !ACTIVE.includes(p.phase)) return
    const s = liveSessionStore.get(p.liveId)
    if (!s) { this.update(p, { phase: 'needs-you' }, 'Session is gone'); return }
    const quiet = s.status === 'waiting' && Date.now() - p.actedAt > SETTLE_MS
    const send = (text: string, phase: PipelinePhase, patch: Partial<Pipeline>, logText: string) => {
      writeToSession(p.liveId, text + '\r')
      this.update(p, { ...patch, phase, actedAt: Date.now() }, logText)
    }

    if (p.phase === 'waiting-for-session') {
      if (s.prUrl) { this.update(p, { phase: 'in-review', prUrl: s.prUrl }, `PR found: ${s.prUrl}`); return this.announce(p) }
      if (quiet) send(PROMPTS.openPr, 'opening-pr', {}, 'Asked the session to commit, push and open a PR')
      return
    }

    if (p.phase === 'opening-pr') {
      if (s.prUrl) { this.update(p, { phase: 'in-review', prUrl: s.prUrl }, `PR opened: ${s.prUrl}`); return this.announce(p) }
      if (quiet && Date.now() - p.actedAt > 10 * 60_000) this.update(p, { phase: 'needs-you' }, 'The session finished but no PR link appeared', { title: 'Automation needs you', body: 'No PR was opened' })
      return
    }

    if (p.phase === 'working' && !quiet) return // session still on it
    const justBack = p.phase === 'working'
    if (justBack) this.update(p, { phase: 'in-review' }, 'Session finished; back to watching the PR')

    // in-review: only hit GitHub on the poll tick or right after work finished
    if (!poll && !justBack) return
    const url = p.prUrl ?? s.prUrl
    if (!url) return
    const pr = await prSnapshot(url)
    if (!pr) return
    if (p.seenFeedback < 0) { this.update(p, { seenFeedback: pr.feedback }); return }
    if (pr.state === 'MERGED' || pr.state === 'CLOSED') {
      this.update(p, { phase: 'done' }, `PR ${pr.state.toLowerCase()}`, { title: `PR ${pr.state.toLowerCase()}`, body: pr.title }); return
    }
    if (!quiet) return
    const max = p.config.maxRounds
    if (pr.feedback > p.seenFeedback) {
      if (p.reviewRounds >= max) { this.update(p, { phase: 'needs-you', seenFeedback: pr.feedback }, `Review round limit (${max}) reached`, { title: 'Automation needs you', body: `More review feedback on ${pr.title}` }); return }
      return send(PROMPTS.review(url), 'working', { reviewRounds: p.reviewRounds + 1, seenFeedback: pr.feedback }, `New review feedback; asked the session to address it (round ${p.reviewRounds + 1}/${max})`)
    }
    if (pr.checks === 'failing') {
      if (p.ciFixes >= max) { this.update(p, { phase: 'needs-you' }, `CI fix limit (${max}) reached`, { title: 'Automation needs you', body: `CI still failing on ${pr.title}` }); return }
      return send(PROMPTS.ci(url), 'working', { ciFixes: p.ciFixes + 1 }, `CI failing; asked the session to fix it (${p.ciFixes + 1}/${max})`)
    }
    if (pr.reviewDecision === 'APPROVED' && pr.checks !== 'pending') {
      this.update(p, { phase: 'ready' }, 'Approved and CI is green. Ready for you to merge', { title: 'Ready to merge', body: pr.title })
    }
  }

  private async announce(p: Pipeline) {
    const ch = p.config.slackChannel
    if (!ch || !p.prUrl) return
    const pr = await prSnapshot(p.prUrl)
    try {
      await postToSlack(ch, `:eyes: Ready for review: *${pr?.title ?? 'PR'}*\n${p.prUrl}`)
      this.update(p, {}, `Posted to #${ch.name}`)
    } catch (e) {
      this.update(p, {}, `Slack post failed: ${(e as Error).message}`)
    }
  }
}

declare global { var __pipelineEngine: PipelineEngine | undefined }
export const pipelineEngine: PipelineEngine = global.__pipelineEngine ?? (global.__pipelineEngine = new PipelineEngine())
