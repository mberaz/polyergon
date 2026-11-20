import { DATA_DIR } from './dataDir'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface TranscriptSegment {
  t: number // epoch ms
  text: string
}

export interface MeetingNotes {
  topics: string[]
  decisions: string[]
  actionItems: string[]
}

// Extra material the user gave the meeting assistant (see meetingContext.ts)
export type ContextKind = 'text' | 'link' | 'session' | 'meeting'
export interface ContextItem {
  id: string
  kind: ContextKind
  label: string
  value: string // the text itself, a URL/path/reference, a live session id or a meeting id
  addedAt: number
  status: 'loading' | 'loaded' | 'failed'
  summary: string | null // the assistant's one-line read of it, or the failure reason
}

export type MeetingStatus = 'recording' | 'ended' | 'interrupted'

export interface Meeting {
  id: string
  title: string
  orgId: string
  startedAt: number
  endedAt: number | null
  status: MeetingStatus
  // The headless Claude conversation backing the assistant, once known
  claudeSessionId: string | null
}

// One row of the recordings library: the meeting plus what the list shows.
export interface LibraryEntry extends Meeting {
  snippet: string | null // first prose line of summary.md
  counts: { topics: number; decisions: number; actionItems: number }
  audio: { chunks: number; bytes: number }
  match: string | null // excerpt around the search hit, when a query is given
}

// First line of the summary that is prose, with markdown markers stripped.
export function summarySnippet(md: string | null): string | null {
  if (!md) return null
  for (const raw of md.split('\n')) {
    const line = raw.replace(/^[\s>*#\-\d.]+/, '').replace(/\*\*|__|`/g, '').trim()
    if (line.length >= 30) return line // shorter lines are headings like "Meeting Recap"
  }
  return null
}

// Excerpt of `text` around the first occurrence of `word` (lowercase).
function excerpt(text: string, word: string): string {
  const i = text.toLowerCase().indexOf(word)
  const start = Math.max(0, i - 60)
  return (start > 0 ? '…' : '') + text.slice(start, i + word.length + 80).replace(/\s+/g, ' ').trim() + '…'
}

const DEFAULT_BASE_DIR = join(DATA_DIR, 'meetings')

export class MeetingStore {
  private baseDir: string

  // baseDir defaults to the real on-disk location; tests must pass an
  // isolated path so they never touch the user's actual meetings.
  constructor(baseDir: string = DEFAULT_BASE_DIR) {
    this.baseDir = baseDir
  }

  dir(id: string): string {
    return join(this.baseDir, id)
  }

  private metaPath(id: string): string {
    return join(this.dir(id), 'meta.json')
  }

  create(title: string, orgId: string): Meeting {
    const meeting: Meeting = {
      id: randomUUID(),
      title: title || `Meeting ${new Date().toLocaleString()}`,
      orgId,
      startedAt: Date.now(),
      endedAt: null,
      status: 'recording',
      claudeSessionId: null,
    }
    mkdirSync(join(this.dir(meeting.id), 'audio'), { recursive: true })
    this.writeMeta(meeting)
    return meeting
  }

  get(id: string): Meeting | null {
    try { return JSON.parse(readFileSync(this.metaPath(id), 'utf-8')) } catch { return null }
  }

  update(id: string, patch: Partial<Meeting>): Meeting | null {
    const meeting = this.get(id)
    if (!meeting) return null
    const updated = { ...meeting, ...patch }
    this.writeMeta(updated)
    return updated
  }

  list(): Meeting[] {
    let ids: string[]
    try { ids = readdirSync(this.baseDir) } catch { return [] }
    const meetings: Meeting[] = []
    for (const id of ids) {
      const m = this.get(id)
      if (m) meetings.push(m)
    }
    return meetings.sort((a, b) => b.startedAt - a.startedAt)
  }

  // A server restart can't resume audio capture, so anything still marked
  // 'recording' from a previous run becomes 'interrupted' (transcript/notes
  // are preserved and a summary can still be generated).
  markInterrupted(): void {
    for (const m of this.list()) {
      if (m.status === 'recording') this.update(m.id, { status: 'interrupted', endedAt: m.endedAt ?? Date.now() })
    }
  }

  appendTranscript(id: string, seg: TranscriptSegment): void {
    appendFileSync(join(this.dir(id), 'transcript.jsonl'), JSON.stringify(seg) + '\n')
  }

  readTranscript(id: string): TranscriptSegment[] {
    try {
      return readFileSync(join(this.dir(id), 'transcript.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    } catch { return [] }
  }

  saveNotes(id: string, notes: MeetingNotes): void {
    writeFileSync(join(this.dir(id), 'notes.json'), JSON.stringify(notes, null, 2))
  }

  readNotes(id: string): MeetingNotes | null {
    try { return JSON.parse(readFileSync(join(this.dir(id), 'notes.json'), 'utf-8')) } catch { return null }
  }

  saveSummary(id: string, markdown: string): void {
    writeFileSync(join(this.dir(id), 'summary.md'), markdown)
  }

  readSummary(id: string): string | null {
    try { return readFileSync(join(this.dir(id), 'summary.md'), 'utf-8') } catch { return null }
  }

  // Recordings library. Every query word must appear somewhere in the title,
  // summary, notes or transcript (case-insensitive).
  // ponytail: reads every transcript per search; fine for hundreds of meetings, add an index past that.
  library(query = ''): LibraryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const out: LibraryEntry[] = []
    for (const m of this.list()) {
      const summary = this.readSummary(m.id)
      const notes = this.readNotes(m.id)
      let match: string | null = null
      if (words.length) {
        const transcript = this.readTranscript(m.id).map(s => s.text).join(' ')
        const notesText = notes ? [...notes.topics, ...notes.decisions, ...notes.actionItems].join(' ') : ''
        const hay = [m.title, summary ?? '', notesText, transcript].join('\n').toLowerCase()
        if (!words.every(w => hay.includes(w))) continue
        const w = words[0]
        for (const field of [summary ?? '', notesText, transcript]) {
          if (field.toLowerCase().includes(w)) { match = excerpt(field, w); break }
        }
      }
      let chunks = 0, bytes = 0
      try {
        for (const f of readdirSync(join(this.dir(m.id), 'audio'))) { chunks++; bytes += statSync(join(this.dir(m.id), 'audio', f)).size }
      } catch { /* no audio dir */ }
      out.push({
        ...m,
        snippet: summarySnippet(summary),
        counts: { topics: notes?.topics.length ?? 0, decisions: notes?.decisions.length ?? 0, actionItems: notes?.actionItems.length ?? 0 },
        audio: { chunks, bytes },
        match,
      })
    }
    return out
  }

  readContext(id: string): ContextItem[] {
    try { return JSON.parse(readFileSync(join(this.dir(id), 'context.json'), 'utf-8')) } catch { return [] }
  }

  saveContext(id: string, items: ContextItem[]): void {
    writeFileSync(join(this.dir(id), 'context.json'), JSON.stringify(items, null, 2))
  }

  private writeMeta(meeting: Meeting): void {
    if (!existsSync(this.dir(meeting.id))) mkdirSync(this.dir(meeting.id), { recursive: true })
    writeFileSync(this.metaPath(meeting.id), JSON.stringify(meeting, null, 2))
  }
}

declare global { var __meetingStore: MeetingStore | undefined }
export const meetingStore: MeetingStore =
  global.__meetingStore ?? (global.__meetingStore = new MeetingStore())
