'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

export type SessionStatus = 'thinking' | 'waiting' | 'idle'

export interface LiveSessionInfo {
  id: string
  cwd: string
  gitRoot: string | null
  status: SessionStatus
  claudeSessionId: string | null
  createdAt: number
  prUrl: string | null
  rcUrl?: string | null
  rc?: boolean
  orgId: string
  worktree?: { branch: string; repo: string } | null
  backend?: string
  limitResetAt?: number | null // usage limit hit; Polyergon continues it after this
  stalledSince?: number | null // thinking with no progress since
}

export function useTerminal() {
  const wsRef = useRef<WebSocket | null>(null)
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [liveSessions, setLiveSessions] = useState<LiveSessionInfo[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeStatus, setActiveStatus] = useState<SessionStatus>('idle')
  const [sessionError, setSessionError] = useState<string | null>(null)
  // Distinct from activeSessionId — only fires when a NEW pty is actually
  // spawned (fresh create, or first-time resume), not on plain attach to an
  // already-running session. Consumers use this to suppress alerts for a
  // session's own startup dance without affecting genuinely-finished work.
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    let destroyed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0

    function connect() {
      if (destroyed) return
      // Use the page's own host so the WS works whether you open the app at
      // localhost:3030 or polyergon.local:3030 (or any future host/port).
      const socket = new WebSocket(`ws://${window.location.host}/ws`)
      wsRef.current = socket

      socket.onopen = () => {
        attempts = 0
        socket.send(JSON.stringify({ type: 'list' }))
        if (activeSessionIdRef.current) {
          socket.send(JSON.stringify({ type: 'attach', sessionId: activeSessionIdRef.current }))
        }
        setWs(socket)
      }

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'error') setSessionError(msg.message as string)
        if (msg.type === 'sessions') setLiveSessions(msg.sessions)
        if (msg.type === 'status') {
          setActiveStatus(msg.status)
          setLiveSessions(prev => prev.map(s =>
            s.id === activeSessionIdRef.current ? { ...s, status: msg.status } : s
          ))
        }
        if (msg.type === 'sessionStatus') {
          // Fires for every session regardless of which one is attached, so
          // background-session completions are reflected without needing to
          // switch to them first.
          setLiveSessions(prev => prev.map(s =>
            s.id === msg.id ? { ...s, status: msg.status } : s
          ))
        }
        if (msg.type === 'sessionRcUrl') {
          setLiveSessions(prev => prev.map(s =>
            s.id === msg.id ? { ...s, rcUrl: msg.rcUrl } : s
          ))
        }
        if (msg.type === 'sessionPrUrl') {
          setLiveSessions(prev => prev.map(s =>
            s.id === msg.id ? { ...s, prUrl: msg.prUrl } : s
          ))
        }
        if (msg.type === 'created') {
          setActiveSessionId(msg.id)
          activeSessionIdRef.current = msg.id
          setLastCreatedId(msg.id)
          setLiveSessions(prev => [...prev, { id: msg.id, cwd: msg.cwd ?? '', gitRoot: (msg.gitRoot as string) ?? null, status: 'thinking', claudeSessionId: (msg.claudeSessionId as string) ?? null, createdAt: Date.now(), prUrl: (msg.prUrl as string) ?? null, orgId: (msg.orgId as string) ?? 'default' }])
        }
        if (msg.type === 'attached') {
          setActiveSessionId(msg.id)
          activeSessionIdRef.current = msg.id
        }
      }

      socket.onclose = () => {
        // A stale socket (StrictMode's throwaway first mount, or one we've
        // already replaced) must not null out the live one — that left the
        // terminal dead until the next reconnect.
        if (destroyed || wsRef.current !== socket) return
        setWs(null)
        const delay = Math.min(500 * 2 ** attempts, 8000)
        attempts++
        reconnectTimer = setTimeout(connect, delay)
      }

      socket.onerror = () => socket.close()
    }

    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const s = wsRef.current
      if (!s || s.readyState === WebSocket.CLOSING || s.readyState === WebSocket.CLOSED) {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
        attempts = 0
        connect()
      }
    }

    connect()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      destroyed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      const s = wsRef.current
      // Closing a socket that hasn't finished its handshake logs
      // "closed before the connection is established" — let it open, then close.
      if (s?.readyState === WebSocket.CONNECTING) s.onopen = () => s.close()
      else s?.close()
    }
  }, [])

  // name (optional) labels the session in the Claude mobile app / claude.ai
  // Remote Control list via `--remote-control <name>`. backend/model choose the
  // agent CLI and model; omitted → server falls back to claude + org default.
  // prompt: sent by the server once the session reaches its input prompt
  const createSession = useCallback((cwd: string, orgId?: string, name?: string, backend?: string, model?: string, prompt?: string, worktree?: boolean, taskId?: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'create', cwd, orgId, name, backend, model, prompt, worktree: !!worktree, taskId }))
  }, [])
  // Stops the session and deletes its worktree folder (branch kept)
  const removeWorktree = useCallback((sessionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'worktree-remove', sessionId }))
  }, [])

  const resumeSession = useCallback((cwd: string, claudeSessionId: string, orgId?: string, name?: string, backend?: string, model?: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'resume', cwd, claudeSessionId, orgId, name, backend, model }))
  }, [])

  const resumeAllSessions = useCallback(() => {
    // Optimistic: the server staggers the spawns and broadcasts the real list when done
    setLiveSessions(prev => prev.map(s => s.status === 'idle' && s.claudeSessionId ? { ...s, status: 'thinking' } : s))
    wsRef.current?.send(JSON.stringify({ type: 'resume-all' }))
  }, [])

  const attachSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    activeSessionIdRef.current = sessionId
    wsRef.current?.send(JSON.stringify({ type: 'attach', sessionId }))
  }, [])

  // Sends /compact to the session's PTY — shrinks its context (the main cost
  // driver). Only meaningful when the session is at its prompt ('waiting').
  const setRemote = useCallback((sessionId: string, on: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: 'set-rc', sessionId, on }))
  }, [])

  const restartSession = useCallback((sessionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'restart', sessionId }))
  }, [])

  const compactSession = useCallback((sessionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'compact', sessionId }))
  }, [])

  const killLiveSession = useCallback((sessionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'kill', sessionId }))
    setLiveSessions(prev => prev.filter(s => s.id !== sessionId))
    if (activeSessionIdRef.current === sessionId) {
      setActiveSessionId(null)
      activeSessionIdRef.current = null
    }
  }, [])

  // Your click only: text goes into that session when it's idle
  const sendToLive = useCallback((id: string, text: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'send-to-live', id, text }))
  }, [])

  return { removeWorktree, sendToLive, ws, liveSessions, activeSessionId, activeStatus, lastCreatedId, sessionError, setSessionError, createSession, resumeSession, resumeAllSessions, attachSession, killLiveSession, compactSession, restartSession, setRemote }
}
