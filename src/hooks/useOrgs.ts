'use client'
import { useState, useEffect, useCallback } from 'react'
import type { Org } from '@/lib/orgRegistry'

export function useOrgs() {
  const [orgs, setOrgs] = useState<Org[]>([])

  const fetchOrgs = useCallback(() => {
    return fetch('/api/orgs').then(r => r.json()).then(setOrgs).catch(() => {})
  }, [])

  useEffect(() => { fetchOrgs() }, [fetchOrgs])

  const addOrg = useCallback(async (name: string, configDir: string, model?: string) => {
    const r = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, configDir, model }),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Failed to add org')
    const org: Org = await r.json()
    setOrgs(prev => [...prev, org])
    return org
  }, [])

  return { orgs, addOrg }
}
