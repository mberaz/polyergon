import { spawn } from 'child_process'
import type { MeetingNotes } from './meetingStore'

const CALL_TIMEOUT_MS = 180_000

export interface AssistantSpawnOpts {
  cwd: string
  configDir: string | null
  model: string | null
}

export interface NotesTickResult {
  notes: MeetingNotes | null
  suggestion: string | null
}

const PREAMBLE = `You are a live meeting assistant. You receive transcript excerpts from an ongoing meeting as they happen (transcribed from audio — expect some transcription errors, and possibly mixed Hebrew/English). Your job across this conversation:
- Maintain structured meeting notes (topics discussed, decisions made, action items with owners when identifiable).
- Answer questions the user asks mid-meeting, concisely — they're in the meeting and need fast answers.
- Occasionally offer ONE genuinely useful proactive suggestion (an answer to a question someone raised, a factual correction, relevant context). Most updates need no suggestion — only include one when it truly helps.
Never invent transcript content. If the transcript is too sparse to conclude something, leave it out.`

// One persistent headless Claude conversation (claude -p / --resume) per
// meeting, under the meeting org's config dir + model. Calls are serialized —
// notes ticks, asks and the summary share one conversation and must not race.
export class MeetingAssistant {
  private opts: AssistantSpawnOpts
  private sessionId: string | null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(opts: AssistantSpawnOpts, existingSessionId: string | null = null) {
    this.opts = opts
    this.sessionId = existingSessionId
  }

  // Exposed so the manager can persist it and survive server restarts
  getSessionId(): string | null {
    return this.sessionId
  }

  onSessionId: ((id: string) => void) | null = null

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  private call(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', '--output-format', 'json',
        '--permission-mode', 'bypassPermissions',
        ...(this.opts.model ? ['--model', this.opts.model] : []),
        ...(this.sessionId ? ['--resume', this.sessionId] : []),
      ]
      const env = {
        ...Object.fromEntries(
          ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LC_ALL']
            .filter(k => process.env[k])
            .map(k => [k, process.env[k]!])
        ),
        ...(this.opts.configDir ? { CLAUDE_CONFIG_DIR: this.opts.configDir } : {}),
      } as NodeJS.ProcessEnv
      const proc = spawn('claude', args, { cwd: this.opts.cwd, env })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-1000) })
      const killer = setTimeout(() => proc.kill('SIGKILL'), CALL_TIMEOUT_MS)
      proc.on('error', (e) => { clearTimeout(killer); reject(e) })
      proc.on('exit', (code) => {
        clearTimeout(killer)
        if (code !== 0) {
          reject(new Error(`claude -p exited ${code}: ${stderr.trim().slice(-300)}`))
          return
        }
        try {
          const parsed = JSON.parse(stdout) as { result?: string; session_id?: string }
          if (parsed.session_id) {
            this.sessionId = parsed.session_id
            this.onSessionId?.(parsed.session_id)
          }
          resolve(parsed.result ?? '')
        } catch {
          reject(new Error(`unparseable claude output: ${stdout.slice(0, 200)}`))
        }
      })
      proc.stdin.write(prompt)
      proc.stdin.end()
    })
  }

  private withPreamble(body: string): string {
    // The preamble only needs to be sent once; --resume keeps the context
    return this.sessionId ? body : `${PREAMBLE}\n\n${body}`
  }

  notesTick(transcriptDelta: string): Promise<NotesTickResult> {
    return this.enqueue(async () => {
      const prompt = this.withPreamble(
        `New transcript since the last update:\n---\n${transcriptDelta}\n---\n` +
        `Update your running notes for the whole meeting so far. Respond with ONLY a JSON object, no prose, no markdown fences:\n` +
        `{"notes": {"topics": string[], "decisions": string[], "actionItems": string[]}, "suggestion": string | null}`
      )
      const raw = await this.call(prompt)
      return parseNotesTick(raw)
    })
  }

  ask(question: string, transcriptDelta: string): Promise<string> {
    return this.enqueue(() => this.call(this.withPreamble(
      (transcriptDelta ? `New transcript since the last update:\n---\n${transcriptDelta}\n---\n` : '') +
      `The user asks (mid-meeting, answer concisely and directly): ${question}`
    )))
  }

  // Background material for the rest of the meeting. Returns the assistant's
  // one-line read of it; a line starting with FAILED means it couldn't load it.
  addContext(label: string, body: string, fetch: boolean): Promise<string> {
    return this.enqueue(() => this.call(this.withPreamble(fetch
      ? `The user added a source as background context for this meeting: ${body}\n` +
        `Load it now with your tools (web fetch, file read, or the matching MCP connector such as Slack, Notion, Google Drive or Gmail). ` +
        `Keep what you learn in mind for notes, answers and suggestions for the rest of the meeting. ` +
        `Reply with ONE short line saying what it is about, or "FAILED: <reason>" if you cannot load it.`
      : `The user added background context for this meeting (${label}):\n---\n${body}\n---\n` +
        `Keep it in mind for notes, answers and suggestions for the rest of the meeting. Reply with ONE short line saying what it is about.`
    )))
  }

  summarize(transcriptDelta: string): Promise<string> {
    return this.enqueue(() => this.call(this.withPreamble(
      (transcriptDelta ? `Final transcript segment:\n---\n${transcriptDelta}\n---\n` : '') +
      `The meeting has ended. Write a markdown recap of the ENTIRE meeting with sections: ## Summary (a few sentences), ## Decisions (bullets), ## Action Items (bullets with owners where known). Respond with only the markdown.`
    )))
  }
}

// Tolerates fenced or prose-wrapped JSON — extracts the outermost object
export function parseNotesTick(raw: string): NotesTickResult {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return { notes: null, suggestion: null }
  try {
    const obj = JSON.parse(raw.slice(start, end + 1))
    const n = obj.notes
    const notes: MeetingNotes | null = n && typeof n === 'object'
      ? {
          topics: Array.isArray(n.topics) ? n.topics.filter((x: unknown) => typeof x === 'string') : [],
          decisions: Array.isArray(n.decisions) ? n.decisions.filter((x: unknown) => typeof x === 'string') : [],
          actionItems: Array.isArray(n.actionItems) ? n.actionItems.filter((x: unknown) => typeof x === 'string') : [],
        }
      : null
    return { notes, suggestion: typeof obj.suggestion === 'string' && obj.suggestion.trim() ? obj.suggestion.trim() : null }
  } catch {
    return { notes: null, suggestion: null }
  }
}
