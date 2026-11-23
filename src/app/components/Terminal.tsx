'use client'
import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

// The one terminal on the page, so Chat view can read the screen and type keys.
let current: { term: XTerm; ws: () => WebSocket | null } | null = null

export function screenBottom(rows = 40): string {
  const t = current?.term
  if (!t) return ''
  const buf = t.buffer.active
  const out: string[] = []
  for (let y = Math.max(0, buf.viewportY + t.rows - rows); y < buf.viewportY + t.rows; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '')
  return out.join('\n')
}

export function typeKeys(data: string) {
  current?.ws()?.send(JSON.stringify({ type: 'input', data }))
}

interface Props {
  visible: boolean
  ws: WebSocket | null
}

export function Terminal({ visible, ws }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const initializedRef = useRef(false)
  const [imageStatus, setImageStatus] = useState<'idle' | 'uploading' | 'done'>('idle')

  useEffect(() => { wsRef.current = ws }, [ws])

  // Initialize xterm once, the first time the terminal becomes visible (the
  // container has real dimensions then). It is created ONCE and only disposed
  // when this component unmounts — NOT on every `visible` toggle. Previously the
  // effect depended on [visible], so switching to another tab (e.g. a meeting)
  // ran the cleanup and disposed the terminal, while initializedRef stayed true
  // — so returning to Live skipped re-init and left a dead, blank terminal.
  useEffect(() => {
    if (!visible || initializedRef.current || !containerRef.current) return
    initializedRef.current = true

    const term = new XTerm({
      theme: { background: '#111827', foreground: '#f3f4f6', cursor: '#60a5fa' },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fit.fit()
    fitRef.current = fit
    xtermRef.current = term
    current = { term, ws: () => wsRef.current }

    // Tell PTY the real terminal dimensions immediately
    const socket = wsRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    term.onData((data) => {
      wsRef.current?.send(JSON.stringify({ type: 'input', data }))
    })

    // Shift+Enter inserts a newline instead of submitting. xterm sends a plain
    // \r for it, the same as Enter, so send ESC+CR (Meta+Enter) instead, which
    // Claude Code reads as "new line" (what its /terminal-setup configures).
    term.attachCustomKeyEventHandler((e) => {
      if (e.key !== 'Enter' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return true
      if (e.type === 'keydown') wsRef.current?.send(JSON.stringify({ type: 'input', data: '\x1b\r' }))
      e.preventDefault()
      return false
    })

    const observer = new ResizeObserver(() => {
      fit.fit()
      const s = wsRef.current
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    observer.observe(containerRef.current)
    observerRef.current = observer
  }, [visible])

  // Tear down the terminal only when the component itself unmounts.
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
      xtermRef.current?.dispose()
      xtermRef.current = null
      current = null
      initializedRef.current = false
    }
  }, [])

  // Re-fit when tab becomes visible again (browser may have skipped layout while hidden)
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible' && fitRef.current) {
        setTimeout(() => fitRef.current?.fit(), 50)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Drop files onto the terminal: the server saves a copy and types its path
  // (a browser can't see the dropped file's real path)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const el = containerRef.current?.parentElement
    if (!el) return
    const MAX = 25 * 1024 * 1024
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDragging(true) } }
    const leave = (e: DragEvent) => { if (!el.contains(e.relatedTarget as Node)) setDragging(false) }
    const drop = async (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      setDragging(false)
      if (!files.length) return
      e.preventDefault()
      const ok = files.filter(f => f.size <= MAX)
      if (ok.length < files.length) alert(`Skipped files over 25 MB: ${files.filter(f => f.size > MAX).map(f => f.name).join(', ')}`)
      if (!ok.length) return
      setImageStatus('uploading')
      const read = (f: File) => new Promise<{ name: string; data: string }>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res({ name: f.name, data: String(r.result).split(',')[1] ?? '' })
        r.onerror = () => rej(r.error)
        r.readAsDataURL(f)
      })
      try { wsRef.current?.send(JSON.stringify({ type: 'drop-files', files: await Promise.all(ok.map(read)) })) } catch { setImageStatus('idle') }
      xtermRef.current?.focus()
    }
    el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', drop)
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop) }
  }, [visible])

  // Intercept image paste from clipboard
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (!blob) return
          setImageStatus('uploading')
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = reader.result as string
            const base64 = dataUrl.split(',')[1]
            wsRef.current?.send(JSON.stringify({ type: 'paste-image', data: base64, mimeType: item.type }))
          }
          reader.readAsDataURL(blob)
          return
        }
      }
    }
    el.addEventListener('paste', onPaste)
    return () => el.removeEventListener('paste', onPaste)
  }, [visible])

  // Stream server output into terminal
  useEffect(() => {
    if (!ws) return
    const handler = (event: MessageEvent) => {
      let msg: { type: string; data?: string }
      try { msg = JSON.parse(event.data) } catch { return }
      // Ignore meeting/PR/status frames that share this socket
      if (msg.type === 'output') xtermRef.current?.write(msg.data ?? '')
      if (msg.type === 'clear') {
        // 'clear' fires on every attach (new session or switching sessions),
        // regardless of entry point (Live tab, PRs tab, History resume) —
        // the one place to reliably grab keyboard focus for the new session.
        // BUT: attaching also happens as a side effect of a plain single
        // click (e.g. the session title's onClick, which also fires as part
        // of a double-click-to-rename gesture) — stealing focus here can
        // yank it away from a rename input (or any other field) the user
        // just opened, closing it via its own onBlur before they can type.
        xtermRef.current?.reset()
        const active = document.activeElement
        const somethingElseFocused = active && active !== document.body && !containerRef.current?.contains(active)
        if (!somethingElseFocused) xtermRef.current?.focus()
      }
      if (msg.type === 'image-pasted' || msg.type === 'files-dropped') {
        setImageStatus('done')
        setTimeout(() => setImageStatus('idle'), 2000)
      }
    }
    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [ws])

  return (
    <div className="absolute inset-0" style={{ visibility: visible ? 'visible' : 'hidden' }}>
      <div ref={containerRef} className="absolute inset-0" />
      {dragging && (
        <div className="absolute inset-2 z-20 rounded-xl border-2 border-dashed border-blue-400 bg-blue-950/40 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-blue-100 bg-gray-900/90 px-4 py-2 rounded-lg">Drop to add the file to the session</p>
        </div>
      )}
      {imageStatus !== 'idle' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/95 border border-gray-700 text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-10 pointer-events-none">
          {imageStatus === 'uploading' ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-300">Saving…</span>
            </>
          ) : (
            <>
              <span className="text-green-400">✓</span>
              <span className="text-gray-300">Path inserted</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
