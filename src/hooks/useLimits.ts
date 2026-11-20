'use client'
import { useState, useEffect, useCallback } from 'react'
import type { LimitsReport } from '@/lib/planLimits'

const POLL_INTERVAL_MS = 60_000

export function useLimits() {
  const [limits, setLimits] = useState<LimitsReport | null>(null)

  const fetchLimits = useCallback(() => {
    return fetch('/api/limits').then(r => r.json()).then(setLimits).catch(() => {})
  }, [])

  useEffect(() => {
    fetchLimits()
    const interval = setInterval(fetchLimits, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchLimits])

  return { limits }
}
