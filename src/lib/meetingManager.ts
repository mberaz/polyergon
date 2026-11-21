import { meetingStore, Meeting, MeetingNotes, TranscriptSegment, ContextItem, ContextKind } from './meetingStore'
import { resolveContext } from './meetingContext'
import { randomUUID } from 'crypto'
import { startCapture, micTest, CaptureHandle } from './audioCapture'
import { transcribeChunk } from './transcriber'
import { MeetingAssistant } from './meetingAssistant'
import { getTranscriptionConfig, getAudioDevices } from './meetingConfig'
import { localWhisperProblem } from './localWhisper'
import { orgRegistry, DEFAULT_ORG_ID } from './orgRegistry'

const NOTES_TICK_MS = 90_000

function transcriptionProblem(): string | null {
  const c = getTranscriptionConfig()
  if (!c) return 'Transcription not configured: open Settings → Meetings and choose OpenAI, Azure OpenAI or Local Whisper.'
  return c.kind === 'local' ? localWhisperProblem() : null
}

export type MeetingEvent =
  | { type: 'meeting-status'; meeting: Meeting }
  | { type: 'meeting-transcript'; meetingId: string; segment: TranscriptSegment }
  | { type: 'meeting-notes'; meetingId: string; notes: MeetingNotes }
  | { type: 'meeting-suggestion'; meetingId: string; suggestion: string }
  | { type: 'meeting-answer'; meetingId: string; question: string; answer: string }
  | { type: 'meeting-error'; meetingId: string; message: string }
  | { type: 'meeting-context'; meetingId: string; items: ContextItem[] }

type Listener = (ev: MeetingEvent) => void

interface ActiveMeeting {
  meeting: Meeting
  capture: CaptureHandle
  assistant: MeetingAssistant
  chunkQueue: string[]
  transcribing: boolean
  restarted: boolean
  notesTimer: ReturnType<typeof setInterval>
  // Transcript chars already sent to the assistant — deltas only from here on
  sentTranscriptChars: number
  transcriptText: string
}

class MeetingManager {
  private active = new Map<string, ActiveMeeting>()
  private listeners = new Set<Listener>()

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(ev: MeetingEvent) {
    this.listeners.forEach(fn => fn(ev))
  }

  activeMeetings(): Meeting[] {
    return Array.from(this.active.values()).map(a => a.meeting)
  }

  micTest(): Promise<{ level: number } | { error: string }> {
    const d = getAudioDevices()
    return 'error' in d ? Promise.resolve(d) : micTest(d)
  }

  start(title: string, orgId: string): Meeting | { error: string } {
    const notReady = transcriptionProblem()
    if (notReady) return { error: notReady }
    const d = getAudioDevices()
    if ('error' in d) return d
    return this.begin(meetingStore.create(title, orgId || DEFAULT_ORG_ID))
  }

  // Continue an ended/interrupted meeting: same transcript, notes and assistant
  // conversation; new audio is appended. The summary is rewritten on stop.
  resume(meetingId: string): Meeting | { error: string } {
    const notReady = transcriptionProblem()
    if (notReady) return { error: notReady }
    const existing = meetingStore.get(meetingId)
    if (!existing) return { error: 'Meeting not found' }
    if (this.active.has(meetingId) || existing.status === 'recording') return { error: 'Meeting is already recording' }
    if (this.active.size > 0) return { error: 'Another meeting is recording. Stop it first.' }
    const d = getAudioDevices()
    if ('error' in d) return d
    const meeting = meetingStore.update(meetingId, { status: 'recording', endedAt: null }) ?? existing
    return this.begin(meeting)
  }

  private begin(meeting: Meeting): Meeting {
    const org = orgRegistry.get(meeting.orgId)
    const assistant = new MeetingAssistant({
      cwd: meetingStore.dir(meeting.id),
      configDir: org?.configDir ?? null,
      model: org?.model ?? null,
    }, meeting.claudeSessionId)
    assistant.onSessionId = (sid) => {
      const updated = meetingStore.update(meeting.id, { claudeSessionId: sid })
      const a = this.active.get(meeting.id)
      if (a && updated) a.meeting = updated
    }

    // On resume, the earlier transcript was already sent to the assistant
    const priorText = meetingStore.readTranscript(meeting.id).map(s => s.text).join('\n')
    const active: ActiveMeeting = {
      meeting,
      assistant,
      chunkQueue: [],
      transcribing: false,
      restarted: false,
      sentTranscriptChars: priorText.length,
      transcriptText: priorText,
      capture: this.spawnCapture(meeting.id),
      notesTimer: setInterval(() => this.notesTick(meeting.id), NOTES_TICK_MS),
    }
    this.active.set(meeting.id, active)
    this.emit({ type: 'meeting-status', meeting })
    return meeting
  }

  private spawnCapture(meetingId: string): CaptureHandle {
    const d = getAudioDevices()
    return startCapture(meetingStore.dir(meetingId), 'error' in d ? { mic: 'default', system: null } : d, {
      onChunk: (filePath) => this.enqueueChunk(meetingId, filePath),
      onExit: (code, stderrTail) => {
        const a = this.active.get(meetingId)
        if (!a) return
        // One automatic restart; a second death surfaces to the user
        if (!a.restarted) {
          a.restarted = true
          a.capture = this.spawnCapture(meetingId)
          this.emit({ type: 'meeting-error', meetingId, message: 'Audio capture restarted after an unexpected exit' })
        } else {
          this.emit({ type: 'meeting-error', meetingId, message: `Audio capture died (ffmpeg exit ${code}): ${stderrTail.split('\n').at(-1) ?? ''}` })
          this.stop(meetingId).catch(() => {})
        }
      },
    })
  }

  private enqueueChunk(meetingId: string, filePath: string) {
    const a = this.active.get(meetingId)
    if (!a) return
    a.chunkQueue.push(filePath)
    this.drainChunks(meetingId)
  }

  private async drainChunks(meetingId: string) {
    const a = this.active.get(meetingId)
    if (!a || a.transcribing) return
    a.transcribing = true
    try {
      const config = getTranscriptionConfig()
      while (a.chunkQueue.length > 0) {
        const filePath = a.chunkQueue.shift()!
        if (!config) continue
        try {
          // Last ~200 chars of transcript as context for language consistency
          const text = await transcribeChunk(filePath, config, a.transcriptText.slice(-200))
          if (text) {
            const segment: TranscriptSegment = { t: Date.now(), text }
            meetingStore.appendTranscript(meetingId, segment)
            a.transcriptText += (a.transcriptText ? '\n' : '') + text
            this.emit({ type: 'meeting-transcript', meetingId, segment })
          }
        } catch (e) {
          this.emit({ type: 'meeting-error', meetingId, message: `Transcription gap: ${e instanceof Error ? e.message : 'unknown error'}` })
        }
      }
    } finally {
      a.transcribing = false
    }
  }

  private transcriptDelta(a: ActiveMeeting): string {
    const delta = a.transcriptText.slice(a.sentTranscriptChars)
    a.sentTranscriptChars = a.transcriptText.length
    return delta
  }

  private async notesTick(meetingId: string) {
    const a = this.active.get(meetingId)
    if (!a) return
    const delta = a.transcriptText.slice(a.sentTranscriptChars)
    if (!delta.trim()) return // nobody said anything new — skip the call
    a.sentTranscriptChars = a.transcriptText.length
    try {
      const { notes, suggestion } = await a.assistant.notesTick(delta)
      if (notes) {
        meetingStore.saveNotes(meetingId, notes)
        this.emit({ type: 'meeting-notes', meetingId, notes })
      }
      if (suggestion) this.emit({ type: 'meeting-suggestion', meetingId, suggestion })
    } catch (e) {
      // Notes going stale is fine; next tick retries with a bigger delta
      this.emit({ type: 'meeting-error', meetingId, message: `Notes update failed (will retry): ${e instanceof Error ? e.message : 'unknown'}` })
      a.sentTranscriptChars -= delta.length // resend this delta next tick
    }
  }

  async ask(meetingId: string, question: string): Promise<void> {
    const a = this.active.get(meetingId)
    if (!a) {
      this.emit({ type: 'meeting-error', meetingId, message: 'Meeting is not active' })
      return
    }
    try {
      const answer = await a.assistant.ask(question, this.transcriptDelta(a))
      this.emit({ type: 'meeting-answer', meetingId, question, answer })
    } catch (e) {
      this.emit({ type: 'meeting-error', meetingId, message: `Ask failed: ${e instanceof Error ? e.message : 'unknown'}` })
    }
  }

  async addContext(meetingId: string, kind: ContextKind, value: string): Promise<void> {
    const a = this.active.get(meetingId)
    if (!a) {
      this.emit({ type: 'meeting-error', meetingId, message: 'Context can only be added while the meeting is recording' })
      return
    }
    const item: ContextItem = { id: randomUUID(), kind, label: value.trim().slice(0, 60) || kind, value, addedAt: Date.now(), status: 'loading', summary: null }
    const save = (patch: Partial<ContextItem>) => {
      const items = meetingStore.readContext(meetingId)
      const i = items.findIndex(x => x.id === item.id)
      if (i >= 0) items[i] = { ...items[i], ...patch }
      else items.push({ ...item, ...patch })
      meetingStore.saveContext(meetingId, items)
      this.emit({ type: 'meeting-context', meetingId, items })
    }
    save({})
    try {
      const resolved = await resolveContext(kind, value)
      save({ label: resolved.label })
      const reply = (await a.assistant.addContext(resolved.label, resolved.body, resolved.fetch)).trim().split('\n')[0]
      save(/^FAILED/i.test(reply) ? { status: 'failed', summary: reply.replace(/^FAILED:?\s*/i, '') } : { status: 'loaded', summary: reply })
    } catch (e) {
      save({ status: 'failed', summary: e instanceof Error ? e.message : 'unknown error' })
    }
  }

  async stop(meetingId: string): Promise<void> {
    const a = this.active.get(meetingId)
    if (!a) return
    clearInterval(a.notesTimer)
    // Graceful ffmpeg stop flushes the final chunks into the queue (the
    // meeting must still be in `active` for enqueueChunk to accept them)
    await a.capture.stop()
    this.drainChunks(meetingId)
    // Wait for the final chunks to transcribe, but cap it — a wedged transcribe
    // must never hang teardown forever (transcribeChunk itself now times out at
    // 30s/attempt, so ~45s is a generous ceiling past normal drain).
    const drainDeadline = Date.now() + 45_000
    while ((a.chunkQueue.length > 0 || a.transcribing) && Date.now() < drainDeadline) {
      await new Promise(r => setTimeout(r, 250))
    }
    this.active.delete(meetingId)

    let meeting = meetingStore.update(meetingId, { status: 'ended', endedAt: Date.now() }) ?? a.meeting
    this.emit({ type: 'meeting-status', meeting })

    try {
      const summary = await a.assistant.summarize(this.transcriptDelta(a))
      if (summary.trim()) meetingStore.saveSummary(meetingId, summary)
    } catch (e) {
      this.emit({ type: 'meeting-error', meetingId, message: `Summary failed: ${e instanceof Error ? e.message : 'unknown'}` })
    }
    meeting = meetingStore.get(meetingId) ?? meeting
    this.emit({ type: 'meeting-status', meeting })
  }
}

declare global { var __meetingManager: MeetingManager | undefined }
export const meetingManager: MeetingManager =
  global.__meetingManager ?? (global.__meetingManager = new MeetingManager())
