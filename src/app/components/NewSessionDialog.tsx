'use client'
import { useState, useMemo, useEffect } from 'react'
import type { Org } from '@/lib/orgRegistry'

interface Props {
  knownCwds: string[]
  orgs: Org[]
  defaultOrgId?: string
  onAddOrg: (name: string, configDir: string, model?: string) => Promise<Org>
  onConfirm: (cwd: string, name: string, orgId: string, backend: string, model: string) => void
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
      /\/\.claude-session-manager\/meetings\//.test(p) || // meeting recording dirs
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
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-[480px] shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-1">New Session</h2>
        <p className="text-xs text-gray-500 mb-4">Start a quick chat, or open one of your projects</p>

        {/* Name field */}
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Session name (optional)"
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500 placeholder-gray-600 mb-4"
          autoFocus
        />

        {/* Org select */}
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Org</label>
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
                First run <code className="text-gray-400">CLAUDE_CONFIG_DIR={newOrgConfigDir || '<path>'} claude</code> and complete <code className="text-gray-400">/login</code> yourself — this app doesn&apos;t automate login.
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
              + Register new org…
            </button>
          )}
        </div>

        {/* Backend + Model */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Agent</label>
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
            <label className="text-xs text-gray-500 mb-1 block">Model</label>
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
              className="w-full text-left px-3 py-2.5 mb-3 flex items-center gap-3 rounded border border-gray-700 hover:bg-gray-800 hover:border-gray-600 transition-colors"
            >
              <span className="text-lg leading-none">💬</span>
              <span className="flex flex-col">
                <span className="text-sm text-white font-medium">Just chat</span>
                <span className="text-xs text-gray-500">Ask a question or run a quick task — not tied to a project</span>
              </span>
            </button>

            {/* Project folders */}
            {folders.length > 0 && (
              <>
                <p className="text-[11px] uppercase tracking-wide text-gray-600 mb-1">Open a project</p>
                <div className="max-h-56 overflow-y-auto rounded border border-gray-700 mb-3">
                  {folders.map(cwd => {
                    const basename = cwd.split('/').at(-1) || cwd
                    return (
                      <button
                        key={cwd}
                        onClick={() => start(cwd)}
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
