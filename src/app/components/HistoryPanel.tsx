'use client'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/sessionStore'
import { screenBottom, typeKeys } from './Terminal'
import { parseScreenQuestion, type ScreenQuestion } from '@/lib/screenQuestion'

interface Props {
  sessionId: string | null // Claude's session id (transcript); null until Claude creates it
  waiting: boolean
  onSend: (prompt: string) => void
  onClose: () => void
}

// Reading view of a live session. The terminal (xterm.js) can't lay out
// right-to-left text, so Hebrew/Arabic come out scrambled there. Here each
// paragraph gets dir="auto", so the browser orders it correctly.
export function HistoryPanel({ sessionId, waiting, onSend, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const [question, setQuestion] = useState<ScreenQuestion | null>(null)

  useEffect(() => {
    if (!waiting) { setQuestion(null); return }
    const read = () => setQuestion(q => { const n = parseScreenQuestion(screenBottom()); return JSON.stringify(n) === JSON.stringify(q) ? q : n })
    read()
    const t = setInterval(read, 1000)
    return () => clearInterval(t)
  }, [waiting])

  useEffect(() => {
    if (!sessionId) return
    let stop = false
    const load = () => fetch(`/api/sessions/${sessionId}`).then(r => r.json())
      .then(d => { if (!stop) setMessages(m => JSON.stringify(m) === JSON.stringify(d.messages ?? []) ? m : d.messages ?? []) })
      .catch(() => {})
    load()
    const t = setInterval(load, 3000) // ponytail: polling; switch to a transcript watch if it gets heavy
    return () => { stop = true; clearInterval(t) }
  }, [sessionId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }) }, [messages, question])

  function send() {
    const prompt = input.trim()
    if (!prompt) return
    setInput('')
    onSend(prompt)
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-gray-950">
      <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
        <p className="text-xs text-gray-500">Chat view · last 30 messages, updates live</p>
        <button onClick={onClose} className="ml-auto text-xs px-2.5 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800">Terminal view</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!sessionId && <p className="text-gray-500 text-sm">Send a first message in the terminal, then the conversation shows here.</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[72%] bg-blue-600 rounded-2xl px-4 py-2' : 'max-w-[90%]'}>
              {m.content.split(/\n{2,}/).map((para, j) => (
                <p key={j} dir="auto" className={`text-sm whitespace-pre-wrap break-words leading-relaxed ${m.role === 'user' ? 'text-white' : 'text-gray-200'} ${j ? 'mt-2' : ''}`}>{para}</p>
              ))}
            </div>
          </div>
        ))}
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
        <textarea
          dir="auto"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Write to the session… (Enter to send)"
          rows={2}
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none resize-none placeholder-gray-600"
        />
      </div>
    </div>
  )
}
