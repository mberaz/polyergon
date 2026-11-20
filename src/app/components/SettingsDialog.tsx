'use client'
import { useEffect, useState } from 'react'
import type { Settings } from '@/lib/settingsStore'
import type { TranscriptionStatus } from '@/lib/meetingConfig'
import { setNotificationsEnabled } from '@/hooks/useDesktopNotifications'

const MIN_K = 100
const MAX_K = 1000

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState(true)
  const [k, setK] = useState(300)
  const [loaded, setLoaded] = useState(false)
  const [notifyOn, setNotifyOn] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [tStatus, setTStatus] = useState<TranscriptionStatus | null>(null)
  const [tProvider, setTProvider] = useState<'none' | 'openai' | 'azure'>('none')
  const [tEndpoint, setTEndpoint] = useState('')
  const [tDeployment, setTDeployment] = useState('')
  const [tKey, setTKey] = useState('')
  const [tDirty, setTDirty] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then((s: Settings) => {
      setEnabled(s.autoCompact.enabled)
      setK(Math.round(s.autoCompact.windowTokens / 1000))
      setNotifyOn(s.notifications?.enabled !== false)
      setLoaded(true)
    }).catch(() => setState('error'))
  }, [])

  useEffect(() => {
    fetch('/api/settings/transcription').then(r => r.json()).then((t: TranscriptionStatus) => {
      setTStatus(t)
      setTProvider(t.provider ?? 'none')
      setTEndpoint(t.endpoint ?? '')
      setTDeployment(t.deployment ?? '')
    }).catch(() => {})
  }, [])

  const editT = <T,>(set: (v: T) => void) => (v: T) => { set(v); setTDirty(true); setState('idle') }

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  }, [])

  const valid = k >= MIN_K && k <= MAX_K

  // Needs the click as a user gesture, or Chrome ignores the request.
  function allowInBrowser() {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then(setPermission)
  }

  async function save() {
    setState('saving')
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoCompact: { enabled, windowTokens: k * 1000 }, notifications: { enabled: notifyOn } }),
      })
      if (!r.ok) throw new Error('Could not save settings')
      if (tDirty) {
        const body = tProvider === 'azure' ? { provider: 'azure', endpoint: tEndpoint, deployment: tDeployment, apiKey: tKey }
          : tProvider === 'openai' ? { provider: 'openai', apiKey: tKey } : { provider: 'none' }
        const tr = await fetch('/api/settings/transcription', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await tr.json()
        if (!tr.ok) throw new Error(data.error ?? 'Could not save transcription')
        setTStatus(data); setTKey(''); setTDirty(false)
      }
      setNotificationsEnabled(notifyOn)
      setState('saved')
    } catch (e) { setErrorMsg((e as Error).message || 'Could not save settings'); setState('error') }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>

        <section className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={enabled} disabled={!loaded} onChange={e => { setEnabled(e.target.checked); setState('idle') }} />
            Auto-compact Claude sessions
          </label>

          <label className={`block text-sm ${enabled ? '' : 'opacity-40'}`}>
            <span className="text-gray-400">Compact when context reaches</span>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number" min={MIN_K} max={MAX_K} step={50} value={k} disabled={!enabled || !loaded}
                onChange={e => { setK(Number(e.target.value)); setState('idle') }}
                className="w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
              />
              <span className="text-gray-400">k tokens</span>
            </div>
            {!valid && <p className="text-xs text-red-400 mt-1">Pick a value from {MIN_K}k to {MAX_K}k.</p>}
          </label>

          <p className="text-xs text-gray-500 leading-relaxed">
            Claude compacts on its own between turns, a little before this limit. Recommended: 250k–300k.
            Applies to sessions started, resumed or restarted after you save. Copilot sessions are not affected.
          </p>
        </section>

        <section className="space-y-2 mt-5 pt-4 border-t border-gray-800">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={notifyOn} disabled={!loaded} onChange={e => { setNotifyOn(e.target.checked); setState('idle') }} />
            Desktop notifications
          </label>
          <p className="text-xs text-gray-500 leading-relaxed">
            Alerts when a session needs your input, and for note reminders.
          </p>
          {notifyOn && permission === 'default' && (
            <button onClick={allowInBrowser} className="text-xs px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700">
              Allow notifications in Chrome
            </button>
          )}
          {notifyOn && permission === 'denied' && (
            <p className="text-xs text-amber-400">Chrome is blocking notifications for this site. Click the icon left of the address bar, then allow Notifications.</p>
          )}
          {notifyOn && permission === 'granted' && <p className="text-xs text-green-400">Chrome permission: allowed</p>}
          {permission === 'unsupported' && <p className="text-xs text-gray-500">This browser does not support notifications.</p>}
        </section>

        <section className="space-y-2 mt-5 pt-4 border-t border-gray-800">
          <p className="text-sm font-medium">Meeting transcription</p>
          <select value={tProvider} onChange={e => editT(setTProvider)(e.target.value as typeof tProvider)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white mt-1">
            <option value="none">Not configured</option>
            <option value="openai">OpenAI</option>
            <option value="azure">Azure OpenAI</option>
          </select>
          {tProvider === 'azure' && (
            <>
              <label className="block text-xs text-gray-400">Endpoint
                <input value={tEndpoint} onChange={e => editT(setTEndpoint)(e.target.value)} placeholder="https://your-resource.openai.azure.com" className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white mt-1" />
              </label>
              <label className="block text-xs text-gray-400">Deployment
                <input value={tDeployment} onChange={e => editT(setTDeployment)(e.target.value)} placeholder="gpt-4o-transcribe" className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white mt-1" />
              </label>
            </>
          )}
          {tProvider !== 'none' && (
            <label className="block text-xs text-gray-400">API key
              <input
                type="password" autoComplete="off" value={tKey} onChange={e => editT(setTKey)(e.target.value)}
                placeholder={tStatus?.provider === tProvider && tStatus.keyHint ? `Saved (${tStatus.keyHint}). Leave blank to keep it.` : 'Paste your key'}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white mt-1"
              />
            </label>
          )}
          {tStatus?.fromEnv && <p className="text-xs text-gray-500">Using OPENAI_API_KEY from the environment.</p>}
          <p className="text-xs text-gray-500 leading-relaxed">Stored only on this computer, readable by your user only. Never sent to the browser.</p>
        </section>

        <div className="flex items-center justify-end gap-2 mt-5">
          {state === 'saved' && <span className="text-xs text-green-400 mr-auto">Saved</span>}
          {state === 'error' && <span className="text-xs text-red-400 mr-auto">{errorMsg || 'Could not save settings'}</span>}
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Close</button>
          <button
            onClick={save} disabled={!loaded || !valid || state === 'saving'}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40"
          >{state === 'saving' ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
