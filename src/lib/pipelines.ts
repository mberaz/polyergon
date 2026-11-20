import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { DATA_DIR } from './dataDir'
import { liveSessionStore } from './liveSessionStore'
import { writeToSession, onAnyStatusChange, onAnyPrUrlChange } from './ptyManager'
import { summarizeChecks, isValidPrUrl } from './ghPrStatus'
import { postToSlack, readSlackThread, type SlackChannel, type SlackThreadView } from './slackBridge'
import type { PrCheckStatus } from './prTypes'

const execFileAsync = promisify(execFile)

// Session automations ("⚡ Automate" on a card), template "Ship it":
//   session finishes → open a PR → for EVERY PR the session opens (or you add):
//   post to Slack → address review feedback / fix CI within limits → tell you
//   when it's approved and green. Never merges. One session works on one fix at
//   a time, so requests for different PRs queue.

export type PipelinePhase =
  | 'waiting-for-session' // session still working; act when it goes quiet
  | 'opening-pr'          // asked the session to open a PR; waiting for its URL
  | 'tracking'            // watching one or more PRs
  | 'done'                // every tracked PR merged or closed
  | 'needs-you'
  | 'stopped'

export type PrTrackState = 'in-review' | 'working' | 'ready' | 'done' | 'needs-you'

export interface PipelineConfig {
  slackChannel: SlackChannel | null
  maxRounds: number // review rounds + CI fixes, each, per PR
}

// What the dialog shows about a PR (GitHub) and its review post (Slack)
export interface PrView {
  number: number
  title: string
  state: string
  isDraft: boolean
  reviewDecision: string | null
  checks: PrCheckStatus
  requested: string[] // asked to review, not yet reviewed
  reviews: { login: string; state: string; at: string | null }[] // latest per reviewer
  fetchedAt: number
}

export interface SlackView extends Partial<SlackThreadView> {
  channel: string
  permalink: string | null
  checkedAt: number
}

export interface PrTrack {
  url: string
  state: PrTrackState
  view?: PrView
  slack?: SlackView
  seenFeedback: number // review + comment count already handled; -1 = not read yet
  reviewRounds: number
  ciFixes: number
}

export interface Pipeline {
  id: string
  liveId: string
  template: 'ship-it'
  config: PipelineConfig
  phase: PipelinePhase
  prs: PrTrack[]
  workingOn: string | null // PR url the session is fixing right now
  actedAt: number // when we last sent the session work
  log: { t: number; text: string }[]
  createdAt: number
  updatedAt: number
}

export type PipelineEvent = { type: 'pipelines'; items: Pipeline[]; notify?: { title: string; body: string } }

const FILE = join(DATA_DIR, 'pipelines.json')
const POLL_MS = 2 * 60_000
const SETTLE_MS = 20_000 // a session must be quiet this long after we sent it work
const SLACK_CHECK_MS = 10 * 60_000
const QUIET_MS = 15_000 // session must stay 'waiting' this long before we type into it
import { ACTIVE_PHASES } from './pipelineView'
const OPEN_TRACK: PrTrackState[] = ['in-review', 'working', 'ready']

const PROMPTS = {
  openPr: 'Your work looks finished. Commit it, push the branch, and open a pull request with a clear title and description. Print the PR URL when done.',
  review: (url: string) => `There is new review feedback on ${url}. Read it with gh (reviews and comments), address each point, push the fixes, and reply on the PR to say what changed.`,
  ci: (url: string) => `CI is failing on ${url}. Find the failing checks with gh, fix the cause, and push.`,
}

import { shortPr } from './pipelineView'

interface PrSnapshot { state: string; reviewDecision: string | null; checks: PrCheckStatus; feedback: number; title: string; view: PrView }

async function prSnapshot(url: string): Promise<PrSnapshot | null> {
  try {
    const env = { ...process.env }
    delete env.GITHUB_TOKEN; delete env.GH_TOKEN
    const { stdout } = await execFileAsync('gh', ['pr', 'view', url, '--json', 'number,state,isDraft,reviewDecision,statusCheckRollup,author,reviews,latestReviews,reviewRequests,comments,title'], { timeout: 15000, env })
    const j = JSON.parse(stdout)
    const author = j.author?.login
    const others = (xs: { author?: { login?: string } }[] = []) => xs.filter(x => x.author?.login && x.author.login !== author).length
    const checks = summarizeChecks(j.statusCheckRollup ?? [])
    const reviews = (j.latestReviews ?? [])
      .filter((r: { author?: { login?: string } }) => r.author?.login && r.author.login !== author)
      .map((r: { author: { login: string }; state: string; submittedAt?: string }) => ({ login: r.author.login, state: r.state, at: r.submittedAt ?? null }))
    const reviewed = new Set(reviews.map((r: { login: string }) => r.login))
    const requested = (j.reviewRequests ?? []).map((r: { login?: string; name?: string; slug?: string }) => r.login ?? r.name ?? r.slug ?? '').filter((x: string) => x && !reviewed.has(x))
    const view: PrView = { number: j.number, title: j.title ?? '', state: j.state, isDraft: !!j.isDraft, reviewDecision: j.reviewDecision ?? null, checks, requested, reviews, fetchedAt: Date.now() }
    return { state: j.state, reviewDecision: j.reviewDecision ?? null, checks, feedback: others(j.reviews) + others(j.comments), title: j.title ?? '', view }
  } catch { return null }
}

class PipelineEngine {
  private items: Pipeline[] = []
  private listeners = new Set<(ev: PipelineEvent) => void>()
  private busy = new Set<string>()
  private started = false
  private quietSince = new Map<string, number>() // liveId → when it last became 'waiting'

  start() {
    if (this.started) return
    this.started = true
    try { this.items = JSON.parse(readFileSync(FILE, 'utf-8')).filter((p: Pipeline) => Array.isArray(p.prs)) } catch { this.items = [] }
    onAnyStatusChange((id, status) => {
      if (status === 'waiting') { if (!this.quietSince.has(id)) this.quietSince.set(id, Date.now()) } else this.quietSince.delete(id)
      this.forSession(id, p => this.step(p.id))
      // re-check once the quiet period has passed
      if (status === 'waiting') setTimeout(() => this.forSession(id, p => this.step(p.id)), QUIET_MS + 1000)
    })
    onAnyPrUrlChange(id => this.forSession(id, p => this.step(p.id)))
    setInterval(() => this.items.filter(p => ACTIVE_PHASES.includes(p.phase)).forEach(p => this.step(p.id, true)), POLL_MS)
    this.items.filter(p => ACTIVE_PHASES.includes(p.phase)).forEach(p => this.step(p.id, true))
  }

  private forSession(liveId: string, fn: (p: Pipeline) => void) {
    this.items.filter(p => p.liveId === liveId && ACTIVE_PHASES.includes(p.phase)).forEach(fn)
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
    if (logText) p.log = [...p.log, { t: Date.now(), text: logText }].slice(-80)
    this.save(notify)
  }

  private patchTrack(p: Pipeline, t: PrTrack, patch: Partial<PrTrack>, logText?: string, notify?: PipelineEvent['notify']) {
    Object.assign(t, patch)
    this.update(p, {}, logText, notify)
  }

  create(liveId: string, config: PipelineConfig): Pipeline | { error: string } {
    const s = liveSessionStore.get(liveId)
    if (!s) return { error: 'Session not found' }
    if (s.backend === 'copilot') return { error: 'Automations support Claude sessions only for now' }
    if (this.items.some(p => p.liveId === liveId && ACTIVE_PHASES.includes(p.phase))) return { error: 'This session already has a running automation' }
    const p: Pipeline = {
      id: randomUUID(), liveId, template: 'ship-it',
      config: { slackChannel: config.slackChannel, maxRounds: Math.min(10, Math.max(1, Math.round(config.maxRounds) || 3)) },
      phase: 'waiting-for-session', prs: [], workingOn: null, actedAt: 0,
      log: [{ t: Date.now(), text: 'Started' }],
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    this.items = [...this.items.filter(x => x.liveId !== liveId || ACTIVE_PHASES.includes(x.phase)).slice(-50), p]
    if (s.prUrl) this.addTrack(p, s.prUrl, 'Found existing PR')
    this.save()
    this.step(p.id, true)
    return p
  }

  // Track another PR on a running automation (from the dialog).
  addPr(id: string, url: string): { error: string } | null {
    const p = this.items.find(x => x.id === id)
    if (!p || !ACTIVE_PHASES.includes(p.phase)) return { error: 'Automation is not running' }
    if (!isValidPrUrl(url)) return { error: 'Not a GitHub pull request URL' }
    this.addTrack(p, url, 'You added')
    this.step(p.id, true)
    return null
  }

  private addTrack(p: Pipeline, url: string, why: string) {
    if (p.prs.some(t => t.url === url)) return
    const t: PrTrack = { url, state: 'in-review', seenFeedback: -1, reviewRounds: 0, ciFixes: 0 }
    p.prs = [...p.prs, t]
    p.phase = 'tracking'
    this.update(p, {}, `${why} ${shortPr(url)}`)
    this.announce(p, t)
  }

  stop(id: string) {
    const p = this.items.find(x => x.id === id)
    if (p && ACTIVE_PHASES.includes(p.phase)) this.update(p, { phase: 'stopped', workingOn: null }, 'Stopped by you')
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
    if (!p || !ACTIVE_PHASES.includes(p.phase)) return
    const s = liveSessionStore.get(p.liveId)
    if (!s) { this.update(p, { phase: 'needs-you' }, 'Session is gone'); return }
    const since = this.quietSince.get(p.liveId) ?? (s.status === 'waiting' ? 0 : Infinity)
    const quiet = s.status === 'waiting' && Date.now() - since >= QUIET_MS && Date.now() - p.actedAt > SETTLE_MS
    const send = (text: string, logText: string, patch: Partial<Pipeline> = {}) => {
      writeToSession(p.liveId, text + '\r')
      this.update(p, { ...patch, actedAt: Date.now() }, logText)
    }

    // Any PR link the session printed becomes a tracked PR
    if (s.prUrl && !p.prs.some(t => t.url === s.prUrl)) this.addTrack(p, s.prUrl, p.prs.length ? 'New PR' : 'PR opened')

    if (p.phase === 'waiting-for-session') {
      if (quiet) send(PROMPTS.openPr, 'Asked the session to commit, push and open a PR', { phase: 'opening-pr' })
      return
    }
    if (p.phase === 'opening-pr') {
      if (quiet && Date.now() - p.actedAt > 10 * 60_000) this.update(p, { phase: 'needs-you' }, 'The session finished but no PR link appeared', { title: 'Automation needs you', body: 'No PR was opened' })
      return
    }

    // tracking
    const busyOn = p.workingOn ? p.prs.find(t => t.url === p.workingOn) : null
    if (busyOn && !quiet) return // session still on it
    let refresh = poll
    if (busyOn) {
      this.patchTrack(p, busyOn, { state: 'in-review' }, `Session finished work on ${shortPr(busyOn.url)}`)
      this.update(p, { workingOn: null })
      refresh = true
    }
    if (!refresh) return

    // Refresh every open PR, then pick at most one thing for the session to do
    let action: { track: PrTrack; kind: 'review' | 'ci'; feedback: number } | null = null
    for (const t of p.prs.filter(t => OPEN_TRACK.includes(t.state))) {
      const pr = await prSnapshot(t.url)
      if (!pr) continue
      this.patchTrack(p, t, { view: pr.view })
      this.refreshSlack(p, t)
      if (pr.state === 'MERGED' || pr.state === 'CLOSED') {
        this.patchTrack(p, t, { state: 'done' }, `${shortPr(t.url)} ${pr.state.toLowerCase()}`, { title: `PR ${pr.state.toLowerCase()}`, body: pr.title })
        continue
      }
      if (t.seenFeedback < 0) { this.patchTrack(p, t, { seenFeedback: pr.feedback }); continue }
      const max = p.config.maxRounds
      if (pr.feedback > t.seenFeedback) {
        if (t.reviewRounds >= max) { this.patchTrack(p, t, { state: 'needs-you', seenFeedback: pr.feedback }, `${shortPr(t.url)}: review round limit (${max}) reached`, { title: 'Automation needs you', body: `More review feedback on ${pr.title}` }); continue }
        action ??= { track: t, kind: 'review', feedback: pr.feedback }
        continue
      }
      if (pr.checks === 'failing') {
        if (t.ciFixes >= max) { this.patchTrack(p, t, { state: 'needs-you' }, `${shortPr(t.url)}: CI fix limit (${max}) reached`, { title: 'Automation needs you', body: `CI still failing on ${pr.title}` }); continue }
        action ??= { track: t, kind: 'ci', feedback: pr.feedback }
        continue
      }
      if (pr.reviewDecision === 'APPROVED' && pr.checks !== 'pending' && t.state !== 'ready') {
        this.patchTrack(p, t, { state: 'ready' }, `${shortPr(t.url)} approved and CI is green. Ready for you to merge`, { title: 'Ready to merge', body: pr.title })
      } else if (t.state === 'ready' && pr.reviewDecision !== 'APPROVED') {
        this.patchTrack(p, t, { state: 'in-review' }, `${shortPr(t.url)} is no longer approved`)
      }
    }

    if (action && quiet && !p.workingOn) {
      const { track: t, kind, feedback } = action
      const max = p.config.maxRounds
      if (kind === 'review') {
        this.patchTrack(p, t, { state: 'working', reviewRounds: t.reviewRounds + 1, seenFeedback: feedback })
        send(PROMPTS.review(t.url), `New review feedback on ${shortPr(t.url)}; asked the session to address it (round ${t.reviewRounds}/${max})`, { workingOn: t.url })
      } else {
        this.patchTrack(p, t, { state: 'working', ciFixes: t.ciFixes + 1 })
        send(PROMPTS.ci(t.url), `CI failing on ${shortPr(t.url)}; asked the session to fix it (${t.ciFixes}/${max})`, { workingOn: t.url })
      }
    }

    if (p.prs.length && p.prs.every(t => t.state === 'done')) this.update(p, { phase: 'done' }, 'All PRs are merged or closed', { title: 'Automation finished', body: `${p.prs.length} PR(s) done` })
  }

  private async announce(p: Pipeline, t: PrTrack) {
    const ch = p.config.slackChannel
    if (!ch) return
    const pr = await prSnapshot(t.url)
    if (pr) this.patchTrack(p, t, { view: pr.view })
    try {
      const { permalink } = await postToSlack(ch, `:eyes: Ready for review: *${pr?.title ?? 'PR'}*\n${t.url}`)
      this.patchTrack(p, t, { slack: { channel: ch.name, permalink, checkedAt: Date.now() } }, `Posted ${shortPr(t.url)} to #${ch.name}`)
    } catch (e) {
      this.update(p, {}, `Slack post for ${shortPr(t.url)} failed: ${(e as Error).message}`)
    }
  }

  // Who's reviewing, from the Slack post's thread and reactions (every 10 min).
  private async refreshSlack(p: Pipeline, t: PrTrack) {
    if (!t.slack?.permalink || Date.now() - t.slack.checkedAt < SLACK_CHECK_MS) return
    const slack = { ...t.slack, checkedAt: Date.now() }
    this.patchTrack(p, t, { slack }) // claim the slot before the slow call
    try {
      const view = await readSlackThread(slack.permalink!)
      if (view) this.patchTrack(p, t, { slack: { ...slack, ...view } })
    } catch { /* next round */ }
  }
}

declare global { var __pipelineEngine: PipelineEngine | undefined }
export const pipelineEngine: PipelineEngine = global.__pipelineEngine ?? (global.__pipelineEngine = new PipelineEngine())
