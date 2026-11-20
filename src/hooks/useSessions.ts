'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionSummary } from '@/lib/sessionStore'

const POLL_INTERVAL_MS = 30000

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    return fetch('/api/sessions')
      .then(r => r.json())
      // Everywhere the UI labels a session it reads firstUserMessage, so put
      // Claude's own title there when it has one.
      .then((data: SessionSummary[]) => { setSessions(data.map(h => (h.title ? { ...h, firstUserMessage: h.title } : h))); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    // Keeps history (and anything derived from it, e.g. notification labels
    // and the History tab) from going stale without a manual page reload.
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  async function deleteSession(sessionId: string) {
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
  }

  return { sessions, loading, deleteSession, refresh }
}
