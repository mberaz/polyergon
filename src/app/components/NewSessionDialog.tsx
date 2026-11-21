'use client'
import { useState, useMemo, useEffect } from 'react'
import type { Org } from '@/lib/orgRegistry'
import type { SlackChannel } from '@/lib/slackBridge'
import { SlackChannelPicker } from './SlackChannelPicker'

interface Props {
  knownCwds: string[]
  orgs: Org[]
  defaultOrgId?: string
  onAddOrg: (name: string, configDir: string, model?: string) => Promise<Org>
  onConfirm: (cwd: string, name: string, orgId: string, backend: string, model: string, prompt?: string, worktree?: boolean) => void
  onResumeById: (sessionId: string, name: string, orgId: string, backend: string, model: string) => void
  onCancel: () => void
}

interface BackendOption { id: string; label: string }
interface ModelOption { id: string; displayName: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// User-chosen default agent + model, saved in the browser. Pre-selects the
// dialog on open, overriding the app's built-in default (Claude + Fable 5.1).
const DEFAULT_KEY = 'claude-session-default'
function loadDefault(): { backend?: string; model?: string } {
  try { return JSON.parse(localStorage.getItem(DEFAULT_KEY) ?? '{}') } catch { return {} }
}

// Hover help: native tooltip, no library
const Hint = ({ text }: { text: string }) => (
  <span title={text} aria-label={text} className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-600 text-[9px] text-gray-400 cursor-help align-middle">?</span>
)

export function NewSessionDialog({ knownCwds, orgs, defaultOrgId, onAddOrg, onConfirm, onResumeById, onCancel }: Props) {
  const [mode, setMode] = useState<'chat' | 'folder' | 'slack'>('chat')
  const [query, setQuery] = useState('')
  const [resumeId, setResumeId] = useState('')
  const [showResumeById, setShowResumeById] = useState(false)
  const [name, setName] = useState('')
  const [orgId, setOrgId] = useState(defaultOrgId ?? 'default')
  // Target the footer Start button uses. Folder clicks still start immediately;
  // this just lets Start have an explicit default (last folder, else Just chat).
  const [selectedCwd, setSelectedCwd] = useState('')
  const [backends, setBackends] = useState<BackendOption[]>([{ id: 'claude', label: 'Claude' }])
  const [backend, setBackend] = useState('claude')
  const [models, setModels] = useState<ModelOption[]>([])
  const [model, setModel] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  // Saved agent+model default (browser). Read after mount so server and client
  // first render agree (no hydration mismatch). justSaved drives the ✓ feedback.
  const [savedDefault, setSavedDefault] = useState<{ backend?: string; model?: string }>({})
  const [justSaved, setJustSaved] = useState(false)
  const [showAddOrg, setShowAddOrg] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [newOrgConfigDir, setNewOrgConfigDir] = useState('')
  const [newOrgModel, setNewOrgModel] = useState('')
  const [addOrgError, setAddOrgError] = useState<string | null>(null)

  const folders = useMemo(() => {
    // Hide the app's internal scratch dirs from the picker — the per-chat
    // throwaway folders (~/General/<id>) and meeting recording dirs
    // (.claude-session-manager/meetings/<id>) are noise to a user choosing a
    // project. "Just chat" below is the friendly entry point for those.
    const isInternal = (p: string) =>
      /\/General(\/[^/]+)?$/.test(p) ||               // ~/General and its per-chat scratch dirs
      /\/\.(claude-session-manager|polyergon[^/]*)(\/|$)/.test(p) || // app data + meeting recording dirs
      /^\/private\/(tmp|var\/folders)\//.test(p) ||   // macOS temp dirs
      p === '/tmp' || p === 'general'
    const unique = Array.from(new Set(knownCwds.filter(Boolean))).filter(p => !isInternal(p))
    return unique.sort((a, b) => {
      const ba = a.split('/').at(-1) ?? a
      const bb = b.split('/').at(-1) ?? b
      return ba.localeCompare(bb)
    })
  }, [knownCwds])

  // Only offer backends whose CLI is actually installed (Copilot stays hidden
  // until its binary is on PATH). Pre-select the saved default agent if present.
  const [noAgent, setNoAgent] = useState(false)
  useEffect(() => {
    const saved = loadDefault()
    setSavedDefault(saved)
    try { setSelectedCwd(localStorage.getItem('lastCwd') ?? '') } catch {}
    fetch('/api/backends')
      .then(r => r.json())
      .then((d: { backends?: BackendOption[] }) => {
        setNoAgent(!d.backends?.length)
        if (d.backends?.length) {
          setBackends(d.backends)
          const pref = saved.backend
          setBackend(prev =>
            pref && d.backends!.some(b => b.id === pref) ? pref
            : d.backends!.some(b => b.id === prev) ? prev
            : d.backends![0].id)
        }
      })
      .catch(() => {})
  }, [])

  // Live model list for the chosen backend + org; refetched whenever either
  // changes. Pre-selects the org's default model when present in the list.
  useEffect(() => {
    let cancelled = false
    setModelsLoading(true)
    setModelsError(null)
    fetch(`/api/models?backend=${encodeURIComponent(backend)}&orgId=${encodeURIComponent(orgId)}`)
      .then(r => r.json())
      .then((d: { models?: ModelOption[]; error?: string }) => {
        if (cancelled) return
        const list = d.models ?? []
        setModels(list)
        setModelsError(d.error ?? null)
        const orgDefault = orgs.find(o => o.id === orgId)?.model ?? undefined
        // Precedence: keep current pick if still valid → saved browser default
        // (only when its backend matches) → org default → first in the list.
        const savedModel = savedDefault.backend === backend ? savedDefault.model : undefined
        setModel(prev => {
          if (prev && list.some(m => m.id === prev)) return prev
          if (savedModel && list.some(m => m.id === savedModel)) return savedModel
          if (orgDefault && list.some(m => m.id === orgDefault)) return orgDefault
          return list[0]?.id ?? ''
        })
      })
      .catch(() => { if (!cancelled) setModelsError('Failed to load models') })
      .finally(() => { if (!cancelled) setModelsLoading(false) })
    return () => { cancelled = true }
  }, [backend, orgId, orgs, savedDefault])

  // Persist the current agent + model as the browser default for new sessions.
  function setAsDefault() {
    if (!model) return
    const next = { backend, model }
    try { localStorage.setItem(DEFAULT_KEY, JSON.stringify(next)) } catch {}
    setSavedDefault(next)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }

  const isCurrentDefault = savedDefault.backend === backend && savedDefault.model === model && !!model

  // Start from Slack: the session first reads the channel / thread / DM for context
  const [slackText, setSlackText] = useState('')
  const [slackChannel, setSlackChannel] = useState<SlackChannel | null>(null)
  const [slackLink, setSlackLink] = useState('')
  const [slackAsk, setSlackAsk] = useState('')
  const linkOk = /^https:\/\/[\w.-]+\.slack\.com\/archives\//.test(slackLink.trim())
  const chName = (slackChannel?.name ?? slackText).replace(/^#/, '').trim()
  function startFromSlack() {
    const source = linkOk
      ? `the Slack message, thread or DM at ${slackLink.trim()} (read the whole thread)`
      : `the Slack channel ${slackChannel?.id ? `${slackChannel.id} (#${chName})` : `#${chName}`} (the last 2 days, including thread replies)`
    const prompt = `Use the Slack connector to read ${source}. ` +
      'Give me a short summary: what it is about, the open questions, and what is asked of me. ' +
      (slackAsk.trim() ? `Then: ${slackAsk.trim()}` : 'Then wait for my instructions.') +
      ' Do not post anything to Slack unless I approve it.'
    const label = name.trim() || (linkOk ? 'From Slack thread' : `Slack #${chName}`)
    onConfirm(selectedCwd && selectedCwd !== 'general' ? selectedCwd : 'general', label, orgId, backend, model, prompt)
  }

  // Folder sessions only: own branch + worktree so parallel sessions don't collide
  const [isolate, setIsolate] = useState(false)
  function start(cwd: string) {
    localStorage.setItem('lastCwd', cwd)
    onConfirm(cwd, name.trim(), orgId, backend, model, undefined, cwd !== 'general' && isolate)
  }

  async function submitNewOrg() {
    setAddOrgError(null)
    try {
      const org = await onAddOrg(newOrgName.trim(), newOrgConfigDir.trim(), newOrgModel.trim() || undefined)
      setOrgId(org.id)
      setShowAddOrg(false)
      setNewOrgName('')
      setNewOrgConfigDir('')
      setNewOrgModel('')
    } catch (err) {
      setAddOrgError(err instanceof Error ? err.message : 'Failed to add org')
    }
  }

  const q = query.trim()
  const shown = folders.filter(f => f.toLowerCase().includes(q.toLowerCase()))
  const typedPath = q.startsWith('/') || q.startsWith('~') ? q.replace(/^~/, '') : ''
  const folderPick = selectedCwd && selectedCwd !== 'general' ? selectedCwd : ''
  const canStart = !!model && (mode === 'chat' || (mode === 'folder' && !!(folderPick || typedPath)) || (mode === 'slack' && (linkOk || !!chName)))
  const startLabel = mode === 'chat' ? 'Start chat'
    : mode === 'slack' ? 'Start with Slack context'
    : folderPick || typedPath ? `Start in ${(folderPick || typedPath).split('/').filter(Boolean).at(-1)}` : 'Pick a folder'
  function go() {
    if (!canStart) return
    if (mode === 'chat') start('general')
    else if (mode === 'slack') startFromSlack()
    else start(folderPick || typedPath)
  }
  const input = 'w-full bg-gray-800 text-white rounded-md px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-500'
  const enterStarts = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }
  const TABS = [
    { id: 'chat', label: 'Chat', hint: 'Questions, research, docs, one-off tasks. Not tied to a project.' },
    { id: 'folder', label: 'Folder', hint: 'Claude works on the code in a folder: reads, edits and runs commands there.' },
    { id: 'slack', label: 'Slack', hint: 'Claude reads a channel, thread or DM first, then helps with it.' },
  ] as const

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[8vh] z-50" onClick={onCancel} onKeyDown={e => { if (e.key === 'Escape') onCancel() }}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-[560px] max-w-[95vw] max-h-[84vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center px-5 pt-4 pb-3">
          <h2 className="text-white font-semibold">New session</h2>
          <button onClick={onCancel} aria-label="Close" className="ml-auto text-gray-500 hover:text-white text-lg leading-none">×</button>
        </div>

        <div className="px-5 pb-4 overflow-y-auto space-y-4">
          {noAgent && (
            <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded-md p-2">
              Claude Code is not installed, so sessions can&apos;t start. In Terminal run <code className="text-amber-200">curl -fsSL https://claude.ai/install.sh | bash</code>, then run <code className="text-amber-200">claude</code> once to sign in.
            </p>
          )}

          <div className="grid grid-cols-3 gap-1 p-1 bg-gray-800/70 rounded-lg" role="tablist">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={mode === t.id} onClick={() => setMode(t.id)}
                className={`py-1.5 text-sm rounded-md transition-colors ${mode === t.id ? 'bg-gray-950 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>{t.label}</button>
            ))}
          </div>
          <p className="text-xs text-gray-500 -mt-2">{TABS.find(t => t.id === mode)!.hint}</p>

          {mode === 'folder' && (
            <div className="space-y-2">
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={enterStarts} autoFocus
                placeholder="Search your folders, or paste a path" className={input} />
              <div className="max-h-52 overflow-y-auto rounded-md border border-gray-800">
                {typedPath && !folders.includes(typedPath) && (
                  <button onClick={() => setSelectedCwd(typedPath)} className={`w-full text-left px-3 py-2 text-sm border-b border-gray-800 ${folderPick === typedPath ? 'bg-blue-600/20' : 'hover:bg-gray-800'}`}>
                    Use <span className="font-mono text-gray-200">{typedPath}</span>
                  </button>
                )}
                {shown.map(cwd => (
                  <button key={cwd} onClick={() => setSelectedCwd(cwd)} onDoubleClick={() => start(cwd)} title={cwd}
                    className={`w-full text-left px-3 py-2 flex flex-col border-b border-gray-800 last:border-0 transition-colors ${folderPick === cwd ? 'bg-blue-600/20' : 'hover:bg-gray-800'}`}>
                    <span className="text-sm text-gray-100">{cwd.split('/').at(-1) || cwd}</span>
                    <span className="text-xs text-gray-500 truncate">{cwd}</span>
                  </button>
                ))}
                {!shown.length && !typedPath && <p className="px-3 py-3 text-xs text-gray-500">No match. Paste the full path, like /Users/you/project.</p>}
              </div>
              <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer"
                title="Creates a new branch and a separate copy of the repo (git worktree), so parallel sessions in the same repo don't touch each other's files.">
                <input type="checkbox" checked={isolate} onChange={e => setIsolate(e.target.checked)} className="mt-0.5" />
                Work on a separate copy (new branch), so other sessions in this repo aren&apos;t affected
              </label>
            </div>
          )}

          {mode === 'slack' && (
            <div className="space-y-2">
              <SlackChannelPicker value={slackText} onChange={(v, c) => { setSlackText(v); setSlackChannel(c); setSlackLink('') }} className={input} />
              <input value={slackLink} onChange={e => { setSlackLink(e.target.value); if (e.target.value) { setSlackText(''); setSlackChannel(null) } }}
                placeholder="…or paste a link to a message, thread or DM" title="In Slack: hover a message → ⋮ → Copy link" className={input} />
              {slackLink && !linkOk && <p className="text-[11px] text-red-400">Paste a Slack link (https://…slack.com/archives/…)</p>}
              <textarea value={slackAsk} onChange={e => setSlackAsk(e.target.value)} onKeyDown={enterStarts} rows={2} dir="auto"
                placeholder="What should Claude do with it? (optional)" className={`${input} resize-none`} />
              <p className="text-[11px] text-gray-500">The session reads it first and summarizes. Nothing is posted to Slack.</p>
            </div>
          )}


          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={enterStarts} autoFocus={mode === 'chat'}
            placeholder="Session name (optional, Claude names it otherwise)" className={input} />

          <div className="rounded-md border border-gray-800">
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-[1fr_1fr_1.6fr] gap-2">
                  <label className="text-xs text-gray-500">Org<Hint text="Which Claude account runs this session. Each org has its own login, billing, skills, Slack and integrations." />
                    <select value={orgId} onChange={e => e.target.value === '__add__' ? setShowAddOrg(true) : setOrgId(e.target.value)} className={`${input} mt-1 px-2`}>
                      {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                      <option value="__add__">+ Register new org…</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-500">Agent<Hint text="The CLI that runs the session: Claude Code, or another agent when installed." />
                    <select value={backend} onChange={e => setBackend(e.target.value)} disabled={backends.length < 2} className={`${input} mt-1 px-2 disabled:opacity-60`}>
                      {backends.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-gray-500">Model<Hint text="The model the session starts with. You can switch later inside the session with /model." />
                    <select value={model} onChange={e => setModel(e.target.value)} disabled={modelsLoading || models.length === 0} className={`${input} mt-1 px-2 disabled:opacity-60`}>
                      {modelsLoading && <option>Loading…</option>}
                      {!modelsLoading && models.length === 0 && <option value="">{modelsError ?? 'No models'}</option>}
                      {models.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                    </select>
                  </label>
                </div>
                <button onClick={setAsDefault} disabled={!model || isCurrentDefault}
                  className="text-xs text-gray-500 hover:text-blue-400 disabled:hover:text-gray-500 disabled:opacity-60">
                  {justSaved ? '✓ Saved as default' : isCurrentDefault ? '✓ This is your default' : '☆ Use this agent and model by default'}
                </button>
                {showAddOrg && (
                  <div className="space-y-2 border border-dashed border-gray-700 rounded-md p-3">
                    <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="Org name (e.g. Claude Teams)" className={input} />
                    <input value={newOrgConfigDir} onChange={e => setNewOrgConfigDir(e.target.value)} placeholder="/Users/you/.claude-teams" className={`${input} font-mono`} />
                    <input value={newOrgModel} onChange={e => setNewOrgModel(e.target.value)} placeholder="Default model (optional)" className={`${input} font-mono`} />
                    <p className="text-xs text-gray-500">A folder where this org&apos;s Claude settings and login live (created if missing). Then sign in from Settings → Claude sign-in.</p>
                    {addOrgError && <p className="text-xs text-red-400">{addOrgError}</p>}
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setShowAddOrg(false); setAddOrgError(null) }} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                      <button onClick={submitNewOrg} disabled={!newOrgName.trim() || !newOrgConfigDir.trim().startsWith('/')}
                        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded font-medium">Add org</button>
                    </div>
                  </div>
                )}
                {showResumeById ? (
                  <div className="space-y-2">
                    <input value={resumeId} onChange={e => setResumeId(e.target.value.trim())} autoFocus
                      onKeyDown={e => { if (e.key === 'Enter' && UUID_RE.test(resumeId)) onResumeById(resumeId, name.trim(), orgId, backend, model) }}
                      placeholder="Claude session ID, e.g. 6a047330-816f-45a1-86fc-9fba8280f12c" className={`${input} font-mono`} />
                    {resumeId && !UUID_RE.test(resumeId) && <p className="text-xs text-red-400">Paste a valid session ID</p>}
                    <button onClick={() => onResumeById(resumeId, name.trim(), orgId, backend, model)} disabled={!UUID_RE.test(resumeId)}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded font-medium">Resume</button>
                  </div>
                ) : (
                  <button onClick={() => setShowResumeById(true)} title="Continue a Claude conversation started in the terminal or another app"
                    className="block text-xs text-gray-500 hover:text-gray-300">↩ Resume a conversation by its session ID…</button>
                )}
              </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={go} disabled={!canStart}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md font-medium max-w-[60%] truncate">{startLabel}</button>
        </div>
      </div>
    </div>
  )
}
