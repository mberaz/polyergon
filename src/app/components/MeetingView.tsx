'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import type { Meeting, MeetingNotes, TranscriptSegment, ContextItem, ContextKind } from '@/lib/meetingStore'
import type { MeetingLive } from '@/hooks/useMeetings'
import { Markdown } from './Markdown'

interface Props {
  meeting: Meeting
  live: MeetingLive | undefined
  orgName: string | null
  onStop: (id: string) => void
  onAsk: (id: string, question: string) => void
  onAddContext: (id: string, kind: ContextKind, value: string) => void
  onBack: () => void
  sessionOptions: { id: string; label: string }[]
  meetingOptions: { id: string; label: string }[]
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

// Position in the recording, e.g. 04:12 or 1:02:45
function fmtOffset(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return <>{text.split(re).map((p, i) => i % 2 ? <mark key={i} className="bg-amber-400/25 text-amber-100 rounded-sm px-0.5">{p}</mark> : p)}</>
}

function NotesCards({ notes }: { notes: MeetingNotes }) {
  const card = (title: string, items: string[], marker: string) => items.length > 0 && (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title} <span className="text-gray-600">{items.length}</span></p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-gray-300 leading-relaxed">
            <span className="text-gray-500 flex-shrink-0">{marker}</span><span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className="space-y-4">
      {card('Decisions', notes.decisions, '✓')}
      {card('Action items', notes.actionItems, '☐')}
      {card('Topics', notes.topics, '•')}
    </div>
  )
}

const CONTEXT_TABS: { kind: ContextKind; label: string }[] = [
  { kind: 'link', label: 'Link / file' },
  { kind: 'slack', label: 'Slack channel' },
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
          {kind === 'slack' && (
            <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder="#channel-name or a Slack link" className={input} />
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

export function MeetingView({ meeting, live, orgName, onStop, onAsk, onAddContext, onBack, sessionOptions, meetingOptions }: Props) {
  const [baseTranscript, setBaseTranscript] = useState<TranscriptSegment[]>([])
  const [baseNotes, setBaseNotes] = useState<MeetingNotes | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [baseContext, setBaseContext] = useState<ContextItem[]>([])
  const [question, setQuestion] = useState('')
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const [stopping, setStopping] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())
  const isLive = meeting.status === 'recording'
  const [tab, setTab] = useState<'summary' | 'transcript'>(isLive ? 'transcript' : 'summary')
  const [find, setFind] = useState('')
  const transcriptEndRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => { setTab(isLive ? 'transcript' : 'summary'); setFind('') }, [meeting.id, isLive])

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
  const q = find.trim()
  const shownTranscript = q ? transcript.filter(s => s.text.toLowerCase().includes(q.toLowerCase())) : transcript

  useEffect(() => {
    if (isLive && tab === 'transcript' && !q) transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript.length, isLive, tab, q])

  function submitQuestion() {
    const text = question.trim()
    if (!text) return
    setQuestion('')
    onAsk(meeting.id, text)
  }

  function copyAsMarkdown() {
    const md = [
      `# ${meeting.title}`,
      `_${new Date(meeting.startedAt).toLocaleString()}${meeting.endedAt ? ` — ${fmtDuration(meeting.endedAt - meeting.startedAt)}` : ''}_`,
      '',
      summary ?? '',
      '',
      '## Transcript',
      ...transcript.map(s => `- **${fmtOffset(s.t - meeting.startedAt)}** ${s.text}`),
    ].join('\n')
    navigator.clipboard.writeText(md).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  const suggestions = (live?.suggestions ?? []).filter(s => !dismissed[s.id])
  const qa = live?.qa ?? []
  const tabBtn = (key: typeof tab, label: string) => (
    <button onClick={() => setTab(key)}
      className={`px-1 pb-2.5 pt-1 text-sm border-b-2 transition-colors ${tab === key ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>{label}</button>
  )

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-4 pb-3 border-b border-gray-800 flex-shrink-0">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-300 mb-2">← Recordings</button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {isLive && <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
              <h1 className="text-xl font-semibold text-white truncate">{meeting.title}</h1>
              {orgName && <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 text-[10px] font-medium flex-shrink-0">{orgName}</span>}
            </div>
            <p className="text-xs text-gray-500 mt-1 tabular-nums">
              {new Date(meeting.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {' · '}{isLive ? <span className="text-red-400">Recording {fmtDuration(now - meeting.startedAt)}</span> : meeting.endedAt ? fmtDuration(meeting.endedAt - meeting.startedAt) : ''}
              {meeting.status === 'interrupted' && <span className="text-amber-400"> · interrupted</span>}
              {notes && <> · {notes.decisions.length} decisions · {notes.actionItems.length} action items</>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isLive && (
              <button onClick={copyAsMarkdown} className="text-xs border border-gray-700 hover:bg-gray-800 text-gray-200 rounded-md px-3 py-1.5">{copied ? 'Copied ✓' : 'Copy as Markdown'}</button>
            )}
            {isLive && (
              <button
                onClick={() => { setStopping(true); onStop(meeting.id) }}
                disabled={stopping}
                className="text-xs bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white rounded-md px-3 py-1.5 font-medium"
              >{stopping ? 'Stopping — writing summary…' : '■ Stop recording'}</button>
            )}
          </div>
        </div>
      </div>

      {live?.lastError && (
        <div className="px-6 py-1.5 bg-amber-900/20 border-b border-amber-800/30 text-amber-400 text-xs flex-shrink-0">{live.lastError}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Main: Summary / Transcript */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 pt-2 border-b border-gray-800 flex items-end gap-5 flex-shrink-0">
            {tabBtn('summary', isLive ? 'Live notes' : 'Summary')}
            {tabBtn('transcript', `Transcript${transcript.length ? ` · ${transcript.length}` : ''}`)}
            {tab === 'transcript' && transcript.length > 0 && (
              <input value={find} onChange={e => setFind(e.target.value)} placeholder="Find in transcript"
                className="ml-auto mb-2 w-56 bg-gray-900 border border-gray-800 focus:border-gray-600 rounded-md px-2.5 py-1 text-xs outline-none placeholder-gray-600" />
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {tab === 'summary' && (
              <div className="px-6 py-5 max-w-3xl">
                {summary ? <Markdown text={summary} />
                  : notes ? <NotesCards notes={notes} />
                  : <p className="text-sm text-gray-500">{isLive ? 'Notes appear here every couple of minutes while people talk.' : 'No summary was generated for this meeting.'}</p>}
              </div>
            )}
            {tab === 'transcript' && (
              <div className="px-6 py-4 max-w-4xl">
                {shownTranscript.length === 0
                  ? <p className="text-sm text-gray-500">{q ? `No lines contain “${q}”.` : isLive ? 'Listening… text appears a few seconds after people speak.' : 'No transcript captured.'}</p>
                  : shownTranscript.map((s, i) => (
                      <div key={i} className="flex gap-4 py-1.5 group">
                        <span className="text-[11px] text-gray-600 font-mono pt-0.5 w-14 flex-shrink-0 text-right tabular-nums" title={fmtTime(s.t)}>{fmtOffset(s.t - meeting.startedAt)}</span>
                        <p className="text-sm text-gray-300 leading-relaxed"><Highlight text={s.text} q={q} /></p>
                      </div>
                    ))}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Right: context + assistant */}
        <div className="w-[360px] flex-shrink-0 border-l border-gray-800 flex flex-col min-h-0 bg-gray-900/20">
          <div className="max-h-[45%] overflow-y-auto px-4 py-4 border-b border-gray-800 flex-shrink-0">
            <ContextPanel
              items={contextItems}
              isLive={isLive}
              onAdd={(kind, value) => onAddContext(meeting.id, kind, value)}
              sessionOptions={sessionOptions}
              meetingOptions={meetingOptions.filter(o => o.id !== meeting.id)}
            />
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Assistant</p>
              {suggestions.map(s => (
                <div key={s.id} className="rounded-lg bg-blue-950/50 border border-blue-800/40 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-blue-200 leading-relaxed flex-1">💡 {s.text}</p>
                    <button onClick={() => setDismissed(d => ({ ...d, [s.id]: true }))} className="text-blue-700 hover:text-blue-400 text-xs flex-shrink-0" aria-label="Dismiss">✕</button>
                  </div>
                </div>
              ))}
              {qa.map((x, i) => (
                <div key={i} className="space-y-1.5">
                  <p className="ml-8 rounded-lg bg-blue-600/90 text-white text-xs px-3 py-2 leading-relaxed">{x.question}</p>
                  <div className="mr-4 rounded-lg bg-gray-800/80 px-3 py-2">
                    {x.answer === null
                      ? <p className="text-xs text-gray-500 italic">Thinking…</p>
                      : <p className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">{x.answer}</p>}
                  </div>
                </div>
              ))}
              {suggestions.length === 0 && qa.length === 0 && (
                <p className="text-xs text-gray-600">{isLive ? 'Ask anything about the meeting so far. Suggestions appear here when Claude has something useful.' : 'Questions asked during the meeting appear here.'}</p>
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
