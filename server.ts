import { createServer } from 'http'
import { parse } from 'url'
import path from 'path'
import os from 'os'
import { existsSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { getGitRoot } from './src/lib/gitUtils'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import { isAllowedRequest } from './src/lib/requestGuard'
import { v4 as uuid } from 'uuid'
import { liveSessionStore, LiveSessionStore } from './src/lib/liveSessionStore'
import { spawnSession, writeToSession, submitLine, sendWhenReady, resizeSession, killSession, onOutput, onStatusChange, onAnyStatusChange, onAnyPrUrlChange, onAnyRcUrlChange, getSerializedScreen, getLastKnownSize, findSessionIdSince } from './src/lib/ptyManager'
import { orgRegistry, DEFAULT_ORG_ID } from './src/lib/orgRegistry'
import { DEFAULT_BACKEND } from './src/lib/backends'
import { meetingManager } from './src/lib/meetingManager'
import { pipelineEngine } from './src/lib/pipelines'
import { keepAwake } from './src/lib/keepAwake'
import { slackWatchers } from './src/lib/slackWatchers'
import { meetingStore, type ContextKind } from './src/lib/meetingStore'
import { sessionNameStore } from './src/lib/sessionNameStore'
import { firstUserMessageSync } from './src/lib/sessionStore'
import { realpathSync } from 'fs'

const PORT = Number(process.env.PORT) || 3030
const dev = process.env.NODE_ENV !== 'production'
// Compiled builds run from .server-dist/; the Next app lives one level up.
const appDir = existsSync(path.join(__dirname, 'package.json')) ? __dirname : path.join(__dirname, '..')
const app = next({ dev, dir: appDir })
const handle = app.getRequestHandler()

// Label for the Remote Control list on the phone: the user's saved name, else
// the session's first message, else the folder. (Folder was a bare hash.)
function rcNameFor(s: { id: string; cwd: string; claudeSessionId: string | null; orgId: string }, explicit?: string | null): string {
  if (explicit) return explicit
  const names = sessionNameStore.all()
  const saved = names[s.id] ?? (s.claudeSessionId ? names[s.claudeSessionId] : undefined)
  if (saved) return saved
  if (s.claudeSessionId) {
    const root = orgRegistry.get(s.orgId)?.configDir ?? path.join(process.env.HOME!, '.claude')
    let real = s.cwd; try { real = realpathSync(s.cwd) } catch {}
    const file = path.join(root, 'projects', real.replace(/\//g, '-'), `${s.claudeSessionId}.jsonl`)
    const first = firstUserMessageSync(file)
    if (first) return first.slice(0, 60)
  }
  return path.basename(s.cwd)
}

// Session renames waiting for the Claude prompt to be idle (see 'rename-live')
const pendingRenames = new Map<string, string>()
function flushRename(id: string) {
  const name = pendingRenames.get(id)
  if (!name) return
  pendingRenames.delete(id)
  submitLine(id, `/rename ${name}`)
}

app.prepare().then(async () => {
  // A restarted server can't resume audio capture — mark stale recordings
  meetingStore.markInterrupted()

  // Restore live sessions from previous server run.
  // Only the most recent AUTO_RESUME_CAP sessions are actually respawned with
  // --resume; the rest restore as idle (one click resumes them). Respawning
  // everything at once (observed: 87 simultaneous `claude` processes) pins the
  // machine for minutes and starves the dev server itself.
  const AUTO_RESUME_CAP = 15
  LiveSessionStore.backupSaved()
  const saved = LiveSessionStore.loadSaved().filter(s => s.cwd && existsSync(s.cwd))
  const autoResumeIds = new Set(
    [...saved].sort((a, b) => b.createdAt - a.createdAt).slice(0, AUTO_RESUME_CAP).map(s => s.id)
  )
  for (const s of saved) {
    // Pre-existing persisted entries from before orgId was added default to 'default'.
    const orgId = s.orgId ?? DEFAULT_ORG_ID
    const org = orgRegistry.get(orgId)
    const configDir = org?.configDir ?? null
    // Sessions with null claudeSessionId hadn't finished detection before this
    // restart — retroactively scan for the .jsonl Claude created since this
    // session's createdAt before giving up and marking it idle.
    const claudeSessionId = s.claudeSessionId ?? findSessionIdSince(s.cwd, s.createdAt, configDir)
    // Pre-existing persisted entries from before prUrl was added won't have it.
    const prUrl = s.prUrl ?? null
    if (claudeSessionId && autoResumeIds.has(s.id)) {
      liveSessionStore.add({ ...s, claudeSessionId, status: 'thinking', prUrl, orgId })
      // A spawn failure must not abort the restore loop — the store persists
      // on every add(), so bailing here wiped every not-yet-added session.
      try {
        spawnSession(s.id, s.cwd, claudeSessionId, configDir, s.model ?? org?.model, rcNameFor({ ...s, claudeSessionId, orgId }), s.backend, s.rc)
      } catch (e) {
        console.error(`restore: spawn failed for ${s.id}:`, e)
        liveSessionStore.setStatus(s.id, 'idle')
      }
      // Stagger even the capped spawns — a burst still spikes memory/CPU.
      await new Promise(r => setTimeout(r, 150))
    } else {
      liveSessionStore.add({ ...s, claudeSessionId, status: 'idle', prUrl, orgId })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextUpgrade: ((req: unknown, socket: unknown, head: unknown) => void) | undefined = (app as any).getUpgradeHandler?.()

  const server = createServer((req, res) => {
    if (!isAllowedRequest(req.headers)) { res.writeHead(403).end('Forbidden'); return }
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  // Meeting events go to every connected client — a meeting isn't "attached"
  // like a terminal session; any open tab shows its state.
  pipelineEngine.start()
  slackWatchers.start()
  keepAwake.start()
  slackWatchers.on((ev) => {
    const msg = JSON.stringify(ev)
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg) })
  })
  onAnyStatusChange((id, status) => { if (status === 'waiting') flushRename(id) })
  pipelineEngine.on((ev) => {
    const msg = JSON.stringify(ev)
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg) })
  })

  meetingManager.on((ev) => {
    const msg = JSON.stringify(ev)
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg) })
  })

  server.on('upgrade', (request, socket, head) => {
    if (!isAllowedRequest(request.headers)) { socket.destroy(); return }
    const { pathname } = parse(request.url!, true)
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit('connection', client, request)
      })
    } else if (nextUpgrade) {
      nextUpgrade(request, socket, head)
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws: WebSocket) => {
    let currentSessionId: string | null = null
    let cleanupOutput: (() => void) | null = null
    let cleanupStatus: (() => void) | null = null

    function send(msg: object) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    // Lets the client track every session's status (not just the attached
    // one), so background-session completion can be surfaced in the sidebar
    // and trigger alerts/notifications regardless of what's currently open.
    send({ type: 'pipelines', items: pipelineEngine.list() })
    send({ type: 'slack-watchers', items: slackWatchers.list() })
    const cleanupAnyStatus = onAnyStatusChange((id, status) => send({ type: 'sessionStatus', id, status }))
    const cleanupAnyPrUrl = onAnyPrUrlChange((id, prUrl) => send({ type: 'sessionPrUrl', id, prUrl }))
    const cleanupAnyRcUrl = onAnyRcUrlChange((id, rcUrl) => send({ type: 'sessionRcUrl', id, rcUrl }))

    function attachToSession(sessionId: string) {
      cleanupOutput?.()
      cleanupStatus?.()
      currentSessionId = sessionId

      // Bring this session's PTY/headless-buffer size in line with the
      // client's actual viewport before snapshotting its screen state.
      const { cols, rows } = getLastKnownSize()
      resizeSession(sessionId, cols, rows)

      send({ type: 'clear' })
      const snapshot = getSerializedScreen(sessionId)
      if (snapshot) send({ type: 'output', data: snapshot })

      const session = liveSessionStore.get(sessionId)
      if (session) send({ type: 'status', status: session.status })

      cleanupOutput = onOutput(sessionId, (data) => send({ type: 'output', data }))
      cleanupStatus = onStatusChange(sessionId, (status) => send({ type: 'status', status }))
    }

    ws.on('message', (raw) => {
      let msg: { type: string; [k: string]: unknown }
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'list') {
        send({ type: 'sessions', sessions: liveSessionStore.list().map(s => ({ id: s.id, cwd: s.cwd, gitRoot: s.gitRoot, status: s.status, claudeSessionId: s.claudeSessionId, createdAt: s.createdAt, prUrl: s.prUrl, rcUrl: s.rcUrl ?? null, rc: !!s.rc, orgId: s.orgId })) })

      } else if (msg.type === 'create') {
        let cwd = (msg.cwd as string) || process.env.HOME!
        if (cwd === 'general') {
          cwd = path.join(process.env.HOME!, 'General', uuid().slice(0, 8))
          mkdirSync(cwd, { recursive: true })
        }
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          send({ type: 'error', message: `Directory not found: ${cwd}` })
          return
        }
        const orgId = (msg.orgId as string) || DEFAULT_ORG_ID
        const org = orgRegistry.get(orgId)
        const id = uuid()
        const gitRoot = getGitRoot(cwd)
        // Name shown for this session in the Claude mobile app / claude.ai
        // Remote Control list — the dialog's name if given, else the folder.
        const rcName = (msg.name as string) || path.basename(cwd)
        // Backend + model chosen in the dialog; model falls back to the org
        // default (or the app default inside spawnSession if that's null too).
        const backend = (msg.backend as string) || DEFAULT_BACKEND
        const model = (msg.model as string) || org?.model || null
        const rc = !!msg.rc
        liveSessionStore.add({ id, cwd, gitRoot, claudeSessionId: null, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId, backend, model, rc })
        spawnSession(id, cwd, undefined, org?.configDir ?? null, model, rcName, backend, rc)
        send({ type: 'created', id, cwd, gitRoot, orgId })
        attachToSession(id)
        // First prompt (e.g. "cr <url>", "/mcp"): sent only once Claude is at its input prompt
        if (typeof msg.prompt === 'string' && msg.prompt.trim()) sendWhenReady(id, msg.prompt.slice(0, 20000))

      } else if (msg.type === 'resume') {
        let cwd = (msg.cwd as string) || process.env.HOME!
        if (cwd === 'general') {
          cwd = path.join(process.env.HOME!, 'General', uuid().slice(0, 8))
          mkdirSync(cwd, { recursive: true })
        }
        const rawSessionId = msg.claudeSessionId as string
        if (!/^[a-f0-9-]{36}$/i.test(rawSessionId)) return
        // If already live and running, just attach — don't spawn a second PTY
        const existing = liveSessionStore.list().find(s => s.claudeSessionId === rawSessionId)
        if (existing) {
          // Resuming a RUNNING session with a different model = "move it to that
          // model": kill the PTY and fall through to the re-spawn below.
          const wantModel = (msg.model as string) || null
          if (existing.status !== 'idle' && wantModel && wantModel !== existing.model) {
            killSession(existing.id)
            liveSessionStore.setStatus(existing.id, 'idle')
          }
          if (liveSessionStore.get(existing.id)?.status === 'idle') {
            // PTY exited — re-spawn it on the same store entry. Always uses the
            // session's OWN stored org, never whatever orgId the client sent —
            // a resume must never silently move a session to a different org.
            const org = orgRegistry.get(existing.orgId)
            liveSessionStore.setStatus(existing.id, 'thinking')
            // Re-spawn on the session's OWN persisted backend/model, not the
            // client-sent backend. A client-sent model DOES win, so "Resume by ID"
            // with a different model picked moves the session to that model
            // (persisted, so later resumes stay on it).
            const model = (msg.model as string) || existing.model || org?.model || null
            if (model !== existing.model) { existing.model = model; liveSessionStore.add(existing) }
            spawnSession(existing.id, existing.cwd, rawSessionId, org?.configDir ?? null, model, rcNameFor(existing, msg.name as string | undefined), existing.backend, existing.rc)
          }
          send({ type: 'attached', id: existing.id, cwd: existing.cwd })
          attachToSession(existing.id)
          return
        }
        const orgId = (msg.orgId as string) || DEFAULT_ORG_ID
        const org = orgRegistry.get(orgId)
        const id = uuid()
        const gitRoot = getGitRoot(cwd)
        const rcName = (msg.name as string) || path.basename(cwd)
        const backend = (msg.backend as string) || DEFAULT_BACKEND
        const model = (msg.model as string) || org?.model || null
        liveSessionStore.add({ id, cwd, gitRoot, claudeSessionId: rawSessionId, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId, backend, model, rc: !!msg.rc })
        spawnSession(id, cwd, rawSessionId, org?.configDir ?? null, model, rcNameFor({ id, cwd, claudeSessionId: rawSessionId, orgId }, msg.name as string | undefined), backend, !!msg.rc)
        send({ type: 'created', id, cwd, gitRoot, claudeSessionId: rawSessionId, orgId })
        attachToSession(id)

      } else if (msg.type === 'resume-all') {
        // Staggered so resuming dozens of sessions doesn't recreate the
        // restart-storm this replaces; clients get one list update at the end.
        ;(async () => {
          const idle = liveSessionStore.list().filter(s => s.status === 'idle' && s.claudeSessionId)
          for (const s of idle) {
            if (liveSessionStore.get(s.id)?.status !== 'idle') continue // resumed via click meanwhile
            const org = orgRegistry.get(s.orgId)
            liveSessionStore.setStatus(s.id, 'thinking')
            spawnSession(s.id, s.cwd, s.claudeSessionId!, org?.configDir ?? null, s.model ?? org?.model, rcNameFor(s), s.backend, s.rc)
            await new Promise(r => setTimeout(r, 300))
          }
          const updated = liveSessionStore.list().map(s => ({ id: s.id, cwd: s.cwd, gitRoot: s.gitRoot, status: s.status, claudeSessionId: s.claudeSessionId, createdAt: s.createdAt, prUrl: s.prUrl, rcUrl: s.rcUrl ?? null, rc: !!s.rc, orgId: s.orgId }))
          wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'sessions', sessions: updated })) })
        })()

      } else if (msg.type === 'attach') {
        const sessionId = msg.sessionId as string
        if (liveSessionStore.get(sessionId)) attachToSession(sessionId)

      } else if (msg.type === 'restart') {
        // Re-spawn a session's pty in place (same store entry, same model) —
        // e.g. to pick up flags like --remote-control after a config change.
        const target = liveSessionStore.get(msg.sessionId as string)
        if (target?.claudeSessionId) {
          killSession(target.id)
          const org = orgRegistry.get(target.orgId)
          liveSessionStore.setStatus(target.id, 'thinking')
          spawnSession(target.id, target.cwd, target.claudeSessionId, org?.configDir ?? null, target.model ?? org?.model, rcNameFor(target), target.backend, target.rc)
        }

      } else if (msg.type === 'set-rc') {
        // Toggle Remote Control for one session. Persisted; a running session
        // is re-spawned in place so the flag takes effect now.
        const target = liveSessionStore.get(msg.sessionId as string)
        if (target) {
          target.rc = !!msg.on
          liveSessionStore.add(target)
          if (target.status !== 'idle' && target.claudeSessionId) {
            killSession(target.id)
            const org = orgRegistry.get(target.orgId)
            liveSessionStore.setStatus(target.id, 'thinking')
            spawnSession(target.id, target.cwd, target.claudeSessionId, org?.configDir ?? null, target.model ?? org?.model, rcNameFor(target), target.backend, target.rc)
          }
          const updated = liveSessionStore.list().map(s => ({ id: s.id, cwd: s.cwd, gitRoot: s.gitRoot, status: s.status, claudeSessionId: s.claudeSessionId, createdAt: s.createdAt, prUrl: s.prUrl, rcUrl: s.rcUrl ?? null, rc: !!s.rc, orgId: s.orgId }))
          wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'sessions', sessions: updated })) })
        }

      } else if (msg.type === 'stop') {
        // Stop the pty but keep the card (idle, resumable) — unlike 'kill' (archive).
        const target = liveSessionStore.get(msg.sessionId as string)
        if (target) { killSession(target.id); liveSessionStore.setRcUrl(target.id, null) }

      } else if (msg.type === 'compact') {
        // One-click /compact for any session card (not just the attached one).
        const target = msg.sessionId as string
        if (liveSessionStore.get(target)) writeToSession(target, '/compact\r')

      } else if (msg.type === 'kill') {
        const targetId = msg.sessionId as string
        killSession(targetId)
        liveSessionStore.remove(targetId)
        const updated = liveSessionStore.list().map(s => ({ id: s.id, cwd: s.cwd, gitRoot: s.gitRoot, status: s.status, claudeSessionId: s.claudeSessionId, createdAt: s.createdAt, prUrl: s.prUrl, rcUrl: s.rcUrl ?? null, rc: !!s.rc, orgId: s.orgId }))
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'sessions', sessions: updated })) })

      } else if (msg.type === 'paste-image') {
        if (!currentSessionId) return
        const base64 = msg.data as string
        const mimeType = (msg.mimeType as string) || 'image/png'
        const ext = mimeType.split('/')[1].replace('jpeg', 'jpg').split('+')[0]
        const tmpPath = path.join(os.tmpdir(), `claude-paste-${uuid().slice(0, 8)}.${ext}`)
        writeFileSync(tmpPath, Buffer.from(base64, 'base64'))
        writeToSession(currentSessionId, tmpPath)
        send({ type: 'image-pasted', path: tmpPath })

      } else if (msg.type === 'meeting-start') {
        const result = meetingManager.start((msg.title as string) ?? '', (msg.orgId as string) ?? DEFAULT_ORG_ID)
        if ('error' in result) send({ type: 'meeting-error', meetingId: null, message: result.error })
        else send({ type: 'meeting-started', meeting: result })

      } else if (msg.type === 'rename-live') {
        // Rename the running Claude conversation too, so Remote Control and
        // claude.ai show the title. Sent now if the prompt is idle, else on next idle.
        const name = String(msg.name ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80)
        const target = liveSessionStore.get(msg.id as string)
        if (name && target && target.backend !== 'copilot') {
          pendingRenames.set(target.id, name)
          if (target.status === 'waiting') flushRename(target.id)
        }
      } else if (msg.type === 'pipeline-start') {
        const cfg = (msg.config ?? {}) as { slackChannel?: { id?: string; name?: string } | null; maxRounds?: number }
        const ch = cfg.slackChannel?.name ? { id: String(cfg.slackChannel.id ?? '').replace(/[^A-Z0-9]/gi, ''), name: cfg.slackChannel.name.replace(/^#/, '').slice(0, 80) } : null
        const result = pipelineEngine.create(msg.liveId as string, { slackChannel: ch, maxRounds: Number(cfg.maxRounds) || 3 })
        if ('error' in result) send({ type: 'pipeline-error', liveId: msg.liveId, message: result.error })
      } else if (msg.type === 'pipeline-add-pr') {
        const err = pipelineEngine.addPr(msg.id as string, String(msg.url ?? '').trim())
        if (err) send({ type: 'pipeline-error', liveId: msg.liveId, message: err.error })
      } else if (msg.type === 'watcher-create') {
        const c = (msg.channel ?? {}) as { id?: string; name?: string }
        const result = slackWatchers.create({
          channel: { id: String(c.id ?? '').replace(/[^A-Z0-9]/gi, ''), name: String(c.name ?? '').replace(/^#/, '').slice(0, 80) },
          liveId: (msg.liveId as string) || null, mode: msg.mode === 'auto' ? 'auto' : 'approve', intervalMin: Number(msg.intervalMin) || 5,
          orgId: typeof msg.orgId === 'string' && orgRegistry.get(msg.orgId) ? msg.orgId : DEFAULT_ORG_ID,
          knowledge: typeof msg.knowledge === 'string' ? msg.knowledge : '', instructions: typeof msg.instructions === 'string' ? msg.instructions : '',
        })
        if ('error' in result) send({ type: 'watcher-error', message: result.error })
        else slackWatchers.run(result.id)
      } else if (msg.type === 'watcher-stop') {
        slackWatchers.stop(msg.id as string)
      } else if (msg.type === 'watcher-update') {
        const err = slackWatchers.update(msg.id as string, (msg.patch ?? {}) as Parameters<typeof slackWatchers.update>[1])
        if (err) send({ type: 'watcher-error', message: err.error })
      } else if (msg.type === 'watcher-set-session') {
        slackWatchers.setSession(msg.id as string, (msg.liveId as string | null) || null)
      } else if (msg.type === 'watcher-run') {
        slackWatchers.run(msg.id as string)
      } else if (msg.type === 'watcher-send') {
        slackWatchers.send(msg.id as string, msg.permalink as string, String(msg.text ?? '')).then(err => { if (err) send({ type: 'watcher-error', message: err.error }) })
      } else if (msg.type === 'watcher-dismiss') {
        slackWatchers.dismiss(msg.id as string, msg.permalink as string)
      } else if (msg.type === 'watcher-redraft') {
        slackWatchers.redraft(msg.id as string, msg.permalink as string)
      } else if (msg.type === 'pipeline-act') {
        // The one place an automation's message reaches a session: your click
        const err = pipelineEngine.act(msg.id as string, (msg.prUrl as string) || null)
        if (err) send({ type: 'pipeline-error', liveId: msg.liveId, message: err.error })
      } else if (msg.type === 'pipeline-auto') {
        pipelineEngine.setAuto(msg.id as string, (msg.auto ?? {}) as object)
      } else if (msg.type === 'pipeline-dismiss') {
        pipelineEngine.dismiss(msg.id as string, (msg.prUrl as string) || null)
      } else if (msg.type === 'pipeline-stop') {
        pipelineEngine.stop(msg.id as string)
      } else if (msg.type === 'meeting-resume') {
        const result = meetingManager.resume(msg.meetingId as string)
        if ('error' in result) send({ type: 'meeting-error', meetingId: msg.meetingId ?? null, message: result.error })
        else send({ type: 'meeting-started', meeting: result })
      } else if (msg.type === 'meeting-stop') {
        // stop() emits a 'meeting-status' (ended) itself, but if it throws
        // before that (e.g. ffmpeg teardown rejects) the UI would be stuck
        // showing "recording" forever — surface the failure so it isn't silent.
        meetingManager.stop(msg.meetingId as string).catch(err => {
          send({ type: 'meeting-error', meetingId: msg.meetingId as string, message: `Failed to stop meeting: ${err instanceof Error ? err.message : 'unknown'}` })
        })

      } else if (msg.type === 'meeting-ask') {
        meetingManager.ask(msg.meetingId as string, msg.question as string)

      } else if (msg.type === 'meeting-add-context') {
        const kinds = ['text', 'link', 'slack', 'session', 'meeting']
        if (typeof msg.meetingId === 'string' && kinds.includes(msg.kind as string) && typeof msg.value === 'string' && msg.value.trim() && msg.value.length <= 500_000) {
          meetingManager.addContext(msg.meetingId, msg.kind as ContextKind, msg.value)
        }
      } else if (msg.type === 'meeting-mic-test') {
        meetingManager.micTest().then(result => send({ type: 'meeting-mic-test-result', ...result }))

      } else if (msg.type === 'send-to-live') {
        // User clicked "Ask session" on a Slack card: queue the text for when the session is idle
        const text = String(msg.text ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, 20000)
        if (text && liveSessionStore.get(msg.id as string)) sendWhenReady(msg.id as string, text)

      } else if (msg.type === 'input') {
        if (currentSessionId) writeToSession(currentSessionId, msg.data as string)

      } else if (msg.type === 'resize') {
        if (currentSessionId) resizeSession(currentSessionId, msg.cols as number, msg.rows as number)
      }
    })

    ws.on('close', () => {
      cleanupOutput?.()
      cleanupStatus?.()
      cleanupAnyStatus()
      cleanupAnyPrUrl()
      cleanupAnyRcUrl()
    })
  })

  server.listen(PORT, '127.0.0.1', () => {
    if (process.env.POLYERGON_OPEN === '1') {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
      import('child_process').then(cp => cp.spawn(opener, [`http://localhost:${PORT}`], { stdio: 'ignore', detached: true }).on('error', () => {}).unref())
    }
    console.log(`> Polyergon ready on http://localhost:${PORT}`)
  })
})
