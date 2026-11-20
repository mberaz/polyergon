'use client'
import { useCallback, useEffect, useState } from 'react'

// The user's on/off switch (Settings ⚙), mirrored in a module variable so
// non-hook callers (note reminders) can check it too. Defaults to on until
// /api/settings answers.
let enabledFlag = true
export const SETTINGS_CHANGED_EVENT = 'polyergon:settings-changed'
export function notificationsEnabled() { return enabledFlag }
export function setNotificationsEnabled(on: boolean) {
  enabledFlag = on
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
}

export function useDesktopNotifications() {
  // Resolved after mount — reading Notification.permission during the first
  // render makes server and client HTML disagree (hydration error), since the
  // server has no Notification API.
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
    const sync = () => setEnabled(enabledFlag)
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync)
    fetch('/api/settings').then(r => r.json()).then(s => setNotificationsEnabled(s?.notifications?.enabled !== false)).catch(() => {})
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync)
  }, [])

  // Must be called from a real click handler — browsers silently ignore (or
  // auto-deny) requestPermission() calls that aren't triggered by a user gesture.
  const requestPermission = useCallback(() => {
    if (typeof Notification === 'undefined') return Promise.resolve()
    return Notification.requestPermission().then(setPermission)
  }, [])

  const notifyNeedsInput = useCallback((title: string, body: string, onClick?: () => void) => {
    if (!enabledFlag || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const n = new Notification(title, { body, icon: '/favicon.ico' })
    if (onClick) n.onclick = () => { window.focus(); onClick(); n.close() }
  }, [])

  return { permission, enabled, requestPermission, notifyNeedsInput }
}
