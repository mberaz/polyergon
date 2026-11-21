'use client'
import { useEffect, useState } from 'react'

// Chrome fires beforeinstallprompt once per page load, often before Settings is open,
// so catch it at module load and hand it to whoever asks later.
type InstallEvent = Event & { prompt: () => Promise<void> }
let saved: InstallEvent | null = null
const subs = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); saved = e as InstallEvent; subs.forEach(f => f()) })
  window.addEventListener('appinstalled', () => { saved = null; subs.forEach(f => f()) })
}

// Returns install() when Chrome can install the app, null when it can't or already did.
export function useInstallPrompt(): (() => void) | null {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  return saved ? () => { saved?.prompt(); saved = null; subs.forEach(f => f()) } : null
}

export function isInstalledApp(): boolean {
  return typeof window !== 'undefined' && matchMedia('(display-mode: standalone)').matches
}
