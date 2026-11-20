// Browser-safe helpers for showing automations (no Node imports here).
import type { Pipeline, PipelinePhase, PrTrackState } from './pipelines'

export const ACTIVE_PHASES: PipelinePhase[] = ['waiting-for-session', 'opening-pr', 'tracking']
export const isRunning = (p: Pipeline | null | undefined) => !!p && ACTIVE_PHASES.includes(p.phase)
export const shortPr = (url: string) => url.replace(/^https:\/\/github\.com\//, '').replace('/pull/', '#')

// Short card label, e.g. "2 PRs · 1 ready · 1 in review"
export function pipelineSummary(p: Pipeline): string {
  if (p.phase === 'waiting-for-session') return 'waiting for the session to finish'
  if (p.phase === 'opening-pr') return 'opening a PR'
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

