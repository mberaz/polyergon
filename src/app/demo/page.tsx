'use client'
// Dev-only: real components with made-up data, for website / README screenshots.
import { notFound } from 'next/navigation'
import { PipelinePage } from '../components/PipelinePage'
import type { Pipeline } from '@/lib/pipelines'

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

export default function Demo() {
  if (process.env.NEXT_PUBLIC_POLYERGON_ENV !== 'dev') notFound()
  const noop = () => {}
  return (
    <div className="fixed inset-0">
      <div className="relative w-full h-full">
        <PipelinePage sessionName="ledger: webhook retries" pipeline={pipeline} error={null}
          onOpenSession={noop} onStart={noop} onStop={noop} onAddPr={noop} onAct={noop} onDismiss={noop} onSetAuto={noop} />
      </div>
    </div>
  )
}
