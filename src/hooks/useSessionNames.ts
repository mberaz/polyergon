'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

// Session names live on the SERVER (not browser localStorage) so they're the
// same across hostnames (localhost vs polyergon), browsers, and machines.
// On first mount we migrate any names still in the old localStorage key up to
// the server, then always read/write the server copy.
const LEGACY_KEY = 'claude-session-names'

export function useSessionNames(): {
  names: Record<string, string>
  setName: (key: string, name: string) => void
} {
  const [names, setNames] = useState<Record<string, string>>({})
  const namesRef = useRef(names)
  namesRef.current = names

  useEffect(() => {
    let cancelled = false
    async function init() {
      // Migrate legacy localStorage names (one-time; server.merge only fills
      // gaps, so re-running is harmless). This is what carries your existing
      // localhost:3030 names onto the server.
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}')
        if (legacy && typeof legacy === 'object' && Object.keys(legacy).length) {
          await fetch('/api/session-names', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ names: legacy }),
          })
        }
      } catch {}
      try {
        const res = await fetch('/api/session-names')
        const data = await res.json() as { names?: Record<string, string> }
        if (!cancelled && data.names) setNames(data.names)
      } catch {}
    }
    init()
    return () => { cancelled = true }
  }, [])

  const setName = useCallback((key: string, name: string) => {
    // Optimistic local update, then persist to the server.
    setNames(prev => {
      const next = { ...prev }
      if (name.trim()) next[key] = name.trim()
      else delete next[key]
      return next
    })
    fetch('/api/session-names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, name }),
    }).catch(() => {})
  }, [])

  return { names, setName }
}
