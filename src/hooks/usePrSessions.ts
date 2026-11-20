'use client'
import { useState, useEffect, useCallback } from 'react'
import type { PrSessionEntry } from '@/lib/prTypes'

const POLL_INTERVAL_MS = 30000

// reconnectSignal: pass something that changes value whenever the app's
// WebSocket (re)connects (e.g. the `ws` object from useTerminal) — that's
// exactly when a server restart would have just happened, so it triggers an
// immediate refetch instead of waiting for the next poll tick.
export function usePrSessions(reconnectSignal?: unknown) {
  const [entries, setEntries] = useState<PrSessionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchEntries = useCallback(() => {
    return fetch('/api/prs')
      .then(r => r.json())
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchEntries()
    // Session ids (liveId) get regenerated on every server restart, so a
    // stale entry can point at a session that no longer exists — polling
    // keeps the live/history mapping itself fresh, independent of the
    // manual-only `gh` status refresh.
    const interval = setInterval(fetchEntries, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchEntries])

  useEffect(() => {
    if (reconnectSignal) fetchEntries()
  }, [reconnectSignal, fetchEntries])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const r = await fetch('/api/prs/refresh', { method: 'POST' })
      setEntries(await r.json())
    } catch {
      /* keep showing whatever we already had */
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { entries, loading, refreshing, refresh }
}
