'use client'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/sessionStore'

interface Props {
  sessionId: string
  cwd: string | null
  onSend: (prompt: string) => void
}

export function HistoryPanel({ sessionId, cwd, onSend }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setLoading(true)
    setMessages([])
    fetch(`/api/sessions/${sessionId}`)
      .then(r => r.json())
      .then(data => {
        setMessages(data.messages ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  function handleSend() {
    const prompt = input.trim()
    if (!prompt) return
    setInput('')
    onSend(prompt)
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <p className="text-xs text-gray-500 truncate">{cwd ?? sessionId}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading && <p className="text-gray-500 text-sm">Loading...</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[72%] bg-blue-600 rounded-2xl rounded-br-sm px-4 py-2">
                <p className="text-sm text-white whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            ) : (
              <div className="max-w-[90%]">
                <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-mono break-words">{m.content}</p>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-800 px-4 py-3 flex-shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Continue this session… (Enter to send)"
          rows={2}
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none resize-none placeholder-gray-600 font-mono"
        />
      </div>
    </div>
  )
}
