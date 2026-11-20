import { DATA_DIR } from './dataDir'
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs'
import { join } from 'path'

const CONFIG_FILE = join(DATA_DIR, 'config.json')

function readConfig(file = CONFIG_FILE): Record<string, unknown> {
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return {} }
}

export type TranscriptionConfig =
  | { kind: 'openai'; apiKey: string }
  | { kind: 'azure'; endpoint: string; apiKey: string; deployment: string }

// Azure (AI Foundry deployment) takes precedence when configured; plain
// OpenAI key works as before.
export function getTranscriptionConfig(file = CONFIG_FILE): TranscriptionConfig | null {
  const cfg = readConfig(file)
  const { azureEndpoint, azureApiKey, azureDeployment } = cfg
  if (typeof azureEndpoint === 'string' && azureEndpoint && typeof azureApiKey === 'string' && azureApiKey) {
    return {
      kind: 'azure',
      endpoint: azureEndpoint.replace(/\/+$/, ''),
      apiKey: azureApiKey,
      deployment: typeof azureDeployment === 'string' && azureDeployment ? azureDeployment : 'gpt-4o-transcribe',
    }
  }
  const key = process.env.OPENAI_API_KEY || cfg.openaiApiKey
  if (typeof key === 'string' && key) return { kind: 'openai', apiKey: key }
  return null
}

// What the Settings UI may see: never the key itself, only its last 4 chars.
export interface TranscriptionStatus {
  provider: 'openai' | 'azure' | null
  keyHint: string | null
  fromEnv: boolean // OPENAI_API_KEY env var, can't be changed from the UI
  endpoint: string | null
  deployment: string | null
}

export function getTranscriptionStatus(file = CONFIG_FILE): TranscriptionStatus {
  const c = getTranscriptionConfig(file)
  const hint = (k: string) => '…' + k.slice(-4)
  if (!c) return { provider: null, keyHint: null, fromEnv: false, endpoint: null, deployment: null }
  if (c.kind === 'azure') return { provider: 'azure', keyHint: hint(c.apiKey), fromEnv: false, endpoint: c.endpoint, deployment: c.deployment }
  return { provider: 'openai', keyHint: hint(c.apiKey), fromEnv: !readConfig(file).openaiApiKey, endpoint: null, deployment: null }
}

export type TranscriptionInput =
  | { provider: 'none' }
  | { provider: 'openai'; apiKey?: string }
  | { provider: 'azure'; endpoint: string; deployment?: string; apiKey?: string }

// Saves provider settings into config.json (0600, other keys kept). An empty
// apiKey keeps the saved one, so the UI never needs to know it.
export function saveTranscriptionConfig(input: TranscriptionInput, file = CONFIG_FILE): TranscriptionStatus {
  const cfg = readConfig(file)
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  if (input.provider === 'none') {
    for (const k of ['azureEndpoint', 'azureApiKey', 'azureDeployment', 'openaiApiKey']) delete cfg[k]
  } else if (input.provider === 'openai') {
    const key = str(input.apiKey) || str(cfg.openaiApiKey)
    if (!key) throw new Error('API key is required')
    for (const k of ['azureEndpoint', 'azureApiKey', 'azureDeployment']) delete cfg[k]
    cfg.openaiApiKey = key
  } else if (input.provider === 'azure') {
    const endpoint = str(input.endpoint)
    let url: URL
    try { url = new URL(endpoint) } catch { throw new Error('Endpoint must be a URL') }
    if (url.protocol !== 'https:') throw new Error('Endpoint must use https')
    const key = str(input.apiKey) || str(cfg.azureApiKey)
    if (!key) throw new Error('API key is required')
    delete cfg.openaiApiKey
    Object.assign(cfg, { azureEndpoint: endpoint, azureApiKey: key, azureDeployment: str(input.deployment) || 'gpt-4o-transcribe' })
  } else {
    throw new Error('Unknown provider')
  }
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  chmodSync(file, 0o600) // mode above only applies when the file is created
  return getTranscriptionStatus(file)
}

// ffmpeg records these two devices and mixes them itself: system audio
// arrives via BlackHole (with output set to a Multi-Output device), your
// voice via the mic. No aggregate input device needed.
export interface AudioDevices {
  system: string
  mic: string
}

export function getAudioDevices(): AudioDevices {
  const cfg = readConfig()
  return {
    system: typeof cfg.systemAudioDevice === 'string' && cfg.systemAudioDevice ? cfg.systemAudioDevice : 'BlackHole 2ch',
    mic: typeof cfg.micDevice === 'string' && cfg.micDevice ? cfg.micDevice : 'MacBook Pro Microphone',
  }
}
