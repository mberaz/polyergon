import { execFile, execFileSync, spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { DATA_DIR } from './dataDir'

// Local, offline transcription with whisper.cpp (`brew install whisper-cpp`).
// large-v3-turbo (q5_0) is ~550 MB, fast on Apple Silicon, good with Hebrew.
const MODEL_FILE = 'ggml-large-v3-turbo-q5_0.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`
export const LOCAL_MODEL_PATH = join(DATA_DIR, 'whisper', MODEL_FILE)
const CLI = 'whisper-cli'

let download: { done: number; total: number; error: string | null } | null = null

function cliInstalled(): Promise<boolean> {
  return new Promise(resolve => execFile('which', [CLI], err => resolve(!err)))
}

// Why local transcription can't run right now, or null when it can.
export function localWhisperProblem(): string | null {
  try { execFileSync('which', [CLI], { stdio: 'ignore' }) } catch { return 'whisper.cpp is not installed. Open Settings → Meetings and click Install for me (or run: brew install whisper-cpp).' }
  if (!existsSync(LOCAL_MODEL_PATH)) return 'The Whisper model is not downloaded yet. Open Settings → Meetings and click Download model.'
  return null
}

export interface LocalWhisperStatus { cli: boolean; model: boolean; downloading: number | null; error: string | null; brew: boolean; installing: boolean; installError: string | null }

const brewPath = () => ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(p => existsSync(p)) ?? null
let install: { running: boolean; error: string | null } = { running: false, error: null }

// Installs whisper.cpp with Homebrew in the background; status reports progress.
export function installLocalCli(): void {
  const brew = brewPath()
  if (!brew || install.running) return
  install = { running: true, error: null }
  let out = ''
  const p = spawn(brew, ['install', 'whisper-cpp'], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', NONINTERACTIVE: '1' } })
  p.stdout?.on('data', d => { out = (out + d).slice(-2000) })
  p.stderr?.on('data', d => { out = (out + d).slice(-2000) })
  p.on('error', e => { install = { running: false, error: e.message } })
  p.on('exit', code => { install = { running: false, error: code === 0 ? null : (out.trim().split('\n').at(-1) || `brew exited ${code}`) } })
}

export async function localWhisperStatus(): Promise<LocalWhisperStatus> {
  return {
    cli: await cliInstalled(),
    model: existsSync(LOCAL_MODEL_PATH),
    downloading: download && !download.error ? (download.total ? Math.floor(download.done / download.total * 100) : 0) : null,
    error: download?.error ?? null,
    brew: !!brewPath(),
    installing: install.running,
    installError: install.error,
  }
}

// Starts the model download in the background; status reports progress.
export function downloadLocalModel(): void {
  if (existsSync(LOCAL_MODEL_PATH) || (download && !download.error)) return
  download = { done: 0, total: 0, error: null }
  const d = download
  const part = LOCAL_MODEL_PATH + '.part'
  mkdirSync(join(DATA_DIR, 'whisper'), { recursive: true })
  ;(async () => {
    const res = await fetch(MODEL_URL)
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    d.total = Number(res.headers.get('content-length')) || 0
    const body = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
    body.on('data', (c: Buffer) => { d.done += c.length })
    await pipeline(body, createWriteStream(part))
    if (d.total && statSync(part).size !== d.total) throw new Error('Download incomplete')
    renameSync(part, LOCAL_MODEL_PATH)
    download = null
  })().catch(e => { d.error = e instanceof Error ? e.message : 'Download failed' })
}

// Transcribes one WAV chunk. `prompt` (earlier transcript) keeps language and terms consistent.
export function transcribeLocal(file: string, prompt: string, language = 'auto'): Promise<string | null> {
  // Never --translate: output stays in the spoken language
  const args = ['-m', LOCAL_MODEL_PATH, '-f', file, '-l', language, '-nt', '-np']
  if (prompt) args.push('--prompt', prompt.slice(-800))
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`whisper-cli failed: ${err.message.slice(0, 200)}`))
      const text = stdout.replace(/\s+/g, ' ').trim()
      resolve(text && !/^\[(BLANK_AUDIO|MUSIC|SILENCE)\]$/i.test(text) ? text : null)
    })
  })
}
