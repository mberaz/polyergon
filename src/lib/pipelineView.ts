// Which steps run on their own (true) vs wait for your click (false)
export interface AutoSteps { openPr: boolean; review: boolean; ci: boolean; merge: boolean; postMerge: boolean }
export const DEFAULT_AUTO: AutoSteps = { openPr: true, review: true, ci: true, merge: false, postMerge: true }
// Which step a suggestion belongs to
export const stepOf = (kind: 'open-pr' | 'review' | 'ci' | 'merge' | 'post-merge'): keyof AutoSteps => kind === 'open-pr' ? 'openPr' : kind === 'post-merge' ? 'postMerge' : kind

// Browser-safe helpers for showing automations (no Node imports here).
import type { Pipeline, PipelinePhase, PrTrackState, PrTrack } from './pipelines'

export const ACTIVE_PHASES: PipelinePhase[] = ['waiting-for-session', 'opening-pr', 'tracking']
export const isRunning = (p: Pipeline | null | undefined) => !!p && ACTIVE_PHASES.includes(p.phase)
export const shortPr = (url: string) => url.replace(/^https:\/\/github\.com\//, '').replace('/pull/', '#')

// Short card label, e.g. "2 PRs · 1 ready · 1 in review"
export function pipelineSummary(p: Pipeline): string {
  const waiting = (p.suggestion ? 1 : 0) + p.prs.filter(t => t.suggestion).length
  const prefix = waiting ? `${waiting} suggestion${waiting > 1 ? 's' : ''} for you · ` : ''
  return prefix + summaryBody(p)
}

function summaryBody(p: Pipeline): string {
  if (p.phase === 'waiting-for-session') return 'watching for a PR'
  if (p.phase === 'opening-pr') return 'session is opening a PR'
  if (p.phase === 'stopped') return 'stopped'
  if (p.phase === 'needs-you' && !p.prs.length) return 'needs you'
  if (p.phase === 'done') return p.prs.length > 1 ? `${p.prs.length} PRs done` : 'done'
  const open = p.prs.filter(t => t.state !== 'done')
  const count = (s: PrTrackState) => open.filter(t => t.state === s).length
  const parts = [
    count('needs-you') && `${count('needs-you')} needs you`,
    count('working') && 'fixing',
    count('ready') && `${count('ready')} ready`,
    count('in-review') && `${count('in-review')} in review`,
  ].filter(Boolean)
  return `${p.prs.length > 1 ? `${p.prs.length} PRs · ` : ''}${parts.join(' · ') || 'in review'}`
}


// PR → Slack → Review → Approved → Merged, as done/current flags for one PR
export function prSteps(t: PrTrack, slack: boolean): { label: string; done: boolean; current: boolean }[] {
  const merged = t.view?.state === 'MERGED'
  const approved = merged || t.view?.reviewDecision === 'APPROVED' || t.state === 'ready'
  // Approval alone isn't mergeable: CI, open review threads and draft also gate it
  const v = t.view
  const ready = merged || t.state === 'ready'
  const blocker = !v ? 'Checking…'
    : v.checks === 'failing' ? 'CI failing'
    : v.checks === 'pending' ? 'CI running'
    : v.unresolved ? `${v.unresolved} open thread${v.unresolved > 1 ? 's' : ''}`
    : v.isDraft ? 'Still a draft'
    : v.blockers?.length ? v.blockers[0][0].toUpperCase() + v.blockers[0].slice(1)
    : 'Ready to merge'
  // A draft isn't up for review yet: that's the step it's on
  if (v?.isDraft && !merged) return [
    { label: 'PR opened', done: true, current: false },
    { label: v.checks === 'failing' ? 'Draft · CI failing' : 'Draft: not ready for review', done: false, current: true },
    ...(slack ? [{ label: 'Posted to Slack', done: !!t.slack, current: false }] : []),
    { label: 'In review', done: false, current: false },
    { label: 'Approved', done: false, current: false },
    { label: 'Merged', done: false, current: false },
  ]
  return [
    { label: 'PR opened', done: true, current: false },
    ...(slack ? [{ label: 'Posted to Slack', done: !!t.slack, current: !t.slack }] : []),
    { label: 'In review', done: approved, current: !approved },
    { label: 'Approved', done: approved, current: false },
    { label: ready ? 'Ready to merge' : blocker, done: ready, current: approved && !ready },
    { label: 'Merged', done: merged, current: ready && !merged },
    ...(merged ? [{ label: t.state === 'done' ? 'Post-merge checks done' : 'Post-merge checks', done: t.state === 'done', current: t.state !== 'done' }] : []),
  ]
}

// Before any PR exists: Watching → PR → Review → Approved → Merged
export function preprSteps(p: Pipeline): { label: string; done: boolean; current: boolean }[] {
  return [
    { label: p.phase === 'opening-pr' ? 'Session is opening a PR' : p.suggestion ? 'Waiting for you to open a PR' : 'Watching for code to ship', done: false, current: true },
    { label: 'PR opened', done: false, current: false },
    { label: 'In review', done: false, current: false },
    { label: 'Approved', done: false, current: false },
    { label: 'Ready to merge', done: false, current: false },
    { label: 'Merged', done: false, current: false },
  ]
}
