import { readFileSync } from 'fs'
import { wavRms, SILENCE_RMS_THRESHOLD } from './audioCapture'
import type { TranscriptionConfig } from './meetingConfig'
import { transcribeLocal } from './localWhisper'

const MAX_ATTEMPTS = 3

function requestFor(config: Exclude<TranscriptionConfig, { kind: 'local' }>, buf: Buffer, prompt: string): { url: string; headers: Record<string, string>; form: FormData } {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/wav' }), 'chunk.wav')
  // Prior transcript as context — keeps language and terminology consistent
  // across chunks (crucial for short chunks and mixed Hebrew/English)
  if (prompt) form.append('prompt', prompt)
  if (config.kind === 'openai') {
    form.append('model', 'whisper-1')
    return {
      url: 'https://api.openai.com/v1/audio/transcriptions',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      form,
    }
  }
  return {
    url: `${config.endpoint}/openai/deployments/${config.deployment}/audio/transcriptions?api-version=2025-03-01-preview`,
    headers: { 'api-key': config.apiKey },
    form,
  }
}

// Transcribes one WAV chunk. Returns null for silence (checked locally, no
// API call) or empty results. Throws after retries are exhausted — the caller
// records a gap and moves on.
export async function transcribeChunk(filePath: string, config: TranscriptionConfig, prompt = ''): Promise<string | null> {
  const buf = readFileSync(filePath)
  if (wavRms(buf) < SILENCE_RMS_THRESHOLD) return null
  if (config.kind === 'local') return transcribeLocal(filePath, prompt)

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
    try {
      const { url, headers, form } = requestFor(config, buf, prompt)
      // Hard timeout — without it a hung transcription request never resolves,
      // and since meeting stop() waits for the chunk queue to drain, one stalled
      // fetch freezes meeting teardown (and anything waiting on it) indefinitely.
      const res = await fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(30_000) })
      if (res.status === 400) {
        // Bad audio (e.g. truncated final chunk) won't get better on retry
        return null
      }
      if (!res.ok) throw new Error(`Transcription API ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json() as { text?: string }
      const text = data.text?.trim()
      return text || null
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}
