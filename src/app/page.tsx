'use client'
import { withOrg } from '@/lib/activeOrg'
import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Sidebar } from './components/Sidebar'

// xterm.js uses `window`/`self` — must not run on the server
const Terminal = dynamic(() => import('./components/Terminal').then(m => ({ default: m.Terminal })), { ssr: false })
import { NewSessionDialog } from './components/NewSessionDialog'
import { RecordMeetingDialog } from './components/RecordMeetingDialog'
import { MeetingView } from './components/MeetingView'
import { MeetingsLibrary } from './components/MeetingsLibrary'
import { AutomateDialog } from './components/AutomateDialog'
import { SkillsPage } from './components/SkillsPage'
import { NotesPage } from './components/NotesPage'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import { SlackInbox } from './components/SlackInbox'
import { AutomationsPage } from './components/AutomationsPage'
import { WatcherDialog } from './components/WatcherDialog'
import { useSlackWatchers } from '@/hooks/useSlackWatchers'
import { setActiveOrg } from '@/lib/activeOrg'
import type { SlackMention } from '@/lib/slackBridge'
import { useNotes } from '@/hooks/useNotes'
import { usePipelines } from '@/hooks/usePipelines'
import { PrDashboard } from './components/PrDashboard'
import { UsageDashboard } from './components/UsageDashboard'
import { useSessions } from '@/hooks/useSessions'
import { useDesktopNotifications } from '@/hooks/useDesktopNotifications'
import { useTerminal } from '@/hooks/useTerminal'
import { usePrSessions } from '@/hooks/usePrSessions'
import { usePrInbox } from '@/hooks/usePrInbox'
import { useOrgs } from '@/hooks/useOrgs'
import { useMeetings } from '@/hooks/useMeetings'
import { useUsage } from '@/hooks/useUsage'
import { useLimits } from '@/hooks/useLimits'

const MIN_SIDEBAR = 160
const MAX_SIDEBAR = 600
const DEFAULT_SIDEBAR = 288 // w-72

type View = { mode: 'empty' } | { mode: 'live' } | { mode: 'meeting'; meetingId: string } | { mode: 'prdash' } | { mode: 'usagedash' } | { mode: 'meetinglib' } | { mode: 'skills'; name: string | null } | { mode: 'notes'; id: string | null } | { mode: 'slack' } | { mode: 'automations' }

export default function Home() {
  const { sessions, loading, deleteSession, refresh: refreshSessions } = useSessions()
  const { permission: notificationPermission, enabled: notificationsOn, requestPermission: requestNotificationPermission, notifyNeedsInput } = useDesktopNotifications()
  const { ws, liveSessions, activeSessionId, lastCreatedId, sessionError, setSessionError, attachSession, createSession, resumeSession, resumeAllSessions, killLiveSession, compactSession, setRemote } = useTerminal()
  const { watchers, watcherError, watcherCmd } = useSlackWatchers(ws, (title, body) => notifyNeedsInput(`👂 ${title}`, body))
  const [showWatcherDialog, setShowWatcherDialog] = useState(false)
  const { pipelines, pipelineError, startPipeline, stopPipeline, addPipelinePr, actPipeline, dismissPipeline } = usePipelines(ws, (title, body) => notifyNeedsInput(`⚡ ${title}`, body))
  // prEntries still feeds the notification-suppression logic; the PRs tab
  // itself now renders the GitHub workload inbox
  const { entries: prEntries } = usePrSessions(ws)
  const { inbox, loading: inboxLoading, refreshing: inboxRefreshing, refresh: refreshInbox } = usePrInbox(ws)
  const { orgs, addOrg, refreshOrgs } = useOrgs()
  const { notes, setNotes } = useNotes()
  const [skillsVersion, setSkillsVersion] = useState(0)
  const { meetings, live: meetingLive, activeMeeting, startMeeting, resumeMeeting, stopMeeting, askMeeting, addMeetingContext, micTest, refreshMeetings } = useMeetings(ws)
  const { usage } = useUsage()
  const { limits } = useLimits()
  const [view, setView] = useState<View>({ mode: 'empty' })
  const [showDialog, setShowDialog] = useState(false)
  const [showRecordDialog, setShowRecordDialog] = useState(false)
  // Set when this tab clicked "Start recording" — switches the view to the
  // meeting once the server confirms it (guards against jumping into meetings
  // started elsewhere / already running on page load)
  const awaitingMeetingStartRef = useRef(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR)
  // Loaded after mount — localStorage in the initializer causes a hydration mismatch
  const [customPaths, setCustomPaths] = useState<string[]>([])
  useEffect(() => {
    try { setCustomPaths(JSON.parse(localStorage.getItem('customPaths') ?? '[]')) } catch {}
  }, [])
  // Active org filter: 'all' or an org id. Scopes the sidebar (live sessions,
  // history, PRs, notes) and pre-selects the org in the New Session dialog.
  // Saved value loads after mount — reading localStorage in the initializer
  // makes the server and client first-render disagree (hydration error).
  const [activeOrgId, setActiveOrgId] = useState<string>('all')
  // Slack/skills calls follow the org switcher (set during render so children's first fetch sees it)
  setActiveOrg(activeOrgId)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('claude-active-org')
      if (saved) setActiveOrgId(saved)
    } catch {}
  }, [])
  function switchOrg(id: string) {
    setActiveOrgId(id)
    try { localStorage.setItem('claude-active-org', id) } catch {}
  }
  const draggingRef = useRef(false)
  const pendingPromptRef = useRef<string | null>(null)
  const pendingNameRef = useRef<string>('')
  // Only carries names set at creation time this session (via pendingNameRef);
  // the Sidebar loads persisted names from localStorage itself. Do NOT seed
  // this from localStorage — feeding the whole saved map back through here
  // races the Sidebar's own load and clobbers live renames.
  const [automateFor, setAutomateFor] = useState<string | null>(null)
  const [hideNotifyBanner, setHideNotifyBanner] = useState(false)
  const [sessionNameOverrides, setSessionNameOverrides] = useState<Record<string, string>>({})
  // Per-session alert bookkeeping (not just the currently-viewed session) —
  // previous status, when a session was created via this client (so its own
  // startup thinking→waiting dance doesn't alert), and the debounce timer,
  // all keyed by session id.
  const prevStatusesRef = useRef<Record<string, string>>({})
  const recentlyCreatedRef = useRef<Record<string, number>>({})
  const dohTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const wsRef = useRef<WebSocket | null>(null)
  useEffect(() => { wsRef.current = ws }, [ws])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    const startX = e.clientX
    const startWidth = sidebarWidth

    function onMove(ev: MouseEvent) {
      if (!draggingRef.current) return
      const next = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + ev.clientX - startX))
      setSidebarWidth(next)
    }
    function onUp() {
      draggingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  // lastCreatedId only fires for a genuinely new pty spawn (create / first
  // resume), not plain attach — that's what marks the boot-suppression window.
  useEffect(() => {
    if (!lastCreatedId) return
    recentlyCreatedRef.current[lastCreatedId] = Date.now()
    // Refresh history shortly after, once Claude's transcript file exists,
    // so this new session gets a real name instead of falling back to its
    // (often meaningless) auto-generated folder hash.
    const t = setTimeout(refreshSessions, 4000)
    return () => clearTimeout(t)
  }, [lastCreatedId, refreshSessions])

  // Tracks every live session's status transitions (not just the one
  // currently open), so a background session finishing while you're looking
  // at something else still plays a sound / shows a notification.
  const BOOT_SUPPRESS_MS = 8000
  // Only trust a fetched PR status to suppress a notification if it's recent
  // — there's no background polling loop, so a status from a while ago could
  // be stale (e.g. a reviewer requested changes since). Stale/unknown status
  // always fails open and notifies as usual.
  const PR_STATUS_STALE_MS = 30 * 60 * 1000

  useEffect(() => {
    for (const s of liveSessions) {
      const prev = prevStatusesRef.current[s.id]

      if (prev === 'thinking' && s.status === 'waiting') {
        const createdAt = recentlyCreatedRef.current[s.id]
        const justBooted = createdAt !== undefined && Date.now() - createdAt < BOOT_SUPPRESS_MS

        const prStatus = prEntries.find(e => e.source === 'live' && e.liveId === s.id)?.status
        const prStatusFresh = prStatus && Date.now() - prStatus.fetchedAt < PR_STATUS_STALE_MS
        const prBlockedNotActionable = prStatusFresh
          && prStatus.state === 'OPEN'
          && prStatus.reviewDecision !== 'CHANGES_REQUESTED'
          && prStatus.checks !== 'failing'

        if (!justBooted && !prBlockedNotActionable) {
          // Debounce: only alert if status stays 'waiting' for a few seconds —
          // a multi-step task can briefly dip back to 'waiting' between tool
          // calls, and re-entering 'thinking' below cancels this pending timer
          // so that blip never fires its own notification.
          const existing = dohTimersRef.current[s.id]
          if (existing) clearTimeout(existing)
          const sessionId = s.id
          const historyMatch = s.claudeSessionId ? sessions.find(h => h.sessionId === s.claudeSessionId) : undefined
          const rawName = sessionNameOverrides[sessionId] || historyMatch?.firstUserMessage || s.cwd?.split('/').at(-1) || 'Session'
          const name = rawName.length > 80 ? rawName.slice(0, 80) + '…' : rawName
          const folder = s.cwd?.split('/').at(-1)
          const label = folder && !name.startsWith(folder) ? `${name} (${folder})` : name
          dohTimersRef.current[sessionId] = setTimeout(() => {
            delete dohTimersRef.current[sessionId]
            notifyNeedsInput('Claude needs your input', label, () => handleAttachLive(sessionId))
          }, 4000)
        }
      } else if (prev === 'waiting' && s.status === 'thinking') {
        // Cancel a pending notification from a false 'waiting' blip — Claude
        // is still working, this isn't the real completion.
        const existing = dohTimersRef.current[s.id]
        if (existing) { clearTimeout(existing); delete dohTimersRef.current[s.id] }
      }

      prevStatusesRef.current[s.id] = s.status
    }
  }, [liveSessions, notifyNeedsInput, sessionNameOverrides, prEntries])

  // When live session is created, switch to terminal, save pending name, send pending prompt
  useEffect(() => {
    if (!activeSessionId) return
    setView({ mode: 'live' })

    // Persist the name entered in the dialog
    if (pendingNameRef.current) {
      const name = pendingNameRef.current
      pendingNameRef.current = ''
      try {
        const existing = JSON.parse(localStorage.getItem('claude-session-names') ?? '{}')
        existing[activeSessionId] = name
        localStorage.setItem('claude-session-names', JSON.stringify(existing))
      } catch {}
      setSessionNameOverrides(prev => ({ ...prev, [activeSessionId]: name }))
    }

    if (!pendingPromptRef.current) return
    const prompt = pendingPromptRef.current
    pendingPromptRef.current = null
    // Wait for Claude to finish startup before sending input.
    // PTY uses \r (carriage return) for Enter, not \n.
    const t = setTimeout(() => {
      wsRef.current?.send(JSON.stringify({ type: 'input', data: prompt + '\r' }))
    }, 1500)
    return () => clearTimeout(t)
  }, [activeSessionId])

  function handleNewSession(cwd: string, name: string, orgId: string, backend: string, model: string) {
    setShowDialog(false)
    pendingNameRef.current = name
    // Persist custom path so it appears in the dialog next time
    if (!sessions.some(s => s.cwd === cwd)) {
      const updated = Array.from(new Set([cwd, ...customPaths])).slice(0, 20)
      setCustomPaths(updated)
      try { localStorage.setItem('customPaths', JSON.stringify(updated)) } catch {}
    }
    createSession(cwd, orgId, name, backend, model)
  }

  function handleHistoryClick(sessionId: string, cwd: string | null, orgId?: string) {
    if (cwd) {
      resumeSession(cwd, sessionId, orgId)
    } else {
      createSession('')
    }
    // view switches to 'live' when activeSessionId updates via useEffect
  }

  function handleAttachLive(id: string) {
    attachSession(id)
    setView({ mode: 'live' })
  }

  function handleResumeLive(id: string) {
    const session = liveSessions.find(s => s.id === id)
    if (session?.claudeSessionId) resumeSession(session.cwd, session.claudeSessionId)
  }

  function handleResumeById(sessionId: string, name: string, orgId: string, backend: string, model: string) {
    setShowDialog(false)
    pendingNameRef.current = name
    // Spawn in a fresh General folder (same as clicking "General") so the
    // resumed session opens as its own window instead of squatting in $HOME.
    resumeSession('general', sessionId, orgId, name, backend, model)
  }

  function handleDeleteLive(id: string, claudeSessionId: string | null) {
    killLiveSession(id)
    if (claudeSessionId) deleteSession(claudeSessionId)
  }

  function handleStartMeeting(title: string, orgId: string) {
    setShowRecordDialog(false)
    awaitingMeetingStartRef.current = true
    startMeeting(title, orgId)
  }

  // "Review" on a dashboard PR: spawn a fresh session that runs the /cr
  // review skill on the PR (gh works from any cwd, so General is fine)
  // Slack inbox → a new session that works the request and drafts a reply
  function handleSlackAgent(m: SlackMention) {
    pendingPromptRef.current =
      `Someone needs me on Slack. ${m.isDm ? `Direct message from ${m.author}` : `${m.author} in #${m.channel}`}: ${m.permalink} . ` +
      'Read the message and its whole thread with the Slack connector, figure out what they need, and look into it (code, docs, data) as far as you can. ' +
      'Then show me a draft reply. Do not post anything to Slack until I approve it.'
    const name = `Slack: ${m.author}${m.isDm ? '' : ` #${m.channel}`}`.slice(0, 60)
    pendingNameRef.current = name
    createSession('general', activeOrgId === 'all' ? undefined : activeOrgId, name)
  }

  function handleReviewWithClaude(url: string) {
    pendingPromptRef.current = `cr ${url}`
    const crName = `CR ${url.match(/([\w.-]+)\/pull\/(\d+)/)?.[0] ?? ''}`.trim()
    pendingNameRef.current = crName
    createSession('general', activeOrgId === 'all' ? undefined : activeOrgId, crName)
  }

  // Jump into the meeting view once the server confirms the start we requested
  useEffect(() => {
    if (awaitingMeetingStartRef.current && activeMeeting) {
      awaitingMeetingStartRef.current = false
      setView({ mode: 'meeting', meetingId: activeMeeting.id })
    }
  }, [activeMeeting])

  // ⌘K palette: everything searchable, built when the palette opens
  const paletteSkills = useRef<{ name: string; description: string }[] | null>(null)
  useEffect(() => { fetch(withOrg('/api/skills')).then(r => r.json()).then(d => { paletteSkills.current = d.skills ?? [] }).catch(() => {}) }, [skillsVersion, activeOrgId])
  const paletteItems = useCallback((): PaletteItem[] => {
    const nameOf = (id: string, claudeId: string | null, cwd: string) =>
      sessionNameOverrides[id] || (claudeId && sessionNameOverrides[claudeId]) || sessions.find(h => h.sessionId === claudeId)?.firstUserMessage || cwd.split('/').at(-1) || 'Session'
    const liveIds = new Set(liveSessions.map(s => s.claudeSessionId))
    const day = (t: number | string) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return [
      { id: 'new-session', group: 'Actions', label: 'New session', run: () => setShowDialog(true) },
      { id: 'record', group: 'Actions', label: 'Record a meeting', run: () => setShowRecordDialog(true) },
      { id: 'recordings', group: 'Actions', label: 'Open recordings', run: () => setView({ mode: 'meetinglib' }) },
      { id: 'notes', group: 'Actions', label: 'Open notes', run: () => setView({ mode: 'notes', id: null }) },
      { id: 'skills', group: 'Actions', label: 'Open skills', run: () => setView({ mode: 'skills', name: null }) },
      { id: 'usage', group: 'Actions', label: 'Open usage', run: () => setView({ mode: 'usagedash' }) },
      { id: 'prs', group: 'Actions', label: 'Open PR dashboard', run: () => setView({ mode: 'prdash' }) },
      { id: 'slack', group: 'Actions', label: 'Open Slack inbox', run: () => setView({ mode: 'slack' }) },
      { id: 'automations', group: 'Actions', label: 'Open automations', run: () => setView({ mode: 'automations' }) },
      ...liveSessions.map(s => ({ id: s.id, group: 'Live sessions', label: nameOf(s.id, s.claudeSessionId, s.cwd).slice(0, 90), hint: s.status, run: () => handleAttachLive(s.id) })),
      ...sessions.filter(h => !h.headless && !liveIds.has(h.sessionId)).map(h => ({
        id: h.sessionId, group: 'History', label: (sessionNameOverrides[h.sessionId] || h.firstUserMessage || h.cwd?.split('/').at(-1) || 'Session').slice(0, 90),
        hint: h.lastTimestamp ? day(h.lastTimestamp) : undefined, run: () => handleHistoryClick(h.sessionId, h.cwd, h.orgId),
      })),
      ...meetings.map(m => ({ id: m.id, group: 'Meetings', label: m.title, hint: day(m.startedAt), run: () => setView({ mode: 'meeting', meetingId: m.id }) })),
      ...notes.map(n => ({ id: n.id, group: 'Notes', label: n.text.split('\n').find(l => l.trim())?.trim().slice(0, 90) || 'Untitled', hint: day(n.createdAt), run: () => setView({ mode: 'notes', id: n.id }) })),
      ...(paletteSkills.current ?? []).map(sk => ({ id: sk.name, group: 'Skills', label: sk.name, hint: sk.description.slice(0, 60), run: () => setView({ mode: 'skills', name: sk.name }) })),
    ]
  }, [liveSessions, sessions, meetings, notes, sessionNameOverrides]) // eslint-disable-line react-hooks/exhaustive-deps

  const viewedMeeting = view.mode === 'meeting' ? meetings.find(m => m.id === view.meetingId) ?? null : null

  return (
    <div className="flex h-screen bg-[#0d1117] text-white overflow-hidden">
      <div style={{ width: sidebarWidth, flexShrink: 0 }} className="h-screen overflow-hidden">
        <Sidebar
          liveSessions={liveSessions}
          orgs={orgs}
          activeOrgId={activeOrgId}
          onSwitchOrg={switchOrg}
          historySessions={sessions}
          historyLoading={loading}
          activeSessionId={activeSessionId}
          selectedHistoryId={null}
          sessionNameOverrides={sessionNameOverrides}
          onAttachLive={handleAttachLive}
          onKillLive={killLiveSession}
          onDeleteLive={handleDeleteLive}
          onResumeLive={handleResumeLive}
          onResumeAll={resumeAllSessions}
          onCompact={compactSession}
          onSetRemote={setRemote}
          onNewSession={() => setShowDialog(true)}
          onSelectHistory={handleHistoryClick}
          onDeleteSession={deleteSession}
          inbox={inbox}
          inboxLoading={inboxLoading}
          inboxRefreshing={inboxRefreshing}
          onRefreshInbox={refreshInbox}
          onOpenPrDashboard={() => setView({ mode: 'prdash' })}
          meetings={meetings}
          selectedMeetingId={view.mode === 'meeting' ? view.meetingId : null}
          onSelectMeeting={(id) => setView({ mode: 'meeting', meetingId: id })}
          onRecordMeeting={() => setShowRecordDialog(true)}
          onOpenMeetingLibrary={() => setView({ mode: 'meetinglib' })}
          pipelines={pipelines}
          onOrgsChanged={refreshOrgs}
          onRenameLive={(id, name) => ws?.send(JSON.stringify({ type: 'rename-live', id, name }))}
          notes={notes}
          setNotes={setNotes}
          onOpenNotes={id => setView({ mode: 'notes', id })}
          onOpenSkills={name => setView({ mode: 'skills', name })}
          onOpenSlack={() => setView({ mode: 'slack' })}
          onOpenAutomations={() => setView({ mode: 'automations' })}
          selectedNoteId={view.mode === 'notes' ? view.id : null}
          selectedSkill={view.mode === 'skills' ? view.name : null}
          skillsVersion={skillsVersion}
          onAutomate={setAutomateFor}
          usage={usage}
          onOpenUsage={() => setView({ mode: 'usagedash' })}
        />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="w-1 flex-shrink-0 bg-gray-800 hover:bg-blue-500 cursor-col-resize transition-colors"
      />

      <div className="flex-1 relative overflow-hidden">
        {/* Recording indicator — visible whenever a meeting records in the background */}
        {activeMeeting && !(view.mode === 'meeting' && view.meetingId === activeMeeting.id) && (
          <button
            onClick={() => setView({ mode: 'meeting', meetingId: activeMeeting.id })}
            className="absolute top-0 left-0 right-0 z-20 bg-red-900/90 hover:bg-red-800 text-red-100 text-xs py-1 flex items-center justify-center gap-2 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            Recording — {activeMeeting.title}
          </button>
        )}

        <Terminal visible={view.mode === 'live'} ws={ws} />

        {view.mode === 'usagedash' && usage && (
          <UsageDashboard
            usage={usage}
            limits={limits}
            orgs={orgs}
            activeOrgId={activeOrgId}
            historySessions={sessions}
            liveSessions={liveSessions}
            onAttachLive={handleAttachLive}
            onSelectHistory={handleHistoryClick}
          />
        )}

        {view.mode === 'prdash' && inbox && (
          <PrDashboard
            inbox={inbox}
            orgs={orgs}
            activeOrgId={activeOrgId}
            refreshing={inboxRefreshing}
            onRefresh={refreshInbox}
            onAttachLive={handleAttachLive}
            onSelectHistory={handleHistoryClick}
            onReviewWithClaude={handleReviewWithClaude}
          />
        )}

        {view.mode === 'slack' && <SlackInbox key={activeOrgId} onSendAgent={handleSlackAgent} orgName={activeOrgId === 'all' ? 'Default' : orgs.find(o => o.id === activeOrgId)?.name ?? 'Default'} />}

        {view.mode === 'automations' && (
          <AutomationsPage
            pipelines={pipelines}
            watchers={watchers}
            watcherCmd={watcherCmd}
            onNewWatcher={() => setShowWatcherDialog(true)}
            sessions={liveSessions.filter(s => s.claudeSessionId).map(s => ({ id: s.id, label: (sessionNameOverrides[s.id] || (s.claudeSessionId && sessionNameOverrides[s.claudeSessionId]) || sessions.find(h => h.sessionId === s.claudeSessionId)?.firstUserMessage || s.cwd.split('/').at(-1) || 'Session').slice(0, 70) }))}
            nameOf={id => { const s = liveSessions.find(x => x.id === id); return (s && (sessionNameOverrides[s.id] || (s.claudeSessionId && sessionNameOverrides[s.claudeSessionId]) || sessions.find(h => h.sessionId === s.claudeSessionId)?.firstUserMessage || s.cwd.split('/').at(-1))) || 'Session' }}
            onOpen={id => setAutomateFor(id)}
            onStop={stopPipeline}
          />
        )}

        {view.mode === 'skills' && (
          <SkillsPage key={activeOrgId} selected={view.name} onSelect={name => setView({ mode: 'skills', name })} onChanged={() => setSkillsVersion(v => v + 1)} />
        )}

        {view.mode === 'notes' && (
          <NotesPage notes={notes} setNotes={setNotes} orgs={orgs} activeOrgId={activeOrgId} selected={view.id} onSelect={id => setView({ mode: 'notes', id })} />
        )}

        {view.mode === 'meetinglib' && (
          <MeetingsLibrary
            orgs={orgs}
            activeOrgId={activeOrgId}
            refreshKey={meetings.map(m => m.id + m.status).join()}
            onOpen={(id) => setView({ mode: 'meeting', meetingId: id })}
            onDeleted={refreshMeetings}
          />
        )}

        {view.mode === 'meeting' && viewedMeeting && (
          <MeetingView
            meeting={viewedMeeting}
            live={meetingLive[viewedMeeting.id]}
            orgName={viewedMeeting.orgId !== 'default' ? orgs.find(o => o.id === viewedMeeting.orgId)?.name ?? null : null}
            onStop={stopMeeting}
            onResume={resumeMeeting}
            onAsk={askMeeting}
            onAddContext={addMeetingContext}
            onBack={() => setView({ mode: 'meetinglib' })}
            sessionOptions={sessions.filter(h => !h.headless).sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? '')).map(h => {
              const live = liveSessions.find(s => s.claudeSessionId === h.sessionId)
              const name = (live && sessionNameOverrides[live.id]) || sessionNameOverrides[h.sessionId] || h.firstUserMessage || h.cwd?.split('/').at(-1) || 'Session'
              const short = name.length > 60 ? name.slice(0, 60) + '…' : name
              const date = h.lastTimestamp ? new Date(h.lastTimestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
              return { id: h.sessionId, label: short, hint: date }
            })}
            meetingOptions={meetings.filter(m => m.status !== 'recording').map(m => ({ id: m.id, label: m.title, hint: new Date(m.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }))}
          />
        )}

        {view.mode === 'empty' && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm bg-gray-950">
            Select a session or start a new one
          </div>
        )}

        {sessionError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-700 text-red-200 text-sm px-4 py-2 rounded shadow-lg flex items-center gap-3 z-10">
            <span>{sessionError}</span>
            <button onClick={() => setSessionError(null)} className="text-red-400 hover:text-white font-bold">×</button>
          </div>
        )}

        {notificationsOn && notificationPermission === 'default' && !hideNotifyBanner && (
          <div className="absolute bottom-4 right-4 bg-gray-900/95 border border-gray-700 text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 z-10">
            <span className="text-gray-300">Get notified when a session needs input</span>
            <button
              onClick={requestNotificationPermission}
              className="bg-blue-600 hover:bg-blue-500 text-white rounded px-2 py-1 text-xs font-medium"
            >Enable notifications</button>
            <button onClick={() => setHideNotifyBanner(true)} className="text-gray-500 hover:text-white" aria-label="Dismiss">✕</button>
          </div>
        )}
      </div>

      <CommandPalette items={paletteItems} />

      {showWatcherDialog && (
        <WatcherDialog
          sessions={liveSessions.filter(s => s.claudeSessionId).map(s => ({ id: s.id, label: (sessionNameOverrides[s.id] || (s.claudeSessionId && sessionNameOverrides[s.claudeSessionId]) || sessions.find(h => h.sessionId === s.claudeSessionId)?.firstUserMessage || s.cwd.split('/').at(-1) || 'Session').slice(0, 70) }))}
          error={watcherError}
          onCreate={input => watcherCmd('watcher-create', { ...input, orgId: activeOrgId === 'all' ? 'default' : activeOrgId })}
          onClose={() => setShowWatcherDialog(false)}
        />
      )}

      {automateFor && (() => {
        const s = liveSessions.find(x => x.id === automateFor)
        const name = (s && (sessionNameOverrides[s.id] || (s.claudeSessionId && sessionNameOverrides[s.claudeSessionId]) || sessions.find(h => h.sessionId === s.claudeSessionId)?.firstUserMessage || s.cwd.split('/').at(-1))) || 'Session'
        return (
          <AutomateDialog
            sessionName={name}
            pipeline={[...pipelines].reverse().find(p => p.liveId === automateFor) ?? null}
            error={pipelineError?.liveId === automateFor ? pipelineError.message : null}
            onStart={config => startPipeline(automateFor, config)}
            onStop={stopPipeline}
            onAddPr={(id, url) => addPipelinePr(id, automateFor, url)}
            onAct={(id, prUrl) => actPipeline(id, automateFor, prUrl)}
            onDismiss={dismissPipeline}
            onClose={() => setAutomateFor(null)}
          />
        )
      })()}

      {showRecordDialog && (
        <RecordMeetingDialog
          orgs={orgs}
          defaultOrgId={activeOrgId === 'all' ? 'default' : activeOrgId}
          onStart={handleStartMeeting}
          onCancel={() => setShowRecordDialog(false)}
          onMicTest={micTest}
        />
      )}

      {showDialog && (
        <NewSessionDialog
          knownCwds={Array.from(new Set([
            ...sessions.map(s => s.cwd).filter(Boolean) as string[],
            ...customPaths,
          ]))}
          orgs={orgs}
          defaultOrgId={activeOrgId === 'all' ? 'default' : activeOrgId}
          onAddOrg={addOrg}
          onConfirm={handleNewSession}
          onResumeById={handleResumeById}
          onCancel={() => setShowDialog(false)}
        />
      )}
    </div>
  )
}
