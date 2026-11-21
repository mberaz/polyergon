import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import type { BackendId } from './backends'
import { orgRegistry } from './orgRegistry'
import { claudeAuthEnv } from './claudeAuth'
import { DEFAULT_MODEL_ID } from './backends'

const execFileAsync = promisify(execFile)
const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000'
const CACHE_TTL_MS = 10 * 60_000

export interface ModelInfo {
  id: string
  displayName: string
}

// Same keychain scheme planLimits.ts uses: each config dir's OAuth token lives
// under "Claude Code-credentials[-<first 8 hex of sha256(configDir)>]".
function keychainService(configDir: string | null): string {
  if (!configDir) return 'Claude Code-credentials'
  return `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`
}

async function readToken(configDir: string | null): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password', '-s', keychainService(configDir), '-w',
    ], { timeout: 5000 })
    return JSON.parse(stdout.trim()).claudeAiOauth?.accessToken ?? null
  } catch {
    return null
  }
}

// GitHub Copilot exposes its model list at api.githubcopilot.com/models,
// authenticated with the user's gh OAuth token (Bearer). It returns chat models
// plus embedding models — we keep only the ones usable for a coding session.
async function fetchCopilotModels(): Promise<ModelInfo[]> {
  let token: string
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 })
    token = stdout.trim()
  } catch {
    throw new Error('Not logged into gh — run `gh auth login`')
  }
  if (!token) throw new Error('No gh token found')
  const res = await fetch('https://api.githubcopilot.com/models', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Editor-Version': 'copilot-cli/1.0.83',
      'Copilot-Integration-Id': 'copilot-cli',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401 || res.status === 403) throw new Error('gh token lacks Copilot access')
  if (!res.ok) throw new Error(`Copilot models endpoint returned ${res.status}`)
  const d = await res.json() as {
    data?: { id: string; name?: string; capabilities?: { type?: string } }[]
  }
  const seen = new Set<string>()
  return (d.data ?? [])
    // Drop embeddings and anything not a chat model.
    .filter(m => !/embedding/i.test(m.id) && (m.capabilities?.type ?? 'chat') === 'chat')
    .filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .map(m => ({ id: m.id, displayName: m.name ?? m.id }))
}

// `opencode models` prints provider/model ids, one per line
async function fetchOpencodeModels(): Promise<ModelInfo[]> {
  const { stdout } = await execFileAsync('opencode', ['models'], { timeout: 20_000 })
  const ids = stdout.split('\n').map(l => l.trim()).filter(l => /^[\w.-]+\/\S+$/.test(l))
  return [{ id: 'default', displayName: 'Default (from its config)' }, ...ids.map(id => ({ id, displayName: id }))]
}

async function fetchClaudeModels(configDir: string | null): Promise<ModelInfo[]> {
  // API-key mode (Settings → Claude sign-in) uses the key; otherwise the org's login token.
  const apiKey = claudeAuthEnv().ANTHROPIC_API_KEY
  const token = apiKey ? null : await readToken(configDir)
  if (!apiKey && !token) throw new Error('No login found for this org')
  const res = await fetch(MODELS_URL, {
    headers: apiKey
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) throw new Error(apiKey ? 'API key rejected. Check it in Settings' : 'Token expired — open a Claude session in this org to refresh it')
  if (!res.ok) throw new Error(`Models endpoint returned ${res.status}`)
  const d = await res.json() as { data?: { id: string; display_name?: string }[] }
  return (d.data ?? []).map(m => ({ id: m.id, displayName: m.display_name ?? m.id }))
}

interface CacheEntry { at: number; models: ModelInfo[] }
const cache = new Map<string, CacheEntry>()

// Keyed by backend + org so each org's own entitlements are reflected.
export async function getModels(backend: BackendId, orgId: string, force = false): Promise<ModelInfo[]> {
  const key = `${backend}:${orgId}:${backend === 'claude' && claudeAuthEnv().ANTHROPIC_API_KEY ? 'key' : 'login'}`
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.models

  try {
    const org = orgRegistry.get(orgId)
    const models = backend === 'copilot' ? await fetchCopilotModels()
      : backend === 'opencode' ? await fetchOpencodeModels()
      : backend === 'claude' ? await fetchClaudeModels(org?.configDir ?? null)
      : [{ id: 'default', displayName: 'Default (from its config)' }] // codex, gemini: their own default
    cache.set(key, { at: Date.now(), models })
    return models
  } catch (e) {
    // Serve stale on failure rather than an empty dropdown.
    if (hit) return hit.models
    // Claude: still offer the CLI's own default so New Session can start.
    if (backend === 'claude') return [{ id: DEFAULT_MODEL_ID, displayName: `Default (${e instanceof Error ? e.message : 'models unavailable'})` }]
    throw e
  }
}
