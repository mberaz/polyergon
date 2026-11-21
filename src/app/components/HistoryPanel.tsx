'use client'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/sessionStore'
import { screenBottom, typeKeys } from './Terminal'
import { parseScreenQuestion, activityLine, type ScreenQuestion } from '@/lib/screenQuestion'

interface Props {
  sessionId: string | null // Claude's session id (transcript); null until Claude creates it
  status: 'thinking' | 'waiting' | 'idle' | undefined
  onSend: (prompt: string) => void
  onClose: () => void
}

// Reading view of a live session. The terminal (xterm.js) can't lay out
// right-to-left text, so Hebrew/Arabic come out scrambled there. Here each
// paragraph gets dir="auto", so the browser orders it correctly.
export function HistoryPanel({ sessionId, status, onSend, onClose }: Props) {
  const waiting = status === 'waiting', thinking = status === 'thinking'
  const [pending, setPending] = useState<{ text: string; at: number }[]>([]) // sent, not yet in the transcript
  const [activity, setActivity] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const [question, setQuestion] = useState<ScreenQuestion | null>(null)
  const [attached, setAttached] = useState<string[]>([]) // dropped files' paths, added on send
  const [dragging, setDragging] = useState(false)
  const [dropError, setDropError] = useState('')

  async function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false); setDropError('')
    const files = [...e.dataTransfer.files].filter(f => f.size <= 25 * 1024 * 1024)
    if (!files.length) { if (e.dataTransfer.files.length) setDropError('Files over 25 MB are skipped'); return }
    const read = (f: File) => new Promise<{ name: string; data: string }>((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, data: String(r.result).split(',')[1] ?? '' }); r.onerror = () => rej(r.error); r.readAsDataURL(f) })
    try {
      const r = await fetch('/api/drop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: await Promise.all(files.map(read)) }) }).then(x => x.json())
      if (r.paths?.length) setAttached(a => [...a, ...r.paths])
      else setDropError(r.error ?? 'Could not add the file')
    } catch { setDropError('Could not add the file') }
  }

  useEffect(() => {
    if (!waiting) { setQuestion(null); return }
    const read = () => setQuestion(q => { const n = parseScreenQuestion(screenBottom()); return JSON.stringify(n) === JSON.stringify(q) ? q : n })
    read()
    const t = setInterval(read, 1000)
    return () => clearInterval(t)
  }, [waiting])

  // Fast while Claude works or a message is on its way; reads only the transcript's end
  const busy = thinking || pending.length > 0
  useEffect(() => {
    if (!sessionId) return
    let stop = false
    const load = () => fetch(`/api/sessions/${sessionId}`).then(r => r.json())
      .then(d => {
        if (stop) return
        const msgs: ChatMessage[] = d.messages ?? []
        setMessages(m => JSON.stringify(m) === JSON.stringify(msgs) ? m : msgs)
        // a sent message shows up as a user message in the transcript: drop its "sending" copy
        setPending(p => p.filter(x => !msgs.some(m => m.role === 'user' && m.content.trim().startsWith(x.text.trim().slice(0, 60)))))
      })
      .catch(() => {})
    load()
    const t = setInterval(load, busy ? 1000 : 3000)
    return () => { stop = true; clearInterval(t) }
  }, [sessionId, busy])

  // Live "what is Claude doing" line from the terminal
  useEffect(() => {
    if (!thinking) { setActivity(null); return }
    const read = () => setActivity(activityLine(screenBottom()))
    read()
    const t = setInterval(read, 1000)
    return () => clearInterval(t)
  }, [thinking])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }) }, [messages, question, pending, thinking])

  function send() {
    const files = attached.map(p => /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p).join(' ')
    const prompt = [input.trim(), files].filter(Boolean).join(' ')
    if (!prompt) return
    setInput(''); setAttached([])
    setPending(p => [...p, { text: prompt, at: Date.now() }])
    onSend(prompt)
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-gray-950"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={onDrop}>
      {dragging && (
        <div className="absolute inset-2 z-20 rounded-xl border-2 border-dashed border-blue-400 bg-blue-950/40 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-blue-100 bg-gray-900/90 px-4 py-2 rounded-lg">Drop to attach to your message</p>
        </div>
      )}
      <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
        <p className="text-xs text-gray-500">Chat view · last 30 messages, updates live</p>
        <button onClick={onClose} className="ml-auto text-xs px-2.5 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800">Terminal view</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!messages.length && !pending.length && <p className="text-gray-500 text-sm">{sessionId ? 'Loading the conversation…' : 'New session. Write your first message below.'}</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[72%] bg-blue-600 rounded-2xl px-4 py-2' : 'max-w-[90%]'}>
              {m.content.split(/\n{2,}/).map((para, j) => (
                <p key={j} dir="auto" className={`text-sm whitespace-pre-wrap break-words leading-relaxed ${m.role === 'user' ? 'text-white' : 'text-gray-200'} ${j ? 'mt-2' : ''}`}>{para}</p>
              ))}
            </div>
          </div>
        ))}
        {pending.map(p => (
          <div key={p.at} className="flex justify-end">
            <div className="max-w-[72%] bg-blue-600/60 rounded-2xl px-4 py-2">
              <p dir="auto" className="text-sm whitespace-pre-wrap break-words text-white">{p.text}</p>
              <p className="text-[10px] text-blue-100/70 mt-1">{thinking ? 'Waiting for Claude to finish its current step…' : 'Sending…'}</p>
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex items-center gap-2 text-sm text-blue-200">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>Claude is working{activity ? `: ${activity}` : '…'}</span>
          </div>
        )}
        {question && (
          <div className="border border-emerald-700/60 bg-emerald-950/30 rounded-xl px-4 py-3">
            <p className="text-xs text-emerald-300 mb-2">Claude is asking</p>
            {question.text && <p dir="auto" className="text-sm text-gray-100 whitespace-pre-wrap break-words mb-3">{question.text}</p>}
            <div className="flex flex-col gap-1.5">
              {question.options.map(o => (
                <button key={o.n} onClick={() => typeKeys(o.n)} dir="auto"
                  className="text-left text-sm px-3 py-1.5 rounded border border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800 hover:border-emerald-600">
                  <span className="text-gray-500 mr-2">{o.n}.</span>{o.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="mt-2 text-xs text-gray-400 hover:text-gray-200 underline">Answer in the terminal instead</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-800 px-4 py-3 flex-shrink-0">
        {(attached.length > 0 || dropError) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attached.map(p => (
              <span key={p} title={p} className="text-[11px] pl-2 pr-1 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-200 flex items-center gap-1">
                📎 {p.split('/').pop()}
                <button onClick={() => setAttached(a => a.filter(x => x !== p))} aria-label="Remove" className="text-gray-400 hover:text-white px-0.5">×</button>
              </span>
            ))}
            {dropError && <span className="text-[11px] text-red-400">{dropError}</span>}
          </div>
        )}
        <textarea
          dir="auto"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Write to the session… (Enter to send, drop files to attach)"
          rows={2}
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none resize-none placeholder-gray-600"
        />
      </div>
    </div>
  )
}
