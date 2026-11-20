'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { Meeting, MeetingNotes, TranscriptSegment, ContextItem, ContextKind } from '@/lib/meetingStore'

export interface MeetingSuggestion { id: string; text: string; t: number }
export interface MeetingQA { question: string; answer: string | null; t: number }

export interface MeetingLive {
  transcript: TranscriptSegment[]
  notes: MeetingNotes | null
  suggestions: MeetingSuggestion[]
  qa: MeetingQA[]
  lastError: string | null
  context: ContextItem[] | null // null until the server sends an update
}

const EMPTY_LIVE: MeetingLive = { transcript: [], notes: null, suggestions: [], qa: [], lastError: null, context: null }

// Live meeting state over the shared app WebSocket (listener added with
// addEventListener so it coexists with useTerminal's onmessage), plus the
// meetings list from REST.
export function useMeetings(ws: WebSocket | null) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [live, setLive] = useState<Record<string, MeetingLive>>({})
  const wsRef = useRef(ws)
  wsRef.current = ws

  const fetchMeetings = useCallback(() => {
    return fetch('/api/meetings').then(r => r.json()).then(setMeetings).catch(() => {})
  }, [])

  useEffect(() => { fetchMeetings() }, [fetchMeetings])

  useEffect(() => {
    if (!ws) return
    fetchMeetings() // reconnect = possible server restart; resync the list

    function updateLive(meetingId: string, fn: (l: MeetingLive) => MeetingLive) {
      setLive(prev => ({ ...prev, [meetingId]: fn(prev[meetingId] ?? EMPTY_LIVE) }))
    }

    function onMessage(event: MessageEvent) {
      let msg: { type: string; [k: string]: unknown }
      try { msg = JSON.parse(event.data as string) } catch { return }

      if (msg.type === 'meeting-started' || msg.type === 'meeting-status') {
        const meeting = msg.meeting as Meeting
        setMeetings(prev => {
          const rest = prev.filter(m => m.id !== meeting.id)
          return [meeting, ...rest].sort((a, b) => b.startedAt - a.startedAt)
        })
      } else if (msg.type === 'meeting-transcript') {
        updateLive(msg.meetingId as string, l => ({ ...l, transcript: [...l.transcript, msg.segment as TranscriptSegment] }))
      } else if (msg.type === 'meeting-notes') {
        updateLive(msg.meetingId as string, l => ({ ...l, notes: msg.notes as MeetingNotes }))
      } else if (msg.type === 'meeting-suggestion') {
        updateLive(msg.meetingId as string, l => ({
          ...l,
          suggestions: [...l.suggestions, { id: `${Date.now()}-${l.suggestions.length}`, text: msg.suggestion as string, t: Date.now() }],
        }))
      } else if (msg.type === 'meeting-answer') {
        updateLive(msg.meetingId as string, l => {
          const qa = [...l.qa]
          // Fill the oldest pending question; fall back to appending
          const idx = qa.findIndex(x => x.question === msg.question && x.answer === null)
          if (idx >= 0) qa[idx] = { ...qa[idx], answer: msg.answer as string }
          else qa.push({ question: msg.question as string, answer: msg.answer as string, t: Date.now() })
          return { ...l, qa }
        })
      } else if (msg.type === 'meeting-context') {
        updateLive(msg.meetingId as string, l => ({ ...l, context: msg.items as ContextItem[] }))
      } else if (msg.type === 'meeting-error') {
        if (msg.meetingId) updateLive(msg.meetingId as string, l => ({ ...l, lastError: msg.message as string }))
      }
    }

    ws.addEventListener('message', onMessage)
    return () => ws.removeEventListener('message', onMessage)
  }, [ws, fetchMeetings])

  const startMeeting = useCallback((title: string, orgId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'meeting-start', title, orgId }))
  }, [])

  const stopMeeting = useCallback((meetingId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'meeting-stop', meetingId }))
  }, [])

  const askMeeting = useCallback((meetingId: string, question: string) => {
    setLive(prev => {
      const l = prev[meetingId] ?? EMPTY_LIVE
      return { ...prev, [meetingId]: { ...l, qa: [...l.qa, { question, answer: null, t: Date.now() }] } }
    })
    wsRef.current?.send(JSON.stringify({ type: 'meeting-ask', meetingId, question }))
  }, [])

  const addMeetingContext = useCallback((meetingId: string, kind: ContextKind, value: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'meeting-add-context', meetingId, kind, value }))
  }, [])

  // One-shot request/response over the WS for the pre-meeting mic check
  const micTest = useCallback((): Promise<{ level?: number; error?: string }> => {
    return new Promise((resolve) => {
      const socket = wsRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        resolve({ error: 'Not connected' })
        return
      }
      const timer = setTimeout(() => { socket.removeEventListener('message', handler); resolve({ error: 'Mic test timed out' }) }, 15000)
      function handler(event: MessageEvent) {
        try {
          const msg = JSON.parse(event.data as string)
          if (msg.type === 'meeting-mic-test-result') {
            clearTimeout(timer)
            socket!.removeEventListener('message', handler)
            resolve(msg)
          }
        } catch {}
      }
      socket.addEventListener('message', handler)
      socket.send(JSON.stringify({ type: 'meeting-mic-test' }))
    })
  }, [])

  const activeMeeting = meetings.find(m => m.status === 'recording') ?? null

  return { meetings, live, activeMeeting, startMeeting, stopMeeting, askMeeting, addMeetingContext, micTest, refreshMeetings: fetchMeetings }
}
