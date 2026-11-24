import { CONFIG_FILE, readConfig, writeConfig } from './configFile'
import { LOCAL_MODEL_PATH } from './localWhisper'
import { listAudioDevices, resolveDevices, type AudioDevices } from './audioCapture'

export type TranscriptionConfig = (
  | { kind: 'openai'; apiKey: string }
  | { kind: 'azure'; endpoint: string; apiKey: string; deployment: string }
  | { kind: 'local'; model: string }
) & { language?: string } // ISO 639-1 code; unset = detect each chunk

// Spoken language for meetings. Auto-detect can guess wrong on noisy or mixed
// chunks and then writes Hebrew speech out in English; a fixed language avoids it.
export function getTranscriptionLanguage(file = CONFIG_FILE): string | undefined {
  const l = readConfig(file).transcriptionLanguage
  return typeof l === 'string' && /^[a-z]{2}$/.test(l) ? l : undefined
}

// Azure (AI Foundry deployment) takes precedence when configured; plain
// OpenAI key works as before.
export function getTranscriptionConfig(file = CONFIG_FILE): TranscriptionConfig | null {
  const cfg = readConfig(file)
  const language = getTranscriptionLanguage(file)
  if (cfg.transcriptionProvider === 'local') return { kind: 'local', model: LOCAL_MODEL_PATH, language }
  const { azureEndpoint, azureApiKey, azureDeployment } = cfg
  if (typeof azureEndpoint === 'string' && azureEndpoint && typeof azureApiKey === 'string' && azureApiKey) {
    return {
      kind: 'azure',
      // People paste the full transcription URL from the Azure portal; we add the path ourselves
      endpoint: azureEndpoint.replace(/\/openai\/.*$/, '').replace(/\/+$/, ''),
      apiKey: azureApiKey,
      deployment: typeof azureDeployment === 'string' && azureDeployment ? azureDeployment : 'gpt-4o-transcribe',
      language,
    }
  }
  const key = process.env.OPENAI_API_KEY || cfg.openaiApiKey
  if (typeof key === 'string' && key) return { kind: 'openai', apiKey: key, language }
  return null
}

// What the Settings UI may see: never the key itself, only its last 4 chars.
export interface TranscriptionStatus {
  provider: 'openai' | 'azure' | 'local' | null
  keyHint: string | null
  fromEnv: boolean // OPENAI_API_KEY env var, can't be changed from the UI
  endpoint: string | null
  deployment: string | null
  language: string | null
}

export function getTranscriptionStatus(file = CONFIG_FILE): TranscriptionStatus {
  const c = getTranscriptionConfig(file)
  const hint = (k: string) => '…' + k.slice(-4)
  const language = getTranscriptionLanguage(file) ?? null
  if (!c) return { provider: null, keyHint: null, fromEnv: false, endpoint: null, deployment: null, language }
  if (c.kind === 'local') return { provider: 'local', keyHint: null, fromEnv: false, endpoint: null, deployment: null, language }
  if (c.kind === 'azure') return { provider: 'azure', keyHint: hint(c.apiKey), fromEnv: false, endpoint: c.endpoint, deployment: c.deployment, language }
  return { provider: 'openai', keyHint: hint(c.apiKey), fromEnv: !readConfig(file).openaiApiKey, endpoint: null, deployment: null, language }
}

export type TranscriptionInput = (
  | { provider: 'none' }
  | { provider: 'local' }
  | { provider: 'openai'; apiKey?: string }
  | { provider: 'azure'; endpoint: string; deployment?: string; apiKey?: string }
) & { language?: string | null }

// Saves provider settings into config.json (0600, other keys kept). An empty
// apiKey keeps the saved one, so the UI never needs to know it.
export function saveTranscriptionConfig(input: TranscriptionInput, file = CONFIG_FILE): TranscriptionStatus {
  const cfg = readConfig(file)
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  delete cfg.transcriptionProvider // only 'local' sets it; saved keys stay for switching back
  if (input.language !== undefined) {
    if (input.language && !/^[a-z]{2}$/.test(input.language)) throw new Error('Unknown language')
    if (input.language) cfg.transcriptionLanguage = input.language; else delete cfg.transcriptionLanguage
  }
  if (input.provider === 'local') {
    cfg.transcriptionProvider = 'local'
  } else if (input.provider === 'none') {
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
  writeConfig(cfg, file)
  return getTranscriptionStatus(file)
}

// ffmpeg records these two devices and mixes them itself: system audio
// arrives via BlackHole (with output set to a Multi-Output device), your
// voice via the mic. No aggregate input device needed.
export type { AudioDevices }

// The configured devices if this Mac has them, else its built-in mic and BlackHole.
export function getAudioDevices(): AudioDevices | { error: string } {
  const cfg = readConfig()
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return resolveDevices({ system: str(cfg.systemAudioDevice), mic: str(cfg.micDevice) }, listAudioDevices())
}
