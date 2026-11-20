'use client'
import { useEffect, useId, useState } from 'react'
import type { SlackChannel } from '@/lib/slackBridge'

// Text box with your Slack channels as suggestions (native <datalist>), loaded
// through the Slack connector and cached by the server.
export function SlackChannelPicker({ value, onChange, onEnter, className }: {
  value: string
  onChange: (v: string, channel: SlackChannel | null) => void
  onEnter?: () => void
  className: string
}) {
  const listId = useId()
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  function load(refresh = false) {
    setState('loading')
    fetch(`/api/slack/channels${refresh ? '?refresh=1' : ''}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setChannels(d.channels); setState('ready') })
      .catch(e => { setError(e.message || 'Could not load channels'); setState('error') })
  }
  useEffect(() => { load() }, [])

  const pick = (v: string) => onChange(v, channels.find(c => c.name === v.replace(/^#/, '')) ?? null)

  return (
    <div>
      <div className="flex gap-1.5">
        <input list={listId} value={value} onChange={e => pick(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onEnter?.() }}
          placeholder={state === 'loading' ? 'Loading your channels…' : 'Type to pick a channel'} className={className} />
        <button onClick={() => load(true)} disabled={state === 'loading'} title="Reload channels from Slack"
          className="px-2 rounded-md border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 text-xs flex-shrink-0">{state === 'loading' ? '…' : '↻'}</button>
      </div>
      <datalist id={listId}>{channels.map(c => <option key={c.id || c.name} value={c.name} />)}</datalist>
      {state === 'loading' && <p className="text-[11px] text-gray-500 mt-1">Asking Slack for your channels. The first time can take up to 2 minutes…</p>}
      {state === 'ready' && <p className="text-[11px] text-gray-600 mt-1">{channels.length} channels</p>}
      {state === 'error' && <p className="text-[11px] text-amber-400 mt-1">{error}</p>}
    </div>
  )
}
