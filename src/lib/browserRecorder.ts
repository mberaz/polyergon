'use client'
// Records meeting audio in the browser (Chrome already has microphone
// permission; a background Polyergon process gets silence from macOS).
// Mic + BlackHole (if installed) are mixed, resampled to 16 kHz mono 16-bit,
// and handed over in ~10s chunks.

const RATE = 16000
const CHUNK_SECONDS = 10

export interface RecorderDevices { mic: string; system: string | null }
export interface Recorder { devices: RecorderDevices; stop(): Promise<void> }

const MIC_KEY = 'polyergon.micDeviceId'
export const chosenMic = (): string => { try { return localStorage.getItem(MIC_KEY) ?? '' } catch { return '' } }
export const chooseMic = (id: string) => { try { if (id) localStorage.setItem(MIC_KEY, id); else localStorage.removeItem(MIC_KEY) } catch { /* private mode */ } }

// Microphones (not BlackHole). Asks for permission first so names show.
export async function listMics(): Promise<{ id: string; label: string }[]> {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true })
  s.getTracks().forEach(t => t.stop())
  return (await navigator.mediaDevices.enumerateDevices())
    .filter(d => d.kind === 'audioinput' && !/blackhole/i.test(d.label) && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map(d => ({ id: d.deviceId, label: d.label || 'Microphone' }))
}

async function openInputs(): Promise<{ streams: MediaStream[]; devices: RecorderDevices }> {
  const id = chosenMic()
  const mic = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true })
    .catch(e => { if (id && (e as { name?: string }).name === 'OverconstrainedError') { chooseMic(''); return navigator.mediaDevices.getUserMedia({ audio: true }) } throw e })
  const all = await navigator.mediaDevices.enumerateDevices() // labels show once permission is granted
  const bh = all.find(d => d.kind === 'audioinput' && /blackhole/i.test(d.label))
  const streams = [mic]
  if (bh) {
    try {
      streams.push(await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: bh.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }))
    } catch { /* record the mic alone */ }
  }
  return { streams, devices: { mic: mic.getAudioTracks()[0]?.label || 'Microphone', system: streams.length > 1 ? bh!.label : null } }
}

// Float32 at `from` Hz → Int16 at 16 kHz (averaging; fine for speech)
function downsample(input: Float32Array, from: number): Int16Array {
  const ratio = from / RATE
  const out = new Int16Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function startRecorder(onChunk: (base64Pcm16k: string) => void, chunkSeconds = CHUNK_SECONDS): Promise<Recorder> {
  const { streams, devices } = await openInputs()
  const ctx = new AudioContext()
  // ponytail: ScriptProcessor is deprecated but needs no extra module file; move to AudioWorklet if Chrome drops it
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  streams.forEach(s => ctx.createMediaStreamSource(s).connect(proc))
  const sink = ctx.createGain(); sink.gain.value = 0 // keep the graph pulling without playing anything
  proc.connect(sink); sink.connect(ctx.destination)
  let parts: Int16Array[] = [], samples = 0
  const flush = () => {
    if (!samples) return
    const all = new Int16Array(samples); let o = 0
    for (const p of parts) { all.set(p, o); o += p.length }
    parts = []; samples = 0
    onChunk(toBase64(all))
  }
  proc.onaudioprocess = e => {
    const pcm = downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate)
    parts.push(pcm); samples += pcm.length
    if (samples >= RATE * chunkSeconds) flush()
  }
  return {
    devices,
    async stop() {
      proc.onaudioprocess = null
      flush()
      streams.forEach(s => s.getTracks().forEach(t => t.stop()))
      await ctx.close().catch(() => {})
    },
  }
}

// ~2s sample for the pre-meeting check: level (RMS 0..1) and which devices were used.
export async function testAudio(): Promise<{ level: number; devices: RecorderDevices } | { error: string }> {
  try {
    let sumSq = 0, n = 0
    const rec = await startRecorder(b64 => {
      const bin = atob(b64), v = new DataView(new ArrayBuffer(bin.length))
      for (let i = 0; i < bin.length; i++) v.setUint8(i, bin.charCodeAt(i))
      for (let i = 0; i + 1 < bin.length; i += 2) { const s = v.getInt16(i, true) / 32768; sumSq += s * s; n++ }
    }, 60)
    await new Promise(r => setTimeout(r, 2000))
    await rec.stop()
    return { level: n ? Math.sqrt(sumSq / n) : 0, devices: rec.devices }
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'NotAllowedError') return { error: 'The browser blocked the microphone. Click the camera/mic icon in the address bar, allow the microphone for this site, and try again.' }
    if (name === 'NotFoundError') return { error: 'No microphone found.' }
    return { error: (e as Error).message || 'Could not open the microphone' }
  }
}
