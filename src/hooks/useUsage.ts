'use client'
import { useState, useEffect, useCallback } from 'react'
import type { UsageReport } from '@/lib/usageStore'

const POLL_INTERVAL_MS = 60_000

export function useUsage() {
  const [usage, setUsage] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchUsage = useCallback(() => {
    return fetch('/api/usage')
      .then(r => r.json())
      .then(setUsage)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchUsage()
    const interval = setInterval(fetchUsage, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchUsage])

  return { usage, loading, refreshUsage: fetchUsage }
}
