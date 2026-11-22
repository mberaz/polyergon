import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { DATA_DIR } from './dataDir'
import { liveSessionStore } from './liveSessionStore'
import { sendWhenReady, onAnyStatusChange, onAnyPrUrlChange } from './ptyManager'
import { summarizeChecks, isValidPrUrl } from './ghPrStatus'
import { postToSlack, dmOnSlack, DM_TARGET, readSlackThread, type SlackChannel, type SlackThreadView } from './slackBridge'
import type { PrCheckStatus } from './prTypes'
import { openPrsOfSession, newPrUrls, openAndMine, prsOfSession } from './sessionPrs'

const execFileAsync = promisify(execFile)

// Is there code to turn into a PR? A git repo with uncommitted changes, commits
// not pushed, or a branch that was never pushed (other than main/master).
export async function hasWorkToShip(cwd: string): Promise<boolean> {
  const git = (...args: string[]) => execFileAsync('git', ['-C', cwd, ...args], { timeout: 10000 }).then(r => r.stdout.trim())
  try {
    if (await git('status', '--porcelain')) return true
    const ahead = await git('rev-list', '--count', '@{u}..HEAD').catch(() => null)
    if (ahead !== null) return Number(ahead) > 0
    const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
    return !['main', 'master', 'HEAD'].includes(branch)
  } catch { return false } // not a git repo
}

// Session automations ("⚡ Automate" on a card), template "Ship it".
// They NEVER type into the session. They watch the session, its PRs (GitHub +
// Slack review post) and CI, and when something needs doing they notify you and
// attach a suggested message; only your click (act()) sends it to the session.

export type PipelinePhase =
  | 'waiting-for-session' // no PR yet; suggests opening one when there is code to ship
  | 'opening-pr'          // you sent the open-PR suggestion; waiting for its URL
  | 'tracking'            // watching one or more PRs
  | 'done'                // every tracked PR merged or closed
  | 'needs-you'
  | 'stopped'

export type PrTrackState = 'in-review' | 'working' | 'ready' | 'verifying' | 'done' | 'needs-you' // verifying: merged, post-merge checks to run

import { DEFAULT_AUTO, type AutoSteps } from './pipelineView'
export { DEFAULT_AUTO, type AutoSteps }

export interface PipelineConfig {
  slackChannel: SlackChannel | null
  maxRounds: number // review rounds + CI fixes, each, per PR
  auto?: AutoSteps // missing = DEFAULT_AUTO
  postMergeOn?: boolean // optional step, off unless you turn it on
  postMergeChecks?: string // what else to verify after a merge (free text)
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
  unresolved?: number // open review threads (comments nobody resolved)
  blockers?: string[] // reviewers not yet satisfied (see reviewBlockersOf)
  reviews: { login: string; state: string; at: string | null }[] // latest per reviewer
  fetchedAt: number
}

export interface SlackView extends Partial<SlackThreadView> {
  channel: string
  permalink: string | null
  checkedAt: number
}

// A message the automation proposes; sent only when you click Send
export interface Suggestion { kind: 'open-pr' | 'review' | 'ci' | 'ready' | 'merge' | 'post-merge'; text: string; at: number }

export interface PrTrack {
  url: string
  state: PrTrackState
  suggestion?: Suggestion | null
  view?: PrView
  slack?: SlackView
  seenFeedback: number // review + comment count already handled; -1 = not read yet
  seenUnresolved?: number // unresolved-thread count we already asked the session about
  copilotRequestedFor?: string // head commit we last asked Copilot to re-review
  readyAskedFor?: string // head commit we last offered 'mark ready' for (a draft)
  reviewRounds: number
  ciFixes: number
  mergeAttempts?: number
  // This PR's own review setup; missing = the automation's channel, no extra reviewers
  review?: PrReview
  dmSent?: string[] // people already DMed about this PR
  postMergeRan?: boolean // went through the post-merge checks step
  closed?: boolean // you closed it: kept as a one-line 'finished' row, not tracked
}

// Where a PR asks for review: a Slack channel (null = don't post) and GitHub reviewers
export interface PrReview { channel: SlackChannel | null; reviewers: string[]; dms?: string[] } // dms: Slack names to DM

export interface Pipeline {
  id: string
  liveId: string
  template: 'ship-it'
  config: PipelineConfig
  phase: PipelinePhase
  prs: PrTrack[]
  workingOn: string | null // PR url you sent the session to work on
  suggestion?: Suggestion | null // open-PR proposal (before any PR exists)
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
const WATCH_PRS_MS = 15_000 // new PR links in the transcript show up within this
const QUIET_MS = 15_000 // session must stay 'waiting' this long before we type into it
import { ACTIVE_PHASES, stepOf } from './pipelineView'
const OPEN_TRACK: PrTrackState[] = ['in-review', 'working', 'ready']

const STEP_NAME: Record<keyof AutoSteps, string> = { openPr: 'open the PR', review: 'fix review comments', ci: 'fix CI', ready: 'mark the draft ready', merge: 'merge', postMerge: 'post-merge checks' }
export const autoOf = (p: { config: PipelineConfig }): AutoSteps => ({ ...DEFAULT_AUTO, ...p.config.auto })
const cleanAuto = (a?: Partial<AutoSteps>): AutoSteps => {
  const m = { ...DEFAULT_AUTO, ...a }
  return { openPr: m.openPr === true, review: m.review === true, ci: m.ci === true, ready: m.ready === true, merge: m.merge === true, postMerge: m.postMerge === true }
}

const PROMPTS = {
  openPr: 'Your work looks finished. Commit it, push the branch, and open a pull request with a clear title and description. Print the PR URL when done.',
  review: (url: string) => `There is new review feedback on ${url}. Read it with gh (reviews and comments), address each point, push the fixes, and reply on the PR to say what changed.`,
  ci: (url: string) => `CI is failing on ${url}. Find the failing checks with gh, fix the cause, and push.`,
  unresolved: (url: string, n: number) => `${url} has ${n} unresolved review thread${n > 1 ? 's' : ''}. Read them with gh (review comments), fix what's needed, push, reply in each thread, and resolve the ones you addressed.`,
  postMerge: (url: string, extra?: string) => `${url} was merged. Run post-merge checks: confirm CI on the main branch passed for the merge commit, and if this repo deploys on merge, follow the deploy until it is rolled out and healthy (rollout status, logs, error rates). ` +
    (extra ? `Also (the owner's instructions for this step): ${extra}. ` : '') + 'Only check: ask me before changing anything in production. Report what you verified and anything that looks wrong.',
  merge: (url: string) => `${url} is approved and CI is green. Merge it with gh pr merge, using the merge method this repo uses, and delete the branch. Print the result.`,
}

import { shortPr } from './pipelineView'

interface PrSnapshot { state: string; reviewDecision: string | null; checks: PrCheckStatus; feedback: number; title: string; view: PrView; unresolved: number; isDraft: boolean; reviewBlockers: string[]; headOid: string; copilotStale: boolean; copilotOnHead: boolean }

// Asks Copilot to review the PR again (it only reviews when requested)
async function requestCopilotReview(url: string): Promise<void> {
  const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN
  // The REST API rejects Copilot as "not a collaborator"; gh knows the special @copilot reviewer
  try { await execFileAsync('gh', ['pr', 'edit', url, '--add-reviewer', '@copilot'], { timeout: 30000, env }) }
  catch (e) { throw new Error(String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').filter(Boolean).at(-1) || 'gh failed') }
}

const isBot = (login: string) => /\[bot\]$|^copilot/i.test(login)

// Every reviewer must be satisfied, not just "one approval":
// nobody's latest review is "changes requested"; Copilot's latest review is on the
// newest commit. Someone who only commented is satisfied once their threads are
// resolved (unresolved threads block separately). Pending requests block too.
export function reviewBlockersOf(reviews: { login: string; state: string; commit: string | null }[], headOid: string, requested: string[]): string[] {
  const out: string[] = []
  for (const r of reviews) {
    if (r.state === 'DISMISSED' || r.state === 'PENDING') continue
    if (isBot(r.login)) { if (r.commit && headOid && r.commit !== headOid) out.push(`${r.login.replace(/-pull-request-reviewer|\[bot\]/g, '')} hasn't reviewed the latest commit`) }
    else if (r.state === 'CHANGES_REQUESTED') out.push(`${r.login} requested changes`)
  }
  for (const who of requested) out.push(`waiting for ${who}`)
  return out
}

// Open review threads + each reviewer's latest review and its commit (GraphQL; `gh pr view` lacks both).
// unresolved -1 / null head = unknown (treated as not ready).
async function reviewGate(url: string, env: NodeJS.ProcessEnv): Promise<{ unresolved: number; headOid: string; reviews: { login: string; state: string; commit: string | null }[] }> {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!m) return { unresolved: -1, headOid: '', reviews: [] }
  try {
    const { stdout } = await execFileAsync('gh', ['api', 'graphql',
      '-f', 'query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){headRefOid reviewThreads(first:100){nodes{isResolved}} latestReviews(first:50){nodes{author{login} state commit{oid}}}}}}',
      '-F', `o=${m[1]}`, '-F', `r=${m[2]}`, '-F', `n=${m[3]}`], { timeout: 15000, env })
    const pr = JSON.parse(stdout).data.repository.pullRequest
    return {
      unresolved: (pr.reviewThreads.nodes as { isResolved: boolean }[]).filter(n => !n.isResolved).length,
      headOid: pr.headRefOid ?? '',
      reviews: ((pr.latestReviews?.nodes ?? []) as { author?: { login?: string }; state: string; commit?: { oid?: string } }[])
        .filter(r => r.author?.login).map(r => ({ login: r.author!.login!, state: r.state, commit: r.commit?.oid ?? null })),
    }
  } catch { return { unresolved: -1, headOid: '', reviews: [] } }
}

// mustReview: reviewers you chose in Polyergon. Only their pending requests block;
// ones GitHub added on its own (CODEOWNERS, team auto-assign) don't.
async function prSnapshot(url: string, mustReview: string[] = []): Promise<PrSnapshot | null> {
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
    const gate = await reviewGate(url, env)
    const unresolved = gate.unresolved
    // Only named people block when requested; team requests (CODEOWNERS) often linger after approval
    const requestedPeople = (j.reviewRequests ?? []).map((r: { login?: string }) => r.login ?? '').filter((x: string) => x && !reviewed.has(x) && mustReview.some(m => m.toLowerCase() === x.toLowerCase()))
    const reviewBlockers = reviewBlockersOf(gate.reviews.filter(r => r.login !== author), gate.headOid, requestedPeople)
    const view: PrView = { number: j.number, title: j.title ?? '', state: j.state, isDraft: !!j.isDraft, reviewDecision: j.reviewDecision ?? null, checks, requested, reviews, fetchedAt: Date.now(), unresolved: Math.max(0, unresolved), blockers: reviewBlockers }
    return { state: j.state, reviewDecision: j.reviewDecision ?? null, checks, feedback: others(j.reviews) + others(j.comments), title: j.title ?? '', view, unresolved, isDraft: !!j.isDraft, reviewBlockers, headOid: gate.headOid, copilotStale: reviewBlockers.some(b => /^copilot hasn't reviewed the latest commit/.test(b)), copilotOnHead: gate.reviews.some(r => isBot(r.login) && r.commit === gate.headOid) }
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
      // You picked the session back up after it stopped on "needs you": resume watching
      if (status === 'thinking') {
        this.items.filter(p => p.liveId === id && p.phase === 'needs-you').forEach(p =>
          this.update(p, { phase: p.prs.length ? 'tracking' : 'waiting-for-session', actedAt: Date.now() }, 'Session is working again; waiting for it to finish'))
      }
      this.forSession(id, p => { this.step(p.id); void this.watchPrs(p) })
      // re-check once the quiet period has passed
      if (status === 'waiting') setTimeout(() => this.forSession(id, p => this.step(p.id)), QUIET_MS + 1000)
    })
    onAnyPrUrlChange(id => this.forSession(id, p => this.step(p.id)))
    setInterval(() => this.items.filter(p => ACTIVE_PHASES.includes(p.phase)).forEach(p => this.step(p.id, true)), POLL_MS)
    // New PR links in the transcript, read incrementally: on every status change and every 15s
    setInterval(() => this.items.filter(p => ACTIVE_PHASES.includes(p.phase)).forEach(p => void this.watchPrs(p)), WATCH_PRS_MS)
    this.items.filter(p => ACTIVE_PHASES.includes(p.phase)).forEach(p => { this.step(p.id, true); void this.findOpenPrs(p) })
  }

  private prOffset = new Map<string, number>() // pipeline id → transcript bytes already read
  private prChecked = new Set<string>() // URLs already looked up (not yours / not open)

  // New PR links written since the last look; each new one is checked once on GitHub.
  private async watchPrs(p: Pipeline) {
    const sid = liveSessionStore.get(p.liveId)?.claudeSessionId
    if (!sid) return
    let found: { urls: string[]; offset: number }
    try { found = newPrUrls(sid, this.prOffset.get(p.id) ?? -1) } catch { return }
    this.prOffset.set(p.id, found.offset)
    const fresh = found.urls.filter(u => !p.prs.some(t => t.url === u) && !this.prChecked.has(u))
    if (!fresh.length) return
    fresh.forEach(u => this.prChecked.add(u))
    const mine = await openAndMine(fresh).catch(() => [] as string[])
    mine.forEach(u => this.prChecked.delete(u))
    let added = false
    for (const u of mine) if (ACTIVE_PHASES.includes(p.phase) && !p.prs.some(t => t.url === u)) { this.newPr(p, u); added = true }
    if (added) this.step(p.id, true)
  }

  // A session often has several PRs open; track each, not just the latest one.
  private async findOpenPrs(p: Pipeline) {
    const sid = liveSessionStore.get(p.liveId)?.claudeSessionId
    if (!sid) return
    const urls = await openPrsOfSession(sid).catch(() => [] as string[])
    if (!ACTIVE_PHASES.includes(p.phase)) return
    let added = false
    // Found, not chosen: no Slack post until you pick this PR's channel (Change)
    for (const u of urls) if (!p.prs.some(t => t.url === u)) { this.newPr(p, u); added = true }
    if (added) this.step(p.id, true)
  }

  // Your "Find PRs" click: open PRs get panels; ones merged since the automation
  // started show as finished lines. Returns what it found.
  async findPrsNow(id: string): Promise<{ added: number; merged: number } | { error: string }> {
    const p = this.items.find(x => x.id === id)
    const sid = p && liveSessionStore.get(p.liveId)?.claudeSessionId
    if (!p || !sid) return { error: 'Session not found' }
    const { open, merged } = await prsOfSession(sid, p.createdAt).catch(() => ({ open: [] as string[], merged: [] as string[] }))
    let added = 0, done = 0
    for (const u of open) if (!p.prs.some(t => t.url === u)) { this.newPr(p, u); added++ }
    for (const u of merged) if (!p.prs.some(t => t.url === u)) {
      p.prs = [...p.prs, { url: u, state: 'done', closed: true, seenFeedback: 0, reviewRounds: 0, ciFixes: 0, review: { channel: null, reviewers: [] } }]
      done++
    }
    this.update(p, {}, `Looked for PRs: ${added} new open, ${done} already merged`)
    if (added) this.step(p.id, true)
    return { added, merged: done }
  }

  // A draft you're happy with: mark it ready for review on GitHub (then it's announced).
  async markReady(id: string, url: string): Promise<{ error: string } | null> {
    const p = this.items.find(x => x.id === id)
    const t = p?.prs.find(x => x.url === url)
    if (!p || !t) return { error: 'PR not found' }
    const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN
    try { await execFileAsync('gh', ['pr', 'ready', url], { timeout: 30000, env }) } catch (e) {
      return { error: String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').at(-1) ?? 'gh pr ready failed' }
    }
    this.update(p, {}, `Marked ${shortPr(url)} ready for review`)
    this.step(p.id, true)
    return null
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
    if ((s.backend ?? 'claude') !== 'claude') return { error: 'Automations support Claude sessions only for now' }
    if (this.items.some(p => p.liveId === liveId && ACTIVE_PHASES.includes(p.phase))) return { error: 'This session already has a running automation' }
    const p: Pipeline = {
      id: randomUUID(), liveId, template: 'ship-it',
      config: { slackChannel: config.slackChannel, maxRounds: Math.min(10, Math.max(1, Math.round(config.maxRounds) || 3)), auto: cleanAuto(config.auto), ...(config.postMergeOn ? { postMergeOn: true } : {}), ...(config.postMergeChecks?.trim() ? { postMergeChecks: config.postMergeChecks.trim().slice(0, 2000) } : {}) },
      phase: 'waiting-for-session', prs: [], workingOn: null, actedAt: 0,
      log: [{ t: Date.now(), text: 'Started' }],
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    this.items = [...this.items.filter(x => x.liveId !== liveId || ACTIVE_PHASES.includes(x.phase)).slice(-50), p]
    if (s.prUrl) this.addTrack(p, s.prUrl, 'Found existing PR')
    this.save()
    this.step(p.id, true)
    void this.findOpenPrs(p)
    return p
  }

  // Track another PR on a running automation (from the dialog).
  addPr(id: string, url: string, review?: PrReview): { error: string } | null {
    const p = this.items.find(x => x.id === id)
    if (!p || !ACTIVE_PHASES.includes(p.phase)) return { error: 'Automation is not running' }
    if (!isValidPrUrl(url)) return { error: 'Not a GitHub pull request URL' }
    this.addTrack(p, url, 'You added', cleanReview(review))
    this.step(p.id, true)
    return null
  }

  // Your free-form instruction about one PR ("notify product: Maya and Noam"),
  // done by the session once it's free.
  instruct(id: string, url: string, text: string): { error: string } | null {
    const p = this.items.find(x => x.id === id)
    const t = p?.prs.find(x => x.url === url)
    if (!p || !t) return { error: 'PR not found' }
    const msg = text.replace(/\s+/g, ' ').trim().slice(0, 4000)
    if (!msg) return { error: 'Write what Claude should do' }
    if (!liveSessionStore.get(p.liveId)) return { error: 'The session is gone' }
    sendWhenReady(p.liveId, `About the pull request ${url}${t.view?.title ? ` ("${t.view.title}")` : ''}: ${msg} ` +
      '— Use gh and the Slack connector as needed. Report back here what you did, and say plainly if something failed.', 3 * 60 * 60_000)
    this.update(p, {}, `You told Claude about ${shortPr(url)}: ${msg.slice(0, 120)}`)
    return null
  }

  // Change one PR's review setup: posts to the new channel and requests the new reviewers.
  setPrReview(id: string, url: string, review: PrReview): { error: string } | null {
    const p = this.items.find(x => x.id === id)
    const t = p?.prs.find(x => x.url === url)
    if (!p || !t) return { error: 'PR not found' }
    const next = cleanReview(review)!
    const before = t.review ?? { channel: p.config.slackChannel, reviewers: [] }
    t.review = next
    const added = next.reviewers.filter(r => !before.reviewers.includes(r))
    this.update(p, {}, `Review for ${shortPr(url)}: ${next.channel ? `#${next.channel.name}` : 'no Slack post'}${next.dms?.length ? `, DM ${next.dms.join(', ')}` : ''}${next.reviewers.length ? `, reviewers ${next.reviewers.join(', ')}` : ''}`)
    if (added.length) this.requestReviewers(p, t, added)
    if (next.channel && next.channel.name !== t.slack?.channel) this.announce(p, t, true)
    else this.announce(p, t) // DMs only; announce holds them while it's a draft
    return null
  }

  // A PR the session opened beyond the first: tracked, but nothing posted until you choose its review.
  private newPr(p: Pipeline, url: string) {
    this.addTrack(p, url, 'New PR found:', { channel: null, reviewers: [] })
    this.update(p, {}, undefined, { title: 'New PR in the automation', body: `${shortPr(url)}: choose where to ask for review` })
  }

  private addTrack(p: Pipeline, url: string, why: string, review?: PrReview) {
    if (p.prs.some(t => t.url === url)) return
    const t: PrTrack = { url, state: 'in-review', seenFeedback: -1, reviewRounds: 0, ciFixes: 0, ...(review ? { review } : {}) }
    p.prs = [...p.prs, t]
    p.phase = 'tracking'
    this.update(p, {}, `${why} ${shortPr(url)}`)
    if (review?.reviewers.length) this.requestReviewers(p, t, review.reviewers)
    this.announce(p, t)
  }

  private async requestReviewers(p: Pipeline, t: PrTrack, logins: string[]) {
    const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN
    try {
      await execFileAsync('gh', ['pr', 'edit', t.url, '--add-reviewer', logins.join(',')], { timeout: 30000, env })
      this.update(p, {}, `Asked ${logins.join(', ')} to review ${shortPr(t.url)}`)
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').filter(Boolean).at(-1)
      this.update(p, {}, `Could not request reviewers on ${shortPr(t.url)}: ${msg}`)
    }
  }

  // You clicked "Send to session" on a suggestion (prUrl = which PR's; none = open-PR)
  act(id: string, prUrl: string | null): { error: string } | null {
    const p = this.items.find(x => x.id === id)
    if (!p) return { error: 'Automation not found' }
    const t = prUrl ? p.prs.find(x => x.url === prUrl) : null
    const sug = prUrl ? t?.suggestion : p.suggestion
    if (!sug) return { error: 'Nothing to send' }
    if (sug.kind === 'ready' && t) { // done on GitHub, not by the session
      this.patchTrack(p, t, { suggestion: null })
      void this.markReady(p.id, t.url)
      return null
    }
    sendWhenReady(p.liveId, sug.text) // wakes it if it fell asleep
    if (t) {
      if (sug.kind === 'review') t.reviewRounds++
      if (sug.kind === 'ci') t.ciFixes++
      if (sug.kind === 'merge') t.mergeAttempts = (t.mergeAttempts ?? 0) + 1
      this.patchTrack(p, t, { suggestion: null, state: sug.kind === 'post-merge' ? 'verifying' : 'working' })
      this.update(p, { workingOn: t.url, actedAt: Date.now() }, `Sent the session: ${sug.kind === 'review' ? 'address review feedback' : sug.kind === 'merge' ? 'merge' : sug.kind === 'post-merge' ? 'post-merge checks' : 'fix CI'} on ${shortPr(t.url)}`)
    } else {
      this.update(p, { suggestion: null, phase: 'opening-pr', actedAt: Date.now() }, 'You sent the session: open a PR')
    }
    return null
  }

  // Change which steps are automatic while it runs
  setAuto(id: string, auto: Partial<AutoSteps>) {
    const p = this.items.find(x => x.id === id)
    if (!p) return
    const next = cleanAuto({ ...autoOf(p), ...auto })
    const on = (Object.keys(next) as (keyof AutoSteps)[]).filter(k => next[k])
    this.update(p, { config: { ...p.config, auto: next } }, `Automatic steps: ${on.length ? on.map(k => STEP_NAME[k]).join(', ') : 'none (everything asks you)'}`)
    this.step(p.id)
  }

  // You're finished with one PR: it folds into a 'finished' row and stops being tracked.
  // reopen = bring it back. The PR on GitHub is untouched either way.
  removePr(id: string, url: string, reopen = false): { error: string } | null {
    const p = this.items.find(x => x.id === id)
    const t = p?.prs.find(x => x.url === url)
    if (!p || !t) return { error: 'PR not found' }
    t.closed = !reopen
    this.update(p, { workingOn: p.workingOn === url && !reopen ? null : p.workingOn }, reopen ? `Brought back ${shortPr(url)}` : `Closed ${shortPr(url)}: finished`)
    if (reopen) this.step(p.id, true)
    return null
  }

  // The optional post-merge step: on/off and what else to verify
  setPostMerge(id: string, on: boolean, checks?: string) {
    const p = this.items.find(x => x.id === id)
    if (!p) return
    const v = (checks ?? p.config.postMergeChecks ?? '').trim().slice(0, 2000)
    this.update(p, { config: { ...p.config, postMergeOn: on, postMergeChecks: v || undefined } }, on ? `Post-merge checks on${v ? `, also verifying: ${v.slice(0, 120)}` : ''}` : 'Post-merge checks off')
  }

  dismiss(id: string, prUrl: string | null) {
    const p = this.items.find(x => x.id === id)
    if (!p) return
    const t = prUrl ? p.prs.find(x => x.url === prUrl) : null
    if (t) this.patchTrack(p, t, { suggestion: null, ...(t.state === 'verifying' ? { state: 'done' as const } : {}) }, `Dismissed suggestion on ${shortPr(t.url)}`)
    else this.update(p, { suggestion: null }, 'Dismissed the open-PR suggestion')
  }

  // Removes a finished or stopped automation from the list. PRs and session are untouched.
  remove(id: string) {
    const p = this.items.find(x => x.id === id)
    if (!p || ACTIVE_PHASES.includes(p.phase)) return
    this.items = this.items.filter(x => x !== p)
    this.save()
  }

  stop(id: string) {
    const p = this.items.find(x => x.id === id)
    if (p && ACTIVE_PHASES.includes(p.phase)) this.update(p, { phase: 'stopped', workingOn: null }, 'Stopped by you')
  }

  // Sends one pending suggestion whose step is automatic, when the session is idle and free.
  // Review/CI fixes stop at maxRounds per PR and then wait for you.
  private autoSend(p: Pipeline, quiet: boolean) {
    if (!quiet || p.workingOn || !ACTIVE_PHASES.includes(p.phase)) return
    const auto = autoOf(p)
    if (p.suggestion?.kind === 'open-pr') {
      if (auto.openPr) { this.update(p, {}, 'Automatic: asking the session to open a PR'); this.act(p.id, null) }
      return
    }
    for (const t of p.prs.filter(t => !t.closed)) {
      const k = t.suggestion?.kind
      if (!k || k === 'open-pr' || !auto[stepOf(k)]) continue
      if (k === 'merge' && (t.mergeAttempts ?? 0) >= 1) continue // auto-merge tries once; then it's yours
      const used = k === 'review' ? t.reviewRounds : k === 'ci' ? t.ciFixes : 0
      if (used >= p.config.maxRounds) {
        if (!p.log.at(-1)?.text.startsWith('Fix limit')) this.update(p, {}, `Fix limit reached (${p.config.maxRounds} rounds) on ${shortPr(t.url)}: click Send to continue`, { title: 'Automation needs you', body: `${shortPr(t.url)} hit ${p.config.maxRounds} fix rounds` })
        continue
      }
      this.update(p, {}, `Automatic: ${STEP_NAME[stepOf(k)]} on ${shortPr(t.url)}`)
      this.act(p.id, t.url)
      return
    }
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
    const suggest = (t: PrTrack | null, kind: Suggestion['kind'], text: string, logText: string, title: string, body: string) => {
      const sug: Suggestion = { kind, text, at: Date.now() }
      if (t) this.patchTrack(p, t, { suggestion: sug }, logText, { title, body })
      else this.update(p, { suggestion: sug }, logText, { title, body })
    }

    // Any PR link the session printed becomes a tracked PR
    if (s.prUrl && !p.prs.some(t => t.url === s.prUrl)) {
      if (p.prs.length) this.newPr(p, s.prUrl) // another PR: you choose its review
      else this.addTrack(p, s.prUrl, 'PR opened')
    }

    if (p.phase === 'waiting-for-session') {
      if (!quiet) return
      if (p.suggestion) { this.autoSend(p, quiet); return } // proposed; sent if open-PR is automatic
      if (await hasWorkToShip(s.cwd)) suggest(null, 'open-pr', PROMPTS.openPr, 'Code is ready to ship; suggested opening a PR', 'Ready to open a PR?', 'Click Send in the automation to ask the session')
      else if (!p.log.at(-1)?.text.startsWith('Waiting: no code changes')) this.update(p, {}, 'Waiting: no code changes to ship yet in this folder')
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
      if (busyOn.state === 'verifying') this.patchTrack(p, busyOn, { state: 'done', postMergeRan: true }, `Post-merge checks finished on ${shortPr(busyOn.url)}: see the session for results`, { title: 'Post-merge checks finished', body: shortPr(busyOn.url) })
      else this.patchTrack(p, busyOn, { state: 'in-review' }, `Session finished work on ${shortPr(busyOn.url)}`)
      this.update(p, { workingOn: null })
      refresh = true
    }
    if (!refresh) return

    // Refresh every open PR, then pick at most one thing for the session to do
    for (const t of p.prs.filter(t => OPEN_TRACK.includes(t.state) && !t.closed)) {
      const pr = await prSnapshot(t.url, t.review?.reviewers ?? [])
      if (!pr) continue
      const wasFailing = t.view?.checks === 'failing' // suggest CI fixes once per failure, not every poll
      const wasDraft = t.view?.isDraft
      this.patchTrack(p, t, { view: pr.view })
      if (wasDraft && !pr.view.isDraft) this.announce(p, t) // marked ready: now ask for review
      this.refreshSlack(p, t)
      if (pr.state === 'MERGED' && p.config.postMergeOn) {
        this.patchTrack(p, t, { state: 'verifying', suggestion: null }, `${shortPr(t.url)} merged`, { title: 'PR merged', body: pr.title })
        suggest(t, 'post-merge', PROMPTS.postMerge(t.url, p.config.postMergeChecks), `Post-merge checks ready for ${shortPr(t.url)}`, 'Run post-merge checks?', `${pr.title}: click Send to ask the session to verify the merge`)
        continue
      }
      if (pr.state === 'MERGED' || pr.state === 'CLOSED') {
        this.patchTrack(p, t, { state: 'done' }, `${shortPr(t.url)} ${pr.state.toLowerCase()}`, { title: `PR ${pr.state.toLowerCase()}`, body: pr.title })
        continue
      }
      if (t.seenFeedback < 0) { this.patchTrack(p, t, { seenFeedback: pr.feedback }); continue }
      if (pr.feedback > t.seenFeedback) {
        if (!t.suggestion) {
          this.patchTrack(p, t, { seenFeedback: pr.feedback })
          suggest(t, 'review', PROMPTS.review(t.url), `New review feedback on ${shortPr(t.url)}`, 'New review feedback', `${pr.title}: click Send to ask the session to address it`)
        }
        continue
      }
      // A green draft: offer (or, on Auto, do) "mark ready for review", once per commit
      if (pr.isDraft && pr.checks === 'passing' && !t.suggestion && pr.headOid && t.readyAskedFor !== pr.headOid) {
        this.patchTrack(p, t, { readyAskedFor: pr.headOid })
        suggest(t, 'ready', 'Mark it ready for review on GitHub', `${shortPr(t.url)} is a draft with green CI`, 'Draft is green', `${pr.title}: mark it ready for review?`)
      }
      if (pr.checks === 'failing') {
        if (!wasFailing && !t.suggestion) suggest(t, 'ci', PROMPTS.ci(t.url), `CI failing on ${shortPr(t.url)}`, 'CI failing', `${pr.title}: click Send to ask the session to fix it`)
        continue
      }
      // Open review threads: ask the session to handle them (once per new count), never call it mergeable
      if (pr.unresolved > 0 && pr.unresolved > (t.seenUnresolved ?? 0) && !t.suggestion && t.state !== 'working') {
        this.patchTrack(p, t, { seenUnresolved: pr.unresolved })
        suggest(t, 'review', PROMPTS.unresolved(t.url, pr.unresolved), `${pr.unresolved} unresolved review thread${pr.unresolved > 1 ? 's' : ''} on ${shortPr(t.url)}`, 'Unresolved review comments', `${pr.title}: ${pr.unresolved} open thread(s)`)
      }
      // Copilot reviewed an older commit: ask it for a fresh review, once per new commit
      if (pr.copilotStale && pr.headOid && t.copilotRequestedFor !== pr.headOid) {
        this.patchTrack(p, t, { copilotRequestedFor: pr.headOid })
        requestCopilotReview(t.url)
          .then(() => this.update(p, {}, `Asked Copilot to review the latest commit on ${shortPr(t.url)}`))
          .catch(e => this.update(p, {}, `Couldn't request a Copilot review on ${shortPr(t.url)}: ${(e as Error).message}`))
      }
      // We asked Copilot for this commit: GitHub hides its old review meanwhile, so wait for the new one
      if (t.copilotRequestedFor && t.copilotRequestedFor === pr.headOid && !pr.copilotOnHead && !pr.copilotStale) { pr.reviewBlockers.push('copilot is reviewing the latest commit'); this.patchTrack(p, t, { view: { ...pr.view, blockers: pr.reviewBlockers } }) }
      // Mergeable only when approved, CI done, not a draft and no open threads (unknown thread count = not ready)
      const blockers = [pr.isDraft && 'still a draft', pr.unresolved !== 0 && (pr.unresolved < 0 ? 'review threads unknown' : `${pr.unresolved} unresolved review thread${pr.unresolved > 1 ? 's' : ''}`), pr.reviewDecision !== 'APPROVED' && 'not approved', pr.checks === 'pending' && 'CI running', ...pr.reviewBlockers].filter(Boolean) as string[]
      if (!blockers.length && t.state !== 'ready') {
        this.patchTrack(p, t, { state: 'ready', suggestion: { kind: 'merge', text: PROMPTS.merge(t.url), at: Date.now() } }, `${shortPr(t.url)} approved, CI green, no open threads. Ready to merge`, { title: 'Ready to merge', body: `${pr.title}: click Merge in the automation` })
      } else if (blockers.length && t.state === 'ready') {
        this.patchTrack(p, t, { state: 'in-review', ...(t.suggestion?.kind === 'merge' ? { suggestion: null } : {}) }, `${shortPr(t.url)} is not ready to merge: ${blockers.join(', ')}`)
      }
    }

    this.autoSend(p, quiet)

    if (p.prs.length && p.prs.every(t => t.state === 'done' || t.closed)) this.update(p, { phase: 'done' }, 'All PRs are merged or closed', { title: 'Automation finished', body: `${p.prs.length} PR(s) done` })
  }

  private async announce(p: Pipeline, t: PrTrack, force = false) {
    const ch = t.review ? t.review.channel : p.config.slackChannel
    const pr = await prSnapshot(t.url, t.review?.reviewers ?? [])
    if (pr) this.patchTrack(p, t, { view: pr.view })
    if (pr?.isDraft) return // drafts aren't up for review; announced when marked ready
    if (ch && (!t.slack?.permalink || force)) {
      try {
        const { permalink } = await postToSlack(ch, `:eyes: Ready for review: *${pr?.title ?? 'PR'}*\n${t.url}`, liveSessionStore.get(p.liveId)?.orgId)
        this.patchTrack(p, t, { slack: { channel: ch.name, permalink, checkedAt: Date.now() } }, `Posted ${shortPr(t.url)} to #${ch.name}`)
      } catch (e) {
        this.update(p, {}, `Slack post for ${shortPr(t.url)} failed: ${(e as Error).message}`)
      }
    }
    await this.sendDms(p, t)
  }

  // DMs each person in this PR's review setup once.
  private async sendDms(p: Pipeline, t: PrTrack) {
    const todo = (t.review?.dms ?? []).filter(d => !(t.dmSent ?? []).includes(d))
    if (!todo.length) return
    t.dmSent = [...(t.dmSent ?? []), ...todo] // claim first: no double DM if called again meanwhile
    const title = t.view?.title ?? (await prSnapshot(t.url))?.title ?? 'PR'
    for (const person of todo) {
      try {
        await dmOnSlack(person, `:eyes: Can you review this? *${title}*\n${t.url}`, liveSessionStore.get(p.liveId)?.orgId)
        this.update(p, {}, `DMed ${person} about ${shortPr(t.url)}`)
      } catch (e) {
        t.dmSent = t.dmSent.filter(x => x !== person)
        this.update(p, {}, `DM to ${person} about ${shortPr(t.url)} failed: ${(e as Error).message}`)
      }
    }
  }

  // Who's reviewing, from the Slack post's thread and reactions (every 10 min).
  private async refreshSlack(p: Pipeline, t: PrTrack) {
    if (!t.slack?.permalink || Date.now() - t.slack.checkedAt < SLACK_CHECK_MS) return
    const slack = { ...t.slack, checkedAt: Date.now() }
    this.patchTrack(p, t, { slack }) // claim the slot before the slow call
    try {
      const view = await readSlackThread(slack.permalink!, liveSessionStore.get(p.liveId)?.orgId)
      if (view) this.patchTrack(p, t, { slack: { ...slack, ...view } })
    } catch { /* next round */ }
  }
}

declare global { var __pipelineEngine: PipelineEngine | undefined }
export const pipelineEngine: PipelineEngine = global.__pipelineEngine ?? (global.__pipelineEngine = new PipelineEngine())

// Trims a review setup from the browser: valid channel or null, logins without @ (teams as org/team)
function cleanReview(r: PrReview | undefined): PrReview | undefined {
  if (!r) return undefined
  const ch = r.channel && typeof r.channel.name === 'string' && r.channel.name.trim() ? { id: String(r.channel.id ?? ''), name: r.channel.name.replace(/^#/, '').trim() } : null
  const reviewers = [...new Set((Array.isArray(r.reviewers) ? r.reviewers : []).map(x => String(x).trim().replace(/^@/, '')).filter(x => /^[\w.-]+(\/[\w.-]+)?$/.test(x)))].slice(0, 15)
  const dms = [...new Set((Array.isArray(r.dms) ? r.dms : []).map(x => String(x).trim().replace(/^@/, '')).filter(x => DM_TARGET.test(x)))].slice(0, 10)
  return { channel: ch, reviewers, ...(dms.length ? { dms } : {}) }
}
