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
  onConfirm: (cwd: string, name: string, orgId: string, backend: string, model: string, prompt?: string) => void
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
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
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
      p === '/tmp'
    const unique = Array.from(new Set(knownCwds.filter(Boolean))).filter(p => !isInternal(p))
    return unique.sort((a, b) => {
      const ba = a.split('/').at(-1) ?? a
      const bb = b.split('/').at(-1) ?? b
      return ba.localeCompare(bb)
    })
  }, [knownCwds])

  // Only offer backends whose CLI is actually installed (Copilot stays hidden
  // until its binary is on PATH). Pre-select the saved default agent if present.
  useEffect(() => {
    const saved = loadDefault()
    setSavedDefault(saved)
    try { setSelectedCwd(localStorage.getItem('lastCwd') ?? '') } catch {}
    fetch('/api/backends')
      .then(r => r.json())
      .then((d: { backends?: BackendOption[] }) => {
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
  const [showSlack, setShowSlack] = useState(false)
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

  function start(cwd: string) {
    localStorage.setItem('lastCwd', cwd)
    onConfirm(cwd, name.trim(), orgId, backend, model)
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-[480px] max-h-[92vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-1">New Session</h2>
        <p className="text-xs text-gray-500 mb-4">Pick how to start. <b className="text-gray-400">Just chat</b> works for most things; pick a folder only when Claude should work on that code.</p>

        {/* Name field */}
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Session name (optional)"
          title="Shown on the session card, in History and in Remote Control. Leave empty and Claude names it from your first message."
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600 mb-4"
          autoFocus
        />

        {/* Org select */}
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Org<Hint text="Which Claude account runs this session. Each org has its own login, billing, skills, Slack and integrations." /></label>
          <select
            value={orgId}
            onChange={e => setOrgId(e.target.value)}
            className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500"
          >
            {orgs.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          {showAddOrg ? (
            <div className="mt-2 space-y-2 border border-dashed border-gray-700 rounded p-3">
              <input
                type="text"
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                placeholder="Org name (e.g. Claude Teams)"
                className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600"
              />
              <input
                type="text"
                value={newOrgConfigDir}
                onChange={e => setNewOrgConfigDir(e.target.value)}
                placeholder="/Users/you/.claude-teams"
                className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none font-mono border border-gray-700 focus:border-blue-500 placeholder-gray-600"
              />
              <input
                type="text"
                value={newOrgModel}
                onChange={e => setNewOrgModel(e.target.value)}
                placeholder="Default model (optional, e.g. claude-opus-4-8)"
                className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none font-mono border border-gray-700 focus:border-blue-500 placeholder-gray-600"
              />
              <p className="text-xs text-gray-500">
                A folder where this org&apos;s Claude settings and login live (it&apos;s created if missing). After adding, sign in from Settings → Claude sign-in.
              </p>
              {addOrgError && <p className="text-xs text-red-400">{addOrgError}</p>}
              <div className="flex items-center gap-3">
                <button onClick={() => { setShowAddOrg(false); setAddOrgError(null) }} className="text-xs text-gray-500 hover:text-gray-300">← Back</button>
                <button
                  onClick={submitNewOrg}
                  disabled={!newOrgName.trim() || !newOrgConfigDir.trim().startsWith('/')}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium"
                >Add org</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddOrg(true)}
              className="w-full text-left px-3 py-2 mt-2 text-sm text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 rounded hover:border-gray-500 transition-colors"
            >
              <span title="Add another Claude account (e.g. a second company) with its own config folder.">+ Register new org…</span>
            </button>
          )}
        </div>

        {/* Backend + Model */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Agent<Hint text="The CLI that runs the session: Claude Code, or GitHub Copilot CLI when installed." /></label>
            <select
              value={backend}
              onChange={e => setBackend(e.target.value)}
              disabled={backends.length < 2}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 disabled:opacity-60"
            >
              {backends.map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Model<Hint text="The model the session starts with. You can switch later inside the session with /model." /></label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={modelsLoading || models.length === 0}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 disabled:opacity-60"
            >
              {modelsLoading && <option>Loading…</option>}
              {!modelsLoading && models.length === 0 && <option value="">{modelsError ?? 'No models'}</option>}
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
          </div>
        </div>
        {/* Save the current agent+model as the default for future sessions */}
        <div className="flex items-center gap-2 mb-3 -mt-1">
          <button
            onClick={setAsDefault}
            title="Pre-select this agent and model every time you open New Session"
            disabled={!model || isCurrentDefault}
            className="text-xs text-gray-500 hover:text-blue-400 disabled:hover:text-gray-500 disabled:opacity-50 transition-colors"
          >
            {justSaved ? '✓ Saved as default' : isCurrentDefault ? '✓ This is your default' : '☆ Set as default agent & model'}
          </button>
        </div>
        {modelsError && models.length > 0 && (
          <p className="text-xs text-amber-500/80 -mt-2 mb-3">Showing cached models — {modelsError}</p>
        )}

        {/* Start options — single click starts immediately */}
        {!showCustom && (
          <>
            {/* Just chat — the friendly, no-project entry point */}
            <button
              onClick={() => start('general')}
              title="Starts in a private scratch folder. Good for questions, research, Slack, docs and one-off tasks."
              className="w-full text-left px-3 py-2.5 mb-3 flex items-center gap-3 rounded border border-gray-700 hover:bg-gray-800 hover:border-gray-600 transition-colors"
            >
              <span className="text-lg leading-none">💬</span>
              <span className="flex flex-col">
                <span className="text-sm text-white font-medium">Just chat</span>
                <span className="text-xs text-gray-500">Ask a question or run a quick task — not tied to a project</span>
              </span>
            </button>

            {/* Start from Slack */}
            {showSlack ? (
              <div className="mb-3 rounded border border-purple-800/60 bg-purple-950/20 p-3 space-y-2">
                <p className="text-xs text-gray-300 font-medium">Start from Slack</p>
                <SlackChannelPicker value={slackText} onChange={(v, c) => { setSlackText(v); setSlackChannel(c); setSlackLink('') }}
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600" />
                <input value={slackLink} onChange={e => { setSlackLink(e.target.value); if (e.target.value) { setSlackText(''); setSlackChannel(null) } }}
                  placeholder="…or paste a link to a message, thread or DM"
                  title="In Slack: hover a message → ⋮ → Copy link"
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600" />
                {slackLink && !linkOk && <p className="text-[11px] text-red-400">Paste a Slack link (https://…slack.com/archives/…)</p>}
                <input value={slackAsk} onChange={e => setSlackAsk(e.target.value)} placeholder="What should Claude do with it? (optional)"
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600" />
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowSlack(false)} className="text-xs text-gray-500 hover:text-gray-300">← Back</button>
                  <button onClick={startFromSlack} disabled={!model || !(linkOk || chName)}
                    className="ml-auto px-3 py-1 text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded font-medium">Start with this context</button>
                </div>
                <p className="text-[11px] text-gray-500">The session reads it first and summarizes. Nothing is posted to Slack.</p>
              </div>
            ) : (
              <button onClick={() => setShowSlack(true)} title="The new session reads a Slack channel, thread or DM first, so it starts with the context"
                className="w-full text-left px-3 py-2.5 mb-3 flex items-center gap-3 rounded border border-gray-700 hover:bg-gray-800 hover:border-gray-600 transition-colors">
                <span className="text-lg leading-none">#</span>
                <span className="flex flex-col">
                  <span className="text-sm text-white font-medium">Start from Slack</span>
                  <span className="text-xs text-gray-500">A channel, thread or DM becomes the session&apos;s context</span>
                </span>
              </button>
            )}

            {/* Project folders */}
            {folders.length > 0 && (
              <>
                <p className="text-[11px] uppercase tracking-wide text-gray-600 mb-1">Or work in a folder<Hint text="Claude starts inside this folder: it reads and edits its files, runs commands there, and loads the folder's CLAUDE.md. Listed: folders you used before." /></p>
                <div className="max-h-56 overflow-y-auto rounded border border-gray-700 mb-3">
                  {folders.map(cwd => {
                    const basename = cwd.split('/').at(-1) || cwd
                    return (
                      <button
                        key={cwd}
                        onClick={() => start(cwd)}
                        title={`Start Claude inside ${cwd}`}
                        className="w-full text-left px-3 py-2.5 flex flex-col border-b border-gray-800 last:border-0 hover:bg-gray-800 transition-colors"
                      >
                        <span className="text-sm text-gray-200 font-medium">{basename}</span>
                        <span className="text-xs text-gray-500 truncate">{cwd}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* Custom path */}
        {showCustom ? (
          <div className="mb-3">
            <input
              type="text"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && custom.trim()) start(custom.trim())
                if (e.key === 'Escape') { setShowCustom(false); setCustom('') }
              }}
              placeholder="/Users/you/your-project"
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none font-mono border border-gray-700 focus:border-blue-500"
              autoFocus
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => { setShowCustom(false); setCustom('') }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >← Back</button>
              <button
                onClick={() => custom.trim() && start(custom.trim())}
                disabled={!custom.trim()}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium"
              >Start</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCustom(true)}
            title="Type the full path of any folder on this Mac, e.g. a repo you haven't used here yet"
            className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 rounded hover:border-gray-500 transition-colors mb-3"
          >
            + Open a different folder…
          </button>
        )}

        {/* Resume by ID */}
        <div className="border-t border-gray-700/50 pt-3">
          {showResumeById ? (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Session ID</label>
              <input
                type="text"
                value={resumeId}
                onChange={e => setResumeId(e.target.value.trim())}
                onKeyDown={e => {
                  if (e.key === 'Enter' && UUID_RE.test(resumeId)) onResumeById(resumeId, name.trim(), orgId, backend, model)
                  if (e.key === 'Escape') { setShowResumeById(false); setResumeId('') }
                }}
                placeholder="6a047330-816f-45a1-86fc-9fba8280f12c"
                className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none font-mono border border-gray-700 focus:border-blue-500"
                autoFocus
              />
              {resumeId && !UUID_RE.test(resumeId) && (
                <p className="text-xs text-red-400 mt-1">Paste a valid session UUID</p>
              )}
              <div className="flex items-center gap-3 mt-2">
                <button onClick={() => { setShowResumeById(false); setResumeId('') }} className="text-xs text-gray-500 hover:text-gray-300">← Back</button>
                <button
                  onClick={() => onResumeById(resumeId, name.trim(), orgId, backend, model)}
                  disabled={!UUID_RE.test(resumeId)}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium"
                >Resume</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowResumeById(true)}
              title="Continue an existing Claude conversation (from the terminal or another app) by pasting its session ID"
              className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 rounded hover:border-gray-500 transition-colors"
            >
              ↩ Resume by session ID…
            </button>
          )}
        </div>

        <div className="flex justify-end items-center gap-2 mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={() => start(selectedCwd || 'general')}
            disabled={!model}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium"
          >
            Start {selectedCwd && selectedCwd !== 'general' ? `· ${selectedCwd.split('/').at(-1)}` : 'chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
