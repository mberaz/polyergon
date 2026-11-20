'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import type { Meeting, MeetingNotes, TranscriptSegment, ContextItem, ContextKind } from '@/lib/meetingStore'
import type { MeetingLive } from '@/hooks/useMeetings'

interface Props {
  meeting: Meeting
  live: MeetingLive | undefined
  orgName: string | null
  onStop: (id: string) => void
  onAsk: (id: string, question: string) => void
  onAddContext: (id: string, kind: ContextKind, value: string) => void
  sessionOptions: { id: string; label: string }[]
  meetingOptions: { id: string; label: string }[]
}

const CONTEXT_TABS: { kind: ContextKind; label: string }[] = [
  { kind: 'link', label: 'Link / file' },
  { kind: 'text', label: 'Paste text' },
  { kind: 'session', label: 'Session' },
  { kind: 'meeting', label: 'Past meeting' },
]

const STATUS_ICON: Record<ContextItem['status'], string> = { loading: '⏳', loaded: '✓', failed: '⚠' }

function ContextPanel({ items, isLive, onAdd, sessionOptions, meetingOptions }: {
  items: ContextItem[]
  isLive: boolean
  onAdd: (kind: ContextKind, value: string) => void
  sessionOptions: { id: string; label: string }[]
  meetingOptions: { id: string; label: string }[]
}) {
  const [kind, setKind] = useState<ContextKind>('link')
  const [value, setValue] = useState('')
  const input = 'w-full bg-gray-900 text-white rounded-lg px-2.5 py-1.5 text-xs outline-none border border-gray-800 focus:border-blue-600 placeholder-gray-600'
  const options = kind === 'session' ? sessionOptions : meetingOptions

  function add() {
    if (!value.trim()) return
    onAdd(kind, value)
    setValue('')
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Context</p>
      {items.length === 0 && !isLive && <p className="text-xs text-gray-600">No extra context was added.</p>}
      <ul className="space-y-1.5 mb-2">
        {items.map(it => (
          <li key={it.id} className="text-xs rounded-md bg-gray-900 px-2.5 py-1.5" title={it.kind === 'text' ? it.value.slice(0, 500) : it.value}>
            <div className="flex gap-1.5">
              <span className={it.status === 'failed' ? 'text-amber-400' : it.status === 'loaded' ? 'text-green-400' : ''}>{STATUS_ICON[it.status]}</span>
              <span className="text-gray-200 truncate">{it.label}</span>
            </div>
            {it.summary && <p className={`mt-0.5 leading-snug ${it.status === 'failed' ? 'text-amber-400/80' : 'text-gray-500'}`}>{it.summary}</p>}
            {it.status === 'loading' && <p className="mt-0.5 text-gray-600 italic">Claude is reading it…</p>}
          </li>
        ))}
      </ul>
      {isLive && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {CONTEXT_TABS.map(t => (
              <button key={t.kind} onClick={() => { setKind(t.kind); setValue('') }}
                className={`px-2 py-0.5 rounded text-[11px] border ${kind === t.kind ? 'bg-gray-700 border-gray-500 text-gray-100' : 'border-gray-800 text-gray-500 hover:text-gray-300'}`}>{t.label}</button>
            ))}
          </div>
          {kind === 'text' && (
            <textarea value={value} onChange={e => setValue(e.target.value)} rows={3} placeholder="Paste an agenda, email, doc excerpt…" className={`${input} resize-none`} />
          )}
          {kind === 'link' && (
            <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder="URL, file path, or Slack / Notion / Drive link" className={input} />
          )}
          {(kind === 'session' || kind === 'meeting') && (
            <select value={value} onChange={e => setValue(e.target.value)} className={input}>
              <option value="">{options.length ? `Pick a ${kind === 'session' ? 'session' : 'meeting'}…` : 'None available'}</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          <button onClick={add} disabled={!value.trim()} className="w-full text-xs rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 py-1 disabled:opacity-40">+ Add context</button>
        </div>
      )}
    </div>
  )
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

function NotesPanel({ notes }: { notes: MeetingNotes | null }) {
  if (!notes) return <p className="text-xs text-gray-600">Notes will appear as the meeting progresses…</p>
  const section = (label: string, items: string[]) => items.length > 0 && (
    <div className="mb-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <ul className="space-y-1">
        {items.map((item, i) => <li key={i} className="text-xs text-gray-300 leading-relaxed pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-gray-600">{item}</li>)}
      </ul>
    </div>
  )
  return (
    <div>
      {section('Topics', notes.topics)}
      {section('Decisions', notes.decisions)}
      {section('Action items', notes.actionItems)}
    </div>
  )
}

export function MeetingView({ meeting, live, orgName, onStop, onAsk, onAddContext, sessionOptions, meetingOptions }: Props) {
  const [baseTranscript, setBaseTranscript] = useState<TranscriptSegment[]>([])
  const [baseNotes, setBaseNotes] = useState<MeetingNotes | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [baseContext, setBaseContext] = useState<ContextItem[]>([])
  const [question, setQuestion] = useState('')
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const [stopping, setStopping] = useState(false)
  const [now, setNow] = useState(Date.now())
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const isLive = meeting.status === 'recording'

  // Base state from disk (covers page refresh mid-meeting and ended recaps);
  // live WS segments layer on top.
  useEffect(() => {
    fetch(`/api/meetings/${meeting.id}`)
      .then(r => r.json())
      .then(data => {
        setBaseTranscript(data.transcript ?? [])
        setBaseNotes(data.notes ?? null)
        setSummary(data.summary ?? null)
        setBaseContext(data.context ?? [])
      })
      .catch(() => {})
  }, [meeting.id, meeting.status])

  useEffect(() => {
    if (!isLive) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isLive])

  const transcript = useMemo(() => {
    const liveSegs = live?.transcript ?? []
    const lastBaseT = baseTranscript.at(-1)?.t ?? 0
    return [...baseTranscript, ...liveSegs.filter(s => s.t > lastBaseT)]
  }, [baseTranscript, live?.transcript])

  const notes = live?.notes ?? baseNotes
  const contextItems = live?.context ?? baseContext

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript.length])

  function submitQuestion() {
    const q = question.trim()
    if (!q) return
    setQuestion('')
    onAsk(meeting.id, q)
  }

  function copyAsMarkdown() {
    const md = [
      `# ${meeting.title}`,
      `_${new Date(meeting.startedAt).toLocaleString()}${meeting.endedAt ? ` — ${fmtDuration(meeting.endedAt - meeting.startedAt)}` : ''}_`,
      '',
      summary ?? '',
      '',
      '## Transcript',
      ...transcript.map(s => `- **${fmtTime(s.t)}** ${s.text}`),
    ].join('\n')
    navigator.clipboard.writeText(md).catch(() => {})
  }

  const suggestions = (live?.suggestions ?? []).filter(s => !dismissed[s.id])

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isLive
            ? <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            : <span className="w-2.5 h-2.5 rounded-full bg-gray-600 flex-shrink-0" />}
          <h2 className="text-white font-semibold truncate">{meeting.title}</h2>
          {orgName && <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 text-[10px] font-medium flex-shrink-0">{orgName}</span>}
          <span className="text-xs text-gray-500 flex-shrink-0">
            {isLive
              ? fmtDuration(now - meeting.startedAt)
              : `${new Date(meeting.startedAt).toLocaleString()} · ${meeting.endedAt ? fmtDuration(meeting.endedAt - meeting.startedAt) : ''}${meeting.status === 'interrupted' ? ' · interrupted' : ''}`}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isLive && (
            <button onClick={copyAsMarkdown} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded px-3 py-1.5 font-medium">Copy as Markdown</button>
          )}
          {isLive && (
            <button
              onClick={() => { setStopping(true); onStop(meeting.id) }}
              disabled={stopping}
              className="text-xs bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white rounded px-3 py-1.5 font-medium"
            >{stopping ? 'Stopping — generating summary…' : '■ Stop recording'}</button>
          )}
        </div>
      </div>

      {live?.lastError && (
        <div className="px-4 py-1.5 bg-yellow-900/30 border-b border-yellow-800/40 text-yellow-400 text-xs flex-shrink-0">{live.lastError}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Transcript / recap main pane */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-800">
          {!isLive && summary && (
            <div className="border-b border-gray-800 px-5 py-4 overflow-y-auto max-h-[45%] flex-shrink-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary</p>
              <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{summary}</div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Transcript</p>
            {transcript.length === 0
              ? <p className="text-xs text-gray-600">{isLive ? 'Listening… transcript appears here a few seconds after people speak.' : 'No transcript captured.'}</p>
              : transcript.map((s, i) => (
                  <div key={i} className="mb-2 flex gap-3">
                    <span className="text-[10px] text-gray-600 font-mono pt-0.5 flex-shrink-0">{fmtTime(s.t)}</span>
                    <p className="text-sm text-gray-200 leading-relaxed">{s.text}</p>
                  </div>
                ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* Right column: notes + assistant */}
        <div className="w-[340px] flex-shrink-0 flex flex-col min-h-0">
          <div className="max-h-[40%] overflow-y-auto px-4 py-3 border-b border-gray-800 flex-shrink-0">
            <ContextPanel
              items={contextItems}
              isLive={isLive}
              onAdd={(kind, value) => onAddContext(meeting.id, kind, value)}
              sessionOptions={sessionOptions}
              meetingOptions={meetingOptions.filter(o => o.id !== meeting.id)}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 border-b border-gray-800">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes</p>
            <NotesPanel notes={notes} />
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Assistant</p>
              {suggestions.map(s => (
                <div key={s.id} className="rounded-lg bg-blue-950/60 border border-blue-800/40 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-blue-200 leading-relaxed flex-1">{s.text}</p>
                    <button onClick={() => setDismissed(d => ({ ...d, [s.id]: true }))} className="text-blue-700 hover:text-blue-400 text-xs flex-shrink-0">×</button>
                  </div>
                </div>
              ))}
              {(live?.qa ?? []).map((qa, i) => (
                <div key={i} className="rounded-lg bg-gray-900 px-3 py-2">
                  <p className="text-xs text-gray-400 font-medium mb-1">Q: {qa.question}</p>
                  {qa.answer === null
                    ? <p className="text-xs text-gray-600 italic">thinking…</p>
                    : <p className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">{qa.answer}</p>}
                </div>
              ))}
              {suggestions.length === 0 && (live?.qa ?? []).length === 0 && (
                <p className="text-xs text-gray-600">Ask anything about the meeting so far…</p>
              )}
            </div>
            {isLive && (
              <div className="px-3 py-3 border-t border-gray-800 flex-shrink-0">
                <input
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitQuestion() }}
                  placeholder="Ask Claude… (Enter to send)"
                  className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none border border-gray-800 focus:border-blue-600 placeholder-gray-600"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
