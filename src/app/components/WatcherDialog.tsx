'use client'
import { useState } from 'react'
import type { SlackChannel } from '@/lib/slackBridge'
import { SlackChannelPicker } from './SlackChannelPicker'
import { Combobox, type ComboOption } from './Combobox'

// Create a Slack channel watcher.
export function WatcherDialog({ sessions, error, onCreate, onClose }: {
  sessions: ComboOption[]
  error: string | null
  onCreate: (input: { channel: SlackChannel; liveId: string | null; mode: 'approve' | 'auto'; intervalMin: number }) => void
  onClose: () => void
}) {
  const [channelText, setChannelText] = useState('')
  const [channel, setChannel] = useState<SlackChannel | null>(null)
  const [sessionText, setSessionText] = useState('')
  const [liveId, setLiveId] = useState<string | null>(null)
  const [mode, setMode] = useState<'approve' | 'auto'>('approve')
  const [intervalMin, setIntervalMin] = useState(5)
  const input = 'w-full bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm text-white outline-none placeholder-gray-500'
  const name = (channel?.name ?? channelText).replace(/^#/, '').trim()

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold">👂 Watch a Slack channel</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Every few minutes it finds new questions in the channel that nobody answered and drafts a reply.</p>

        <label className="block text-xs text-gray-400 mb-1">Channel</label>
        <SlackChannelPicker value={channelText} onChange={(v, c) => { setChannelText(v); setChannel(c) }} className={input} />

        <label className="block text-xs text-gray-400 mt-4 mb-1">Answer with the knowledge of a session (optional)</label>
        <Combobox options={sessions} value={sessionText} onChange={t => { setSessionText(t); setLiveId(null) }} onPick={o => { setSessionText(o.label); setLiveId(o.id) }}
          placeholder="Type to find a session" className={input} />
        <p className="text-[11px] text-gray-500 mt-1">Drafts come from a copy of that session&apos;s conversation and code. Your session itself is never touched.</p>

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
          <button disabled={!name} onClick={() => { onCreate({ channel: { id: channel?.id ?? '', name }, liveId, mode, intervalMin }); onClose() }}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40">Start watching</button>
        </div>
      </div>
    </div>
  )
}
