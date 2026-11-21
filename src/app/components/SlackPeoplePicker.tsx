'use client'
import { useEffect, useState } from 'react'
import { Combobox } from './Combobox'
import { withOrg } from '@/lib/activeOrg'
import type { SlackPerson } from '@/lib/slackBridge'

// Pick people to DM: suggestions from your Slack workspace, shown as chips.
// A picked person is stored as "Name (U123)" so the DM goes to exactly them.
export function SlackPeoplePicker({ value, onChange, className }: { value: string[]; onChange: (v: string[]) => void; className: string }) {
  const [people, setPeople] = useState<SlackPerson[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [text, setText] = useState('')

  function load(refresh = false) {
    setState('loading')
    fetch(withOrg(`/api/slack/people${refresh ? '?refresh=1' : ''}`))
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setPeople(d.people); setState('ready') })
      .catch(() => setState('error'))
  }
  useEffect(() => { load() }, [])

  const add = (v: string) => { const x = v.trim(); if (x && !value.includes(x)) onChange([...value, x]); setText('') }
  const label = (v: string) => v.replace(/ \([UW][A-Z0-9]+\)$/, '')

  return (
    <div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {value.map(v => (
            <span key={v} className="text-[11px] pl-2 pr-1 py-0.5 rounded-full bg-blue-950/60 border border-blue-800/60 text-blue-100 flex items-center gap-1">
              {label(v)}
              <button onClick={() => onChange(value.filter(x => x !== v))} aria-label={`Remove ${label(v)}`} className="text-blue-300 hover:text-white px-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <Combobox
          options={people.filter(p => !value.some(v => v.endsWith(`(${p.id})`))).map(p => ({ id: p.id, label: p.name, hint: p.handle ? `@${p.handle}` : undefined }))}
          value={text}
          onChange={setText}
          onPick={o => add(`${o.label} (${o.id})`)}
          onEnter={() => add(text)}
          placeholder={state === 'loading' ? 'Loading people…' : 'Type a name to add someone'}
          className={className}
        />
        <button onClick={() => load(true)} disabled={state === 'loading'} title="Reload people from Slack"
          className="px-2 rounded-md border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 text-xs flex-shrink-0">{state === 'loading' ? '…' : '↻'}</button>
      </div>
      {state === 'loading' && <p className="text-[11px] text-gray-500 mt-1">Asking Slack for people. The first time can take up to 2 minutes…</p>}
      {state === 'error' && <p className="text-[11px] text-amber-400 mt-1">Couldn't load people from Slack. Type a name and press Enter.</p>}
    </div>
  )
}
