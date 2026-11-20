'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import type { Pipeline, PipelineConfig } from '@/lib/pipelines'

// Session automations over the shared WebSocket. onNotify fires for steps that
// need the user (ready to merge, needs you, done).
export function usePipelines(ws: WebSocket | null, onNotify: (title: string, body: string) => void) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [error, setError] = useState<{ liveId: string; message: string } | null>(null)
  const wsRef = useRef(ws)
  wsRef.current = ws
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify

  useEffect(() => {
    if (!ws) return
    function onMessage(event: MessageEvent) {
      let msg: { type: string; [k: string]: unknown }
      try { msg = JSON.parse(event.data as string) } catch { return }
      if (msg.type === 'pipelines') {
        setPipelines(msg.items as Pipeline[])
        const n = msg.notify as { title: string; body: string } | undefined
        if (n) notifyRef.current(n.title, n.body)
      } else if (msg.type === 'pipeline-error') {
        setError({ liveId: msg.liveId as string, message: msg.message as string })
      }
    }
    ws.addEventListener('message', onMessage)
    return () => ws.removeEventListener('message', onMessage)
  }, [ws])

  const startPipeline = useCallback((liveId: string, config: PipelineConfig) => {
    setError(null)
    wsRef.current?.send(JSON.stringify({ type: 'pipeline-start', liveId, config }))
  }, [])
  const stopPipeline = useCallback((id: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'pipeline-stop', id }))
  }, [])

  return { pipelines, pipelineError: error, startPipeline, stopPipeline }
}
