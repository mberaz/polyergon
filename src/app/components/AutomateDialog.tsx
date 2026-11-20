'use client'
import { useState } from 'react'
import type { Pipeline, PipelineConfig, PrTrack } from '@/lib/pipelines'
import type { SlackChannel } from '@/lib/slackBridge'
import { isRunning, pipelineSummary, shortPr } from '@/lib/pipelineView'
import { SlackChannelPicker } from './SlackChannelPicker'

const STEPS = [
  'When the session finishes its current work, ask it to commit, push and open a PR',
  'For every PR it opens: post "ready for review" with the link to your Slack channel',
  'When reviewers leave feedback, ask the session to address it and push',
  'When CI fails, ask the session to fix it',
  'When a PR is approved and CI is green, notify you. You merge.',
]

const REVIEW_ICON: Record<string, string> = { APPROVED: '✓', CHANGES_REQUESTED: '✗', COMMENTED: '💬', DISMISSED: '–', PENDING: '…' }
const REVIEW_COLOR: Record<string, string> = { APPROVED: 'text-emerald-300', CHANGES_REQUESTED: 'text-red-300', COMMENTED: 'text-gray-300' }
const TRACK_BADGE: Record<PrTrack['state'], [string, string]> = {
  'in-review': ['in review', 'bg-blue-500/15 text-blue-300'],
  working: ['session is fixing', 'bg-blue-500/15 text-blue-300'],
  ready: ['ready to merge', 'bg-emerald-500/15 text-emerald-300'],
  done: ['done', 'bg-gray-700 text-gray-300'],
  'needs-you': ['needs you', 'bg-amber-500/15 text-amber-300'],
}

// PR opened → Slack → In review → Approved → Merged for one PR
function Stepper({ t, slack }: { t: PrTrack; slack: boolean }) {
  const merged = t.view?.state === 'MERGED'
  const approved = merged || t.view?.reviewDecision === 'APPROVED' || t.state === 'ready'
  const steps = [
    { label: 'PR opened', done: true, current: false },
    ...(slack ? [{ label: 'Posted to Slack', done: !!t.slack, current: !t.slack }] : []),
    { label: 'In review', done: approved, current: !approved },
    { label: 'Approved', done: approved, current: false },
    { label: 'Merged', done: merged, current: approved && !merged },
  ]
  return (
    <div className="flex items-start my-3">
      {steps.map((s, i) => (
        <div key={s.label} className="flex-1 flex flex-col items-center text-center relative">
          {i > 0 && <span className={`absolute top-1.5 right-1/2 w-full h-0.5 ${s.done || s.current ? 'bg-blue-500/60' : 'bg-gray-700'}`} />}
          <span className={`relative z-10 w-3.5 h-3.5 rounded-full border-2 ${s.done ? 'bg-emerald-500 border-emerald-500' : s.current ? 'bg-gray-900 border-blue-400 animate-pulse' : 'bg-gray-900 border-gray-600'}`} />
          <span className={`text-[10px] mt-1 leading-tight ${s.done ? 'text-gray-300' : s.current ? 'text-blue-300' : 'text-gray-600'}`}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function PrCard({ t, slackSet, max }: { t: PrTrack; slackSet: boolean; max: number }) {
  const v = t.view
  const [label, cls] = TRACK_BADGE[t.state]
  return (
    <div className="rounded-lg border border-gray-800 p-3">
      <div className="flex items-center gap-2 min-w-0">
        <a href={t.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-gray-100 hover:underline truncate">{v?.title || shortPr(t.url)}</a>
        <span className={`ml-auto flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>{label}</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-0.5">{shortPr(t.url)}{v?.isDraft ? ' · draft' : ''} · review rounds {t.reviewRounds}/{max} · CI fixes {t.ciFixes}/{max}</p>
      <Stepper t={t} slack={slackSet} />
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">GitHub</p>
          {v ? (
            <ul className="space-y-0.5">
              {v.reviews.map(r => (
                <li key={r.login} className={`flex gap-1.5 ${REVIEW_COLOR[r.state] ?? 'text-gray-300'}`}><span className="w-3">{REVIEW_ICON[r.state] ?? '•'}</span>{r.login}<span className="text-gray-500 lowercase">{r.state.replace('_', ' ')}</span></li>
              ))}
              {v.requested.map(r => <li key={r} className="flex gap-1.5 text-gray-400"><span className="w-3">⏳</span>{r}<span className="text-gray-600">requested</span></li>)}
              {!v.reviews.length && !v.requested.length && <li className="text-gray-500">No reviewers yet</li>}
              <li className={`pt-0.5 ${v.checks === 'failing' ? 'text-red-300' : v.checks === 'passing' ? 'text-emerald-300' : 'text-gray-400'}`}>CI: {v.checks === 'none' ? 'no checks' : v.checks}</li>
            </ul>
          ) : <p className="text-gray-500">Loading…</p>}
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Slack{t.slack ? ` · #${t.slack.channel}` : ''}</p>
          {t.slack ? (
            <div className="space-y-1">
              {t.slack.reviewers?.length
                ? <p className="text-gray-200">👀 {t.slack.reviewers.join(', ')}</p>
                : <p className="text-gray-500">{t.slack.reviewers ? 'Nobody has claimed it yet' : 'Checking replies…'}</p>}
              {t.slack.replies?.slice(-2).map((r, i) => <p key={i} className="text-gray-400 line-clamp-2"><span className="text-gray-300">{r.user}:</span> {r.text}</p>)}
              {t.slack.permalink && <a href={t.slack.permalink} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Open thread</a>}
            </div>
          ) : <p className="text-gray-500">{slackSet ? 'Posting…' : 'No channel set'}</p>}
        </div>
      </div>
    </div>
  )
}

// Start a "Ship it" automation on a session, or watch / stop the running one.
export function AutomateDialog({ sessionName, pipeline, error, onStart, onStop, onAddPr, onClose }: {
  sessionName: string
  pipeline: Pipeline | null
  error: string | null
  onStart: (config: PipelineConfig) => void
  onStop: (id: string) => void
  onAddPr: (id: string, url: string) => void
  onClose: () => void
}) {
  const [channelText, setChannelText] = useState('')
  const [channel, setChannel] = useState<SlackChannel | null>(null)
  const [maxRounds, setMaxRounds] = useState(3)
  const [prUrl, setPrUrl] = useState('')
  const running = isRunning(pipeline)
  const input = 'w-full bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm text-white outline-none placeholder-gray-500'

  function start() {
    const name = (channel?.name ?? channelText).replace(/^#/, '').trim()
    onStart({ slackChannel: name ? { id: channel?.id ?? '', name } : null, maxRounds })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold">⚡ Automate · Ship it</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4 truncate">{sessionName}{pipeline ? ` · ${pipelineSummary(pipeline)}` : ''}</p>

        {pipeline && pipeline.prs.length > 0 && (
          <div className="space-y-3 mb-4">
            {pipeline.prs.map(t => <PrCard key={t.url} t={t} slackSet={!!pipeline.config.slackChannel} max={pipeline.config.maxRounds} />)}
          </div>
        )}

        {running && pipeline && (
          <div className="flex gap-2 mb-4">
            <input value={prUrl} onChange={e => setPrUrl(e.target.value)} placeholder="Track another PR: https://github.com/org/repo/pull/123" className={input} />
            <button onClick={() => { onAddPr(pipeline.id, prUrl); setPrUrl('') }} disabled={!prUrl.trim()} className="text-xs px-3 rounded-md border border-gray-700 hover:bg-gray-800 disabled:opacity-40 flex-shrink-0">Add PR</button>
          </div>
        )}

        {pipeline && (
          <details className="mb-4" open={!pipeline.prs.length}>
            <summary className="text-xs text-gray-400 cursor-pointer mb-2">Activity log</summary>
            <ol className="text-xs space-y-1 bg-gray-950 border border-gray-800 rounded-md p-3 max-h-48 overflow-y-auto">
              {pipeline.log.map((l, i) => (
                <li key={i} className="flex gap-2"><span className="text-gray-600 tabular-nums flex-shrink-0">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className="text-gray-300">{l.text}</span></li>
              ))}
            </ol>
          </details>
        )}

        {!running && (
          <>
            <ol className="text-xs text-gray-300 space-y-1.5 mb-4 list-decimal pl-4">
              {STEPS.map(s => <li key={s}>{s}</li>)}
            </ol>
            <label className="block text-xs text-gray-400 mb-1">Slack channel for &quot;ready for review&quot; (optional)</label>
            <SlackChannelPicker value={channelText} onChange={(v, c) => { setChannelText(v); setChannel(c) }} className={input} />
            <label className="block text-xs text-gray-400 mt-3">Max review rounds and CI fixes, per PR
              <input type="number" min={1} max={10} value={maxRounds} onChange={e => setMaxRounds(Number(e.target.value))} className={`${input} mt-1 w-24`} />
            </label>
            <p className="text-[11px] text-gray-500 mt-3">It sends messages to this session and posts to Slack on its own. It never merges. You can stop it any time.</p>
          </>
        )}

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Close</button>
          {running
            ? <button onClick={() => onStop(pipeline!.id)} className="px-3 py-1.5 text-sm rounded-md bg-red-600 hover:bg-red-500">Stop automation</button>
            : <button onClick={start} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500">{pipeline ? 'Start again' : 'Start'}</button>}
        </div>
      </div>
    </div>
  )
}
