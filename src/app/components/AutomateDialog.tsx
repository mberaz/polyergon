'use client'
import { useState } from 'react'
import type { Pipeline, PipelineConfig } from '@/lib/pipelines'
import type { SlackChannel } from '@/lib/slackBridge'
import { SlackChannelPicker } from './SlackChannelPicker'

export const PHASE_LABEL: Record<Pipeline['phase'], string> = {
  'waiting-for-session': 'waiting for the session to finish',
  'opening-pr': 'opening a PR',
  'in-review': 'in review',
  working: 'session is addressing feedback',
  ready: 'ready to merge',
  done: 'done',
  'needs-you': 'needs you',
  stopped: 'stopped',
}

const STEPS = [
  'When the session finishes its current work, ask it to commit, push and open a PR',
  'Post "ready for review" with the PR link to your Slack channel',
  'When reviewers leave feedback, ask the session to address it and push',
  'When CI fails, ask the session to fix it',
  'When the PR is approved and CI is green, notify you. You merge.',
]

// Start a "Ship it" automation on a session, or watch / stop the running one.
export function AutomateDialog({ sessionName, pipeline, error, onStart, onStop, onClose }: {
  sessionName: string
  pipeline: Pipeline | null
  error: string | null
  onStart: (config: PipelineConfig) => void
  onStop: (id: string) => void
  onClose: () => void
}) {
  const [channelText, setChannelText] = useState('')
  const [channel, setChannel] = useState<SlackChannel | null>(null)
  const [maxRounds, setMaxRounds] = useState(3)
  const running = pipeline && ['waiting-for-session', 'opening-pr', 'in-review', 'working'].includes(pipeline.phase)
  const input = 'w-full bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm text-white outline-none placeholder-gray-500'

  function start() {
    const name = (channel?.name ?? channelText).replace(/^#/, '').trim()
    onStart({ slackChannel: name ? { id: channel?.id ?? '', name } : null, maxRounds })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold">⚡ Automate · Ship it</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4 truncate">{sessionName}</p>

        {pipeline && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${pipeline.phase === 'ready' || pipeline.phase === 'done' ? 'bg-emerald-500/15 text-emerald-300' : pipeline.phase === 'needs-you' ? 'bg-amber-500/15 text-amber-300' : running ? 'bg-blue-500/15 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>
                {PHASE_LABEL[pipeline.phase]}
              </span>
              {pipeline.prUrl && <a href={pipeline.prUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline truncate">{pipeline.prUrl.replace('https://github.com/', '')}</a>}
            </div>
            <ol className="text-xs space-y-1 bg-gray-950 border border-gray-800 rounded-md p-3 max-h-52 overflow-y-auto">
              {pipeline.log.map((l, i) => (
                <li key={i} className="flex gap-2"><span className="text-gray-600 tabular-nums flex-shrink-0">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className="text-gray-300">{l.text}</span></li>
              ))}
            </ol>
          </div>
        )}

        {!running && (
          <>
            <ol className="text-xs text-gray-300 space-y-1.5 mb-4 list-decimal pl-4">
              {STEPS.map(s => <li key={s}>{s}</li>)}
            </ol>
            <label className="block text-xs text-gray-400 mb-1">Slack channel for &quot;ready for review&quot; (optional)</label>
            <SlackChannelPicker value={channelText} onChange={(v, c) => { setChannelText(v); setChannel(c) }} className={input} />
            <label className="block text-xs text-gray-400 mt-3">Max review rounds and CI fixes
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
