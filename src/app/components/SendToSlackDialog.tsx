'use client'
import { useEffect, useState } from 'react'
import type { SlackChannel } from '@/lib/slackBridge'
import { SlackChannelPicker } from './SlackChannelPicker'

// Preview a meeting's summary as it will look in Slack, pick a channel, send.
export function SendToSlackDialog({ meetingId, title, onClose }: { meetingId: string; title: string; onClose: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [channel, setChannel] = useState<SlackChannel | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/meetings/${meetingId}/slack`).then(async r => {
      const d = await r.json()
      if (!r.ok) { setError(d.error); setState('error') } else setPreview(d.text)
    }).catch(() => { setError('Could not load the summary'); setState('error') })
  }, [meetingId])

  async function send() {
    const name = (channel?.name ?? value).replace(/^#/, '').trim()
    if (!name) return
    setState('sending'); setError('')
    const r = await fetch(`/api/meetings/${meetingId}/slack`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: { id: channel?.id ?? '', name } }),
    })
    const d = await r.json().catch(() => ({}))
    if (r.ok) setState('sent')
    else { setError(d.error ?? 'Could not send'); setState('error') }
  }

  const input = 'w-full bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-md px-2.5 py-1.5 text-sm text-white outline-none placeholder-gray-500'
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold truncate">Send summary to Slack · {title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>
        <label className="block text-xs text-gray-400 mb-1">Channel</label>
        <SlackChannelPicker value={value} onChange={(v, c) => { setValue(v); setChannel(c); if (state !== 'sending') setState('idle') }} onEnter={send} className={input} />
        <p className="text-xs text-gray-400 mt-4 mb-1">Message</p>
        <pre className="text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded-md p-3 whitespace-pre-wrap max-h-72 overflow-y-auto font-sans">{preview ?? (state === 'error' ? '' : 'Loading…')}</pre>
        {state === 'error' && <p className="text-xs text-red-400 mt-3">{error}</p>}
        {state === 'sent' && <p className="text-xs text-green-400 mt-3">Posted to #{(channel?.name ?? value).replace(/^#/, '')}.</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">{state === 'sent' ? 'Close' : 'Cancel'}</button>
          {state !== 'sent' && (
            <button onClick={send} disabled={!preview || !value.trim() || state === 'sending'}
              className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40">{state === 'sending' ? 'Sending…' : 'Send'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
