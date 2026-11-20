'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import type { SlackWatcher } from '@/lib/slackWatchers'

export function useSlackWatchers(ws: WebSocket | null, onNotify: (title: string, body: string) => void) {
  const [watchers, setWatchers] = useState<SlackWatcher[]>([])
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef(ws); wsRef.current = ws
  const notifyRef = useRef(onNotify); notifyRef.current = onNotify

  useEffect(() => {
    if (!ws) return
    function onMessage(event: MessageEvent) {
      let msg: { type: string; [k: string]: unknown }
      try { msg = JSON.parse(event.data as string) } catch { return }
      if (msg.type === 'slack-watchers') {
        setWatchers(msg.items as SlackWatcher[])
        const n = msg.notify as { title: string; body: string } | undefined
        if (n) notifyRef.current(n.title, n.body)
      } else if (msg.type === 'watcher-error') setError(msg.message as string)
    }
    ws.addEventListener('message', onMessage)
    return () => ws.removeEventListener('message', onMessage)
  }, [ws])

  const cmd = useCallback((type: string, body: object = {}) => { setError(null); wsRef.current?.send(JSON.stringify({ type, ...body })) }, [])
  return { watchers, watcherError: error, watcherCmd: cmd }
}
