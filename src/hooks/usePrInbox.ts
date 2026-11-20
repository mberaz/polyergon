'use client'
import { useState, useEffect, useCallback } from 'react'
import type { PrInbox } from '@/lib/ghInbox'

const POLL_INTERVAL_MS = 5 * 60 * 1000

export function usePrInbox(reconnectSignal?: unknown) {
  const [inbox, setInbox] = useState<PrInbox | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchInbox = useCallback((force = false) => {
    return fetch(`/api/prs/inbox${force ? '?refresh=1' : ''}`)
      .then(r => r.json())
      .then(setInbox)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchInbox()
    const interval = setInterval(() => fetchInbox(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchInbox])

  useEffect(() => {
    if (reconnectSignal) fetchInbox()
  }, [reconnectSignal, fetchInbox])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try { await fetchInbox(true) } finally { setRefreshing(false) }
  }, [fetchInbox])

  return { inbox, loading, refreshing, refresh }
}
