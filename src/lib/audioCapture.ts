import { spawn, ChildProcess } from 'child_process'
import { readdirSync, readFileSync, statSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// 10s balances transcript latency against transcription accuracy — short
// chunks give the model too little context (hurts Hebrew especially)
const CHUNK_SECONDS = 10

// RMS of 16-bit PCM samples in a WAV file, 0..1. Locates the 'data' chunk
// instead of assuming a 44-byte header (ffmpeg sometimes writes LIST chunks).
export function wavRms(buf: Buffer): number {
  let offset = 12 // past RIFF header
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') {
      const start = offset + 8
      const end = Math.min(start + chunkSize, buf.length)
      const sampleCount = Math.floor((end - start) / 2)
      if (sampleCount === 0) return 0
      let sumSq = 0
      for (let i = 0; i < sampleCount; i++) {
        const s = buf.readInt16LE(start + i * 2) / 32768
        sumSq += s * s
      }
      return Math.sqrt(sumSq / sampleCount)
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  return 0
}

// Below this a chunk is treated as silence and never sent for transcription
export const SILENCE_RMS_THRESHOLD = 0.004

export interface CaptureHandle {
  stop(): Promise<void>
}

interface CaptureCallbacks {
  onChunk: (filePath: string) => void
  onExit: (code: number | null, stderrTail: string) => void
}

export interface AudioDevices {
  system: string // BlackHole — carries meeting audio when output is the Multi-Output device
  mic: string
}

// Two avfoundation inputs mixed by ffmpeg itself — avoids needing a macOS
// aggregate input device (whose programmatic creation requires a working
// Swift toolchain).
function ffmpegInputArgs(devices: AudioDevices): string[] {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'avfoundation', '-i', `:${devices.system}`,
    '-f', 'avfoundation', '-i', `:${devices.mic}`,
    '-filter_complex', 'amix=inputs=2:duration=longest:normalize=0',
    '-ar', '16000', '-ac', '1',
  ]
}

function ffmpegArgs(devices: AudioDevices, outPattern: string): string[] {
  return [
    ...ffmpegInputArgs(devices),
    '-f', 'segment', '-segment_time', String(CHUNK_SECONDS),
    '-reset_timestamps', '1',
    outPattern,
  ]
}

// Records the device into 5s WAV chunks under <meetingDir>/audio and reports
// each chunk once it's complete (i.e. once the next chunk has appeared, or on
// stop). Polling instead of fs.watch — simpler and reliable enough at 5s
// granularity.
export function startCapture(meetingDir: string, devices: AudioDevices, cb: CaptureCallbacks): CaptureHandle {
  const audioDir = join(meetingDir, 'audio')
  mkdirSync(audioDir, { recursive: true })

  const proc: ChildProcess = spawn('ffmpeg', ffmpegArgs(devices, join(audioDir, 'chunk-%05d.wav')))
  let stderrTail = ''
  proc.stderr?.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-2000) })

  const reported = new Set<string>()
  let stopped = false

  function scan(includeLatest: boolean) {
    let files: string[]
    try { files = readdirSync(audioDir).filter(f => f.endsWith('.wav')).sort() } catch { return }
    // The highest-numbered chunk is still being written unless capture ended
    const complete = includeLatest ? files : files.slice(0, -1)
    for (const f of complete) {
      if (reported.has(f)) continue
      reported.add(f)
      cb.onChunk(join(audioDir, f))
    }
  }

  const poll = setInterval(() => scan(false), 1000)

  let exited = false
  const exitPromise = new Promise<void>(resolve => {
    proc.on('exit', (code) => {
      exited = true
      clearInterval(poll)
      scan(true) // flush the final partial chunk
      if (!stopped) cb.onExit(code, stderrTail)
      resolve()
    })
  })

  return {
    async stop() {
      stopped = true
      if (!exited) {
        proc.kill('SIGINT') // graceful: lets ffmpeg finalize the open segment
        const timeout = new Promise<void>(r => setTimeout(() => { proc.kill('SIGKILL'); r() }, 3000))
        await Promise.race([exitPromise, timeout])
        await exitPromise
      }
    },
  }
}

// Records ~2s from the device and returns the level, for the pre-meeting mic
// check. Errors (device missing, no permission) come back as { error }.
export async function micTest(devices: AudioDevices): Promise<{ level: number } | { error: string }> {
  const outFile = join(tmpdir(), `mic-test-${randomUUID().slice(0, 8)}.wav`)
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      ...ffmpegInputArgs(devices),
      '-t', '2', outFile,
    ])
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    const killer = setTimeout(() => proc.kill('SIGKILL'), 8000)
    proc.on('exit', (code) => {
      clearTimeout(killer)
      try {
        if (code !== 0) {
          resolve({ error: stderr.trim().split('\n').at(-1) ?? `ffmpeg exited ${code}` })
          return
        }
        const buf = readFileSync(outFile)
        if (statSync(outFile).size < 100) {
          resolve({ error: 'No audio captured' })
          return
        }
        resolve({ level: wavRms(buf) })
      } catch (e) {
        resolve({ error: e instanceof Error ? e.message : 'mic test failed' })
      } finally {
        try { rmSync(outFile, { force: true }) } catch {}
      }
    })
  })
}
