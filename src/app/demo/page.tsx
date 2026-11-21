'use client'
// Dev-only: real components with made-up data, for website / README screenshots.
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { PipelinePage } from '../components/PipelinePage'
import { TaskBoard } from '../components/TaskBoard'
import type { Pipeline, PrTrack } from '@/lib/pipelines'
import type { Task } from '@/lib/taskStore'
import type { LiveSessionInfo } from '@/hooks/useTerminal'

const now = Date.now()
const m = (min: number) => now - min * 60_000

const pipeline: Pipeline = {
  id: 'demo', liveId: 'demo', template: 'ship-it',
  config: { slackChannel: { id: 'C0', name: 'ledger-reviews' }, maxRounds: 3, auto: { openPr: true, review: true, ci: true, merge: false } },
  phase: 'tracking', workingOn: null, actedAt: m(9), createdAt: m(120), updatedAt: m(1),
  prs: [
    {
      url: 'https://github.com/tidewater/ledger/pull/482', state: 'in-review', seenFeedback: 4, reviewRounds: 1, ciFixes: 1,
      view: { number: 482, title: 'Retry failed invoice webhooks with exponential backoff', state: 'OPEN', isDraft: false, reviewDecision: null, checks: 'passing',
        requested: ['tomas-reyes'], reviews: [{ login: 'mira-osei', state: 'CHANGES_REQUESTED', at: null }, { login: 'copilot-pull-request-reviewer[bot]', state: 'COMMENTED', at: null }], fetchedAt: m(1) },
      slack: { channel: 'ledger-reviews', permalink: 'https://example.slack.com/archives/C0/p1', checkedAt: m(2), reviewers: ['Tomás'], reactions: [],
        replies: [{ user: 'Mira', text: 'Left two notes on the retry cap, otherwise looks good' }, { user: 'Tomás', text: 'Taking a look after standup' }] },
    },
    {
      url: 'https://github.com/tidewater/ledger/pull/479', state: 'ready', seenFeedback: 2, reviewRounds: 0, ciFixes: 0,
      suggestion: { kind: 'merge', text: 'https://github.com/tidewater/ledger/pull/479 is approved and CI is green. Merge it with gh pr merge, using the merge method this repo uses, and delete the branch.', at: m(3) },
      view: { number: 479, title: 'Add idempotency keys to the payouts API', state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', checks: 'passing',
        requested: [], reviews: [{ login: 'mira-osei', state: 'APPROVED', at: null }, { login: 'jun-park', state: 'APPROVED', at: null }], fetchedAt: m(1) },
      slack: { channel: 'ledger-reviews', permalink: 'https://example.slack.com/archives/C0/p2', checkedAt: m(2), reviewers: ['Mira', 'Jun'], reactions: [], replies: [{ user: 'Jun', text: 'Approved, nice cleanup' }] },
    },
  ],
  log: [
    { t: m(118), text: 'Started' },
    { t: m(96), text: 'Automatic: asking the session to open a PR' },
    { t: m(90), text: 'PR opened tidewater/ledger#479' },
    { t: m(89), text: 'Posted tidewater/ledger#479 to #ledger-reviews' },
    { t: m(41), text: 'PR opened tidewater/ledger#482' },
    { t: m(33), text: 'CI failing on tidewater/ledger#482' },
    { t: m(33), text: 'Automatic: fix CI on tidewater/ledger#482' },
    { t: m(14), text: 'New review feedback on tidewater/ledger#482' },
    { t: m(14), text: 'Automatic: fix review comments on tidewater/ledger#482' },
    { t: m(9), text: 'Session finished work on tidewater/ledger#482' },
    { t: m(3), text: 'tidewater/ledger#479 approved and CI is green. Ready to merge' },
  ],
}

// /demo?scene=board: one task walks the board (To do → In progress → Your review → PR in review → Ready to merge)
const REPO = '/home/dev/tidewater/ledger'
const task = (id: string, title: string, min: number, extra: Partial<Task> = {}): Task =>
  ({ id, title, details: '', cwd: REPO, worktree: true, ship: true, orgId: 'default', liveId: null, done: false, createdAt: m(min), ...extra })
const session = (id: string, status: LiveSessionInfo['status'], branch: string): LiveSessionInfo =>
  ({ id, cwd: REPO, gitRoot: REPO, status, claudeSessionId: null, createdAt: m(30), prUrl: null, orgId: 'default', worktree: { branch, repo: REPO } })
const shipIt = (id: string, liveId: string, prs: PrTrack[], phase: Pipeline['phase'] = 'tracking'): Pipeline =>
  ({ id, liveId, template: 'ship-it', config: { slackChannel: { id: 'C0', name: 'ledger-reviews' }, maxRounds: 3 }, phase, prs, workingOn: null, actedAt: m(5), log: [], createdAt: m(60), updatedAt: m(1) })
const pr = (n: number, title: string, state: PrTrack['state'], checks: 'pending' | 'passing', approved: boolean, slack: boolean): PrTrack => ({
  url: `https://github.com/tidewater/ledger/pull/${n}`, state, seenFeedback: 0, reviewRounds: 0, ciFixes: 0,
  suggestion: state === 'ready' ? { kind: 'merge', text: '', at: m(0) } : null,
  view: { number: n, title, state: 'OPEN', isDraft: false, reviewDecision: approved ? 'APPROVED' : null, checks, requested: [],
    reviews: approved ? [{ login: 'mira-osei', state: 'APPROVED', at: null }] : [], fetchedAt: m(0) },
  slack: slack ? { channel: 'ledger-reviews', permalink: null, checkedAt: m(1) } : undefined,
})

const HERO = 'Retry failed invoice webhooks with exponential backoff'
const STEPS_MS = [1800, 4600, 6800, 9000, 11000] // start, needs review, PR opened, CI green, approved
function boardAt(step: number) {
  const tasks = [
    task('t1', 'Fix currency rounding in the CSV export', 50, { liveId: 's1' }),
    task('t2', 'Add idempotency keys to the payouts API', 90, { liveId: 's2' }),
    task('t3', HERO, 20, step >= 1 ? { liveId: 'hero' } : {}),
    task('t4', 'Rate-limit the public export endpoint', 10),
    task('t5', 'Document the refund state machine', 5, { cwd: 'general', worktree: false, ship: false }),
    task('t6', 'Upgrade the test runner to Node 22', 200, { liveId: 's3', done: true, doneAt: m(40) }),
  ]
  const sessions = [
    session('s1', 'thinking', 'csv-rounding'), session('s2', 'idle', 'payout-idempotency'), session('s3', 'idle', 'node-22'),
    ...(step >= 1 ? [session('hero', step === 1 ? 'thinking' : step === 2 ? 'waiting' : 'idle', 'webhook-retries')] : []),
  ]
  const pipelines = [
    shipIt('p2', 's2', [pr(479, 'Add idempotency keys to the payouts API', 'in-review', 'passing', false, true)]),
    ...(step === 2 ? [shipIt('ph', 'hero', [], 'waiting-for-session')] : []),
    ...(step >= 3 ? [shipIt('ph', 'hero', [pr(486, HERO, step >= 5 ? 'ready' : 'in-review', step >= 4 ? 'passing' : 'pending', step >= 5, step >= 4)])] : []),
  ]
  return { tasks, sessions, pipelines }
}

function BoardScene() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timers = STEPS_MS.map((ms, i) => setTimeout(() => setStep(i + 1), ms))
    return () => timers.forEach(clearTimeout)
  }, [])
  const { tasks, sessions, pipelines } = boardAt(step)
  const noop = () => {}
  return (
    <div className="fixed inset-0">
      <TaskBoard orgId="all" folders={[REPO]} liveSessions={sessions} pipelines={pipelines} demoTasks={tasks}
        onStart={noop} onOpenSession={noop} onReview={noop} onAutomate={noop} onAct={noop} onDismiss={noop} />
    </div>
  )
}

export default function Demo() {
  const [scene, setScene] = useState<string | null>(null)
  useEffect(() => { setScene(new URLSearchParams(location.search).get('scene') ?? 'pipeline') }, [])
  if (process.env.NEXT_PUBLIC_POLYERGON_ENV !== 'dev') notFound()
  if (scene === 'board') return <BoardScene />
  if (!scene) return null
  const noop = () => {}
  return (
    <div className="fixed inset-0">
      <div className="relative w-full h-full">
        <PipelinePage sessionName="ledger: webhook retries" pipeline={pipeline} error={null}
          onOpenSession={noop} onStart={noop} onStop={noop} onAddPr={noop} onSetPrReview={noop} onTell={noop} onAct={noop} onDismiss={noop} onSetAuto={noop} />
      </div>
    </div>
  )
}
