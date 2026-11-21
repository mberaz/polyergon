'use client'
import { useEffect, useState } from 'react'
import type { Settings } from '@/lib/settingsStore'
import type { TranscriptionStatus } from '@/lib/meetingConfig'
import type { ClaudeAuthStatus, ClaudeLogin } from '@/lib/claudeAuth'
import { withOrg } from '@/lib/activeOrg'
import { claudeLogin } from './SlackProblemBanner'
import { setNotificationsEnabled } from '@/hooks/useDesktopNotifications'
import { UpdatesForm } from './UpdatesSignup'

const MIN_K = 100
const MAX_K = 1000

const SECTIONS = [
  ['account', 'Claude account'],
  ['sessions', 'Sessions'],
  ['power', 'Power'],
  ['notifications', 'Notifications'],
  ['meetings', 'Meetings'],
  ['updates', 'Updates'],
] as const

function Sec({ id, title, desc, children }: { id: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} className="scroll-mt-6 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
      <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-4">{desc}</p>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

// Full-page settings, one card per section with a jump list on the left
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState(true)
  const [k, setK] = useState(300)
  const [loaded, setLoaded] = useState(false)
  const [notifyOn, setNotifyOn] = useState(true)
  const [skipPerms, setSkipPerms] = useState(false)
  const [keepAwake, setKeepAwake] = useState(false)
  const [updatesEmail, setUpdatesEmail] = useState<string | undefined>()
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [tStatus, setTStatus] = useState<TranscriptionStatus | null>(null)
  const [tProvider, setTProvider] = useState<'none' | 'openai' | 'azure' | 'local'>('none')
  const [tEndpoint, setTEndpoint] = useState('')
  const [tDeployment, setTDeployment] = useState('')
  const [tKey, setTKey] = useState('')
  const [tDirty, setTDirty] = useState(false)
  const [auth, setAuth] = useState<(ClaudeAuthStatus & { login: ClaudeLogin | null }) | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'apiKey'>('login')
  const [authKey, setAuthKey] = useState('')
  const [authDirty, setAuthDirty] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then((s: Settings) => {
      setEnabled(s.autoCompact.enabled)
      setK(Math.round(s.autoCompact.windowTokens / 1000))
      setNotifyOn(s.notifications?.enabled !== false)
      setSkipPerms(s.sessions?.skipPermissions === true)
      setKeepAwake(s.power?.keepAwake === true)
      setUpdatesEmail(s.updates?.email)
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

  useEffect(() => {
    fetch(withOrg('/api/settings/auth')).then(r => r.json()).then((a: ClaudeAuthStatus & { login: ClaudeLogin | null }) => { setAuth(a); setAuthMode(a.mode) }).catch(() => {})
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
        body: JSON.stringify({ autoCompact: { enabled, windowTokens: k * 1000 }, notifications: { enabled: notifyOn }, sessions: { skipPermissions: skipPerms }, power: { keepAwake } }),
      })
      if (!r.ok) throw new Error('Could not save settings')
      if (tDirty) {
        const body = tProvider === 'azure' ? { provider: 'azure', endpoint: tEndpoint, deployment: tDeployment, apiKey: tKey }
          : tProvider === 'openai' ? { provider: 'openai', apiKey: tKey } : tProvider === 'local' ? { provider: 'local' } : { provider: 'none' }
        const tr = await fetch('/api/settings/transcription', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await tr.json()
        if (!tr.ok) throw new Error(data.error ?? 'Could not save transcription')
        setTStatus(data); setTKey(''); setTDirty(false)
      }
      if (authDirty) {
        const ar = await fetch('/api/settings/auth', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authMode === 'apiKey' ? { mode: 'apiKey', apiKey: authKey } : { mode: 'login' }) })
        const ad = await ar.json()
        if (!ar.ok) throw new Error(ad.error ?? 'Could not save sign-in')
        setAuth(ad); setAuthKey(''); setAuthDirty(false)
      }
      setNotificationsEnabled(notifyOn)
      setState('saved')
    } catch (e) { setErrorMsg((e as Error).message || 'Could not save settings'); setState('error') }
  }

  return (
    <div className="absolute inset-0 flex bg-gray-950 text-gray-100">
      <nav className="hidden md:flex flex-col gap-0.5 w-48 flex-shrink-0 border-r border-gray-800 px-3 py-6">
        <h1 className="text-lg font-semibold px-2 mb-3">Settings</h1>
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth' })}
            className="text-left text-sm px-2 py-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-gray-800/60">{label}</button>
        ))}
      </nav>
      <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-2xl space-y-5">
        <h1 className="text-lg font-semibold md:hidden">Settings</h1>
        <Sec id="account" title="Claude account" desc="How sessions sign in to Claude. Each org has its own login.">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" checked={authMode === 'login'} onChange={() => { setAuthMode('login'); setAuthDirty(true); setState('idle') }} />Claude login</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={authMode === 'apiKey'} onChange={() => { setAuthMode('apiKey'); setAuthDirty(true); setState('idle') }} />API key</label>
          </div>
          {authMode === 'login' && (
            <div className="flex items-center gap-2 text-xs rounded border border-gray-800 bg-gray-900/60 px-2.5 py-2">
              {!auth ? <span className="text-gray-500">Checking sign-in…</span>
                : auth.login?.loggedIn ? <span className="text-emerald-300 flex-1">✓ Signed in{auth.login.email ? ` as ${auth.login.email}` : ''}{auth.login.orgName ? ` · ${auth.login.orgName}` : ''}{auth.login.plan ? ` · ${auth.login.plan}` : ''}</span>
                : auth.login ? <span className="text-amber-300 flex-1">Not signed in. Sessions in this org will ask you to log in.</span>
                : <span className="text-gray-500 flex-1">Couldn't check sign-in (is the claude CLI installed?)</span>}
              {auth && (
                <button type="button" onClick={() => { claudeLogin(); onClose() }}
                  title="Opens a new session in this org running /login. Follow the browser sign-in, then come back."
                  className="px-2 py-1 rounded border border-gray-700 text-gray-200 hover:bg-gray-800">{auth.login?.loggedIn ? 'Switch account' : 'Sign in'}</button>
              )}
            </div>
          )}
          {authMode === 'apiKey' && (
            <label className="block text-xs text-gray-400">Anthropic API key
              <input type="password" autoComplete="off" value={authKey} onChange={e => { setAuthKey(e.target.value); setAuthDirty(true); setState('idle') }}
                placeholder={auth?.keyHint ? `Saved (${auth.keyHint}). Leave blank to keep it.` : 'sk-ant-…'} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white mt-1" />
            </label>
          )}
          <p className="text-xs text-gray-500 leading-relaxed">
            {authMode === 'login'
              ? 'Sessions use the account you logged in with in Claude Code (subscription or SSO). Each org has its own login.'
              : 'Sessions bill this API key at API rates. Claude Code may ask once, in the session, to confirm using the key. Applies to sessions started, resumed or restarted after you save.'}
          </p>
        </Sec>

        <Sec id="sessions" title="Sessions" desc="How new Claude and Copilot sessions run.">
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
          <div className="border-t border-gray-800 pt-3" />
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={skipPerms} disabled={!loaded} onChange={e => { setSkipPerms(e.target.checked); setState('idle') }} />
            Skip permission prompts
          </label>
          <p className="text-xs text-gray-500 leading-relaxed">
            Sessions run commands and edit files without asking (Claude <code>bypassPermissions</code>, Copilot <code>--allow-all</code>).
            Applies to sessions started, resumed or restarted after you save.
          </p>
          {skipPerms && <p className="text-xs text-amber-400">Only use this with folders and tasks you trust.</p>}
        </Sec>

        <Sec id="power" title="Power" desc="Keep sessions and automations running when you step away.">
          <label className="flex items-center gap-2 text-sm font-medium" title="Uses macOS caffeinate while Polyergon runs">
            <input type="checkbox" checked={keepAwake} disabled={!loaded} onChange={e => { setKeepAwake(e.target.checked); setState('idle') }} />
            Keep working while the Mac is locked or idle
          </label>
          <p className="text-xs text-gray-500 leading-relaxed">
            Stops the Mac from going to sleep on its own, so sessions, Slack watchers and automations keep running.
            The screen can still lock and turn off. Closing the lid still puts the Mac to sleep. Uses more battery; turns off when Polyergon stops.
          </p>
          <p className="text-xs text-gray-500">Locking the screen alone never stops Polyergon; only sleep does.</p>
        </Sec>

        <Sec id="notifications" title="Notifications" desc="Desktop alerts from this browser.">
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
          {notifyOn && permission === 'granted' && (
            <p className="text-xs text-green-400">Chrome permission: allowed ·{' '}
              <button onClick={() => new Notification('Polyergon', { body: 'Test: a session is waiting for you', icon: '/icon-192.png' })} className="underline text-gray-300 hover:text-white">Send test notification</button>
            </p>
          )}
          {permission === 'unsupported' && <p className="text-xs text-gray-500">This browser does not support notifications.</p>}
        </Sec>

        <Sec id="meetings" title="Meetings" desc="Speech-to-text for recorded meetings.">
          <p className="text-sm font-medium">Transcription service</p>
          <select value={tProvider} onChange={e => editT(setTProvider)(e.target.value as typeof tProvider)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white mt-1">
            <option value="none">Not configured</option>
            <option value="openai">OpenAI</option>
            <option value="azure">Azure OpenAI</option>
            <option value="local">Local Whisper (free, offline)</option>
          </select>
          {tProvider === 'local' && <LocalWhisperSetup />}
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
          {(tProvider === 'openai' || tProvider === 'azure') && (
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
        </Sec>

        <Sec id="updates" title="Updates" desc="Get Polyergon news by email. Optional.">
          {updatesEmail
            ? <p className="text-sm text-emerald-300">Subscribed as {updatesEmail}.</p>
            : <UpdatesForm onDone={setUpdatesEmail} />}
          <p className="text-xs text-gray-500 leading-relaxed">New releases and features, a few times a year. Your email goes only to polyergon.ai; Polyergon sends nothing else about you.</p>
        </Sec>
      </div>
      </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-800 bg-gray-950/95">
          {state === 'saved' && <span className="text-xs text-green-400 mr-auto">Saved</span>}
          {state === 'error' && <span className="text-xs text-red-400 mr-auto">{errorMsg || 'Could not save settings'}</span>}
          <button
            onClick={save} disabled={!loaded || !valid || state === 'saving'}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40"
          >{state === 'saving' ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// Local Whisper: whisper.cpp + a model file. Shows what's missing and downloads the model.
function LocalWhisperSetup() {
  const [st, setSt] = useState<{ cli: boolean; model: boolean; downloading: number | null; error: string | null } | null>(null)
  const load = (method = 'GET') => fetch('/api/settings/transcription/local', { method }).then(r => r.json()).then(setSt).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (st?.downloading == null) return
    const t = setTimeout(() => load(), 1500)
    return () => clearTimeout(t)
  }, [st])
  if (!st) return null
  return (
    <div className="text-xs space-y-2 mt-2">
      <p className="text-gray-500 leading-relaxed">Runs OpenAI&apos;s open-source Whisper model on this Mac with whisper.cpp. Audio never leaves your computer, and there&apos;s no key or cost.</p>
      <p className={st.cli ? 'text-green-400' : 'text-amber-300'}>
        {st.cli ? '✓ whisper.cpp installed' : <>1. In Terminal run <code className="text-amber-200">brew install whisper-cpp</code>, then <button onClick={() => load()} className="underline">check again</button></>}
      </p>
      {st.model ? <p className="text-green-400">✓ Model downloaded (large-v3-turbo)</p>
        : st.downloading != null ? <p className="text-blue-300">Downloading model… {st.downloading}%</p>
        : <p className="text-amber-300">2. <button onClick={() => load('POST')} className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white">Download model</button> <span className="text-gray-500">large-v3-turbo, about 550 MB</span></p>}
      {st.error && <p className="text-red-400">{st.error}</p>}
    </div>
  )
}
