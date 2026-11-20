'use client'
import { useState } from 'react'

// Opt-in "Get updates" email signup. The browser posts straight to polyergon.ai;
// the local server only remembers that we asked (and the email, if given).
const SUBSCRIBE_URL = 'https://polyergon.ai/api/subscribe'

export const rememberUpdates = (updates: { asked: true; email?: string }) =>
  fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }) }).catch(() => {})

export function UpdatesForm({ onDone, onNoThanks }: { onDone: (email: string) => void; onNoThanks?: () => void }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    try {
      const r = await fetch(SUBSCRIBE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), source: 'app' }) })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not subscribe. Try again later.')
      await rememberUpdates({ asked: true, email: email.trim() })
      onDone(email.trim())
    } catch (err) {
      setError(err instanceof TypeError ? 'Could not reach polyergon.ai. Check your connection.' : (err as Error).message)
      setState('error')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <label htmlFor="updates-email" className="block text-xs text-gray-400">Email</label>
      <div className="flex flex-wrap gap-2">
        <input id="updates-email" type="email" required maxLength={254} autoComplete="email" value={email} placeholder="you@example.com"
          onChange={e => { setEmail(e.target.value); setState('idle') }}
          className="flex-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-sm text-white" />
        <button type="submit" disabled={state === 'sending'} className="text-sm px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60">
          {state === 'sending' ? 'Subscribing...' : 'Subscribe'}
        </button>
        {onNoThanks && <button type="button" onClick={onNoThanks} className="text-sm px-3 py-1.5 rounded-md border border-gray-700 hover:bg-gray-800">No thanks</button>}
      </div>
      {state === 'error' && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}

// First-launch card on Home. Dismissing it (either way) means we never ask again.
export function UpdatesCard({ onClose }: { onClose: () => void }) {
  const [done, setDone] = useState(false)
  const noThanks = () => { rememberUpdates({ asked: true }); onClose() }
  return (
    <section className="relative rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-4">
      <button onClick={done ? onClose : noThanks} aria-label="Dismiss" className="absolute top-2 right-3 text-gray-500 hover:text-gray-300">×</button>
      <p className="text-sm font-semibold text-gray-100">Get Polyergon updates by email</p>
      {done
        ? <p className="text-sm text-emerald-300 mt-1">Thanks! You are on the list.</p>
        : <>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">New releases and features, a few times a year. Optional, and you can subscribe later in Settings.</p>
            <UpdatesForm onDone={() => setDone(true)} onNoThanks={noThanks} />
          </>}
    </section>
  )
}
