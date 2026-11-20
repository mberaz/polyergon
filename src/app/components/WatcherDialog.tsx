'use client'
import { useState } from 'react'
import type { SlackChannel } from '@/lib/slackBridge'
import { SlackChannelPicker } from './SlackChannelPicker'
import type { ComboOption } from './Combobox'
import type { SlackWatcher } from '@/lib/slackWatchers'

// Create a Slack channel watcher.
export interface WatcherInput { channel: SlackChannel; liveId: string | null; mode: 'approve' | 'auto'; intervalMin: number; knowledge: string; instructions: string }

// New watcher, or edit one (initial set: channel is fixed)
export function WatcherDialog({ sessions, error, onCreate, onClose, initial }: {
  sessions: ComboOption[]
  error: string | null
  onCreate: (input: WatcherInput) => void
  onClose: () => void
  initial?: SlackWatcher
}) {
  const [channelText, setChannelText] = useState(initial ? initial.channel.name : '')
  const [channel, setChannel] = useState<SlackChannel | null>(initial?.channel ?? null)
  const [liveId, setLiveId] = useState<string | null>(initial?.liveId ?? null)
  const [mode, setMode] = useState<'approve' | 'auto'>(initial?.mode ?? 'approve')
  const [intervalMin, setIntervalMin] = useState(initial?.intervalMin ?? 5)
  const [knowledge, setKnowledge] = useState(initial?.knowledge ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const input = 'w-full bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm text-white outline-none placeholder-gray-500'
  const name = (channel?.name ?? channelText).replace(/^#/, '').trim()

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold">{initial ? `Edit #${initial.channel.name} watcher` : 'Watch a Slack channel'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Every few minutes it finds new questions in the channel that nobody answered and drafts a reply.</p>

        <label className="block text-xs text-gray-400 mb-1">Channel</label>
        {initial
          ? <p className="text-sm text-gray-200">#{initial.channel.name}</p>
          : <SlackChannelPicker value={channelText} onChange={(v, c) => { setChannelText(v); setChannel(c) }} className={input} />}

        <label className="block text-xs text-gray-400 mt-4 mb-1">Answer with the knowledge of a session (optional)</label>
        <select value={liveId ?? ''} onChange={e => setLiveId(e.target.value || null)} className={input}
          title="Pick a running session whose work the channel is about. Drafts then use that session's conversation and code.">
          <option value="">None: general knowledge only</option>
          {sessions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {sessions.length === 0 && <p className="text-[11px] text-amber-400/80 mt-1">No running sessions in this org. Start one from New Session to use its knowledge.</p>}
        <p className="text-[11px] text-gray-500 mt-1">Drafts come from a copy of that session&apos;s conversation and code. Your session itself is never touched.</p>

        <label className="block text-xs text-gray-400 mt-4 mb-1" title="Claude checks these before drafting. Web pages, files or folders on this Mac, other Slack channels, or plain notes.">Knowledge sources (optional)</label>
        <textarea value={knowledge} onChange={e => setKnowledge(e.target.value)} rows={3}
          placeholder={'One per line, e.g.\nhttps://docs.example.com/runbook\n/Users/you/repos/infra/docs\n#deployment-runbooks\nProd cluster is aks-tstr-prod-eus2'}
          className={`${input} font-mono text-xs`} />

        <label className="block text-xs text-gray-400 mt-3 mb-1" title="Rules for every reply: tone, what never to promise, who to tag">How to answer (optional)</label>
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={2}
          placeholder="e.g. Never say a deploy is done. Tag @devops for prod changes. Keep it short."
          className={`${input} text-xs`} />

        <div className="flex gap-4 mt-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'approve'} onChange={() => setMode('approve')} />I approve each reply</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'auto'} onChange={() => setMode('auto')} />Answer automatically</label>
        </div>
        {mode === 'auto' && <p className="text-[11px] text-amber-400 mt-1">Replies are posted in Slack as you, without review.</p>}

        <label className="block text-xs text-gray-400 mt-4">Check every
          <span className="flex items-center gap-2 mt-1"><input type="number" min={2} max={60} value={intervalMin} onChange={e => setIntervalMin(Number(e.target.value))} className={`${input} w-20`} /> minutes</span>
        </label>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button disabled={!name} onClick={() => { onCreate({ channel: { id: channel?.id ?? '', name }, liveId, mode, intervalMin, knowledge, instructions }); onClose() }}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40">{initial ? 'Save' : 'Start watching'}</button>
        </div>
      </div>
    </div>
  )
}
