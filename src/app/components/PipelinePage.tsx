'use client'
import { SlackPeoplePicker } from './SlackPeoplePicker'
import { useState } from 'react'
import type { Pipeline, PipelineConfig, PrTrack, PrReview } from '@/lib/pipelines'
import type { SlackChannel } from '@/lib/slackBridge'
import { DEFAULT_AUTO, type AutoSteps, isRunning, pipelineSummary, shortPr, prSteps, preprSteps } from '@/lib/pipelineView'
import { SlackChannelPicker } from './SlackChannelPicker'
import { SuggestionBox, TRACK_BADGE, AUTO_ROWS } from './AutomateDialog'

type Step = { label: string; done: boolean; current: boolean }

const PHASE: Record<Pipeline['phase'], [string, string]> = {
  'waiting-for-session': ['Watching the session', 'bg-blue-500/15 text-blue-300 ring-blue-500/30'],
  'opening-pr': ['Opening a PR', 'bg-blue-500/15 text-blue-300 ring-blue-500/30'],
  tracking: ['Tracking PRs', 'bg-blue-500/15 text-blue-300 ring-blue-500/30'],
  done: ['Done', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'],
  'needs-you': ['Needs you', 'bg-amber-500/15 text-amber-300 ring-amber-500/30'],
  stopped: ['Stopped', 'bg-gray-700/60 text-gray-300 ring-gray-600'],
}
const REVIEW_CHIP: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'bg-emerald-500/15 text-emerald-300'],
  CHANGES_REQUESTED: ['Changes requested', 'bg-red-500/15 text-red-300'],
  COMMENTED: ['Commented', 'bg-gray-700/70 text-gray-300'],
  DISMISSED: ['Dismissed', 'bg-gray-800 text-gray-500'],
  PENDING: ['Pending', 'bg-gray-800 text-gray-400'],
}
const CI: Record<string, [string, string, string]> = {
  passing: ['●', 'text-emerald-400', 'Checks passing'],
  failing: ['●', 'text-red-400', 'Checks failing'],
  pending: ['◌', 'text-amber-300 animate-pulse', 'Checks running'],
  none: ['○', 'text-gray-500', 'No checks'],
}

// GitHub avatar; bots and unknown logins fall back to an initial
function Avatar({ login }: { login: string }) {
  const [broken, setBroken] = useState(false)
  return broken || login.includes('[bot]')
    ? <span className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-200 flex-shrink-0">{login[0]?.toUpperCase()}</span>
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={`https://github.com/${encodeURIComponent(login)}.png?size=56`} alt="" onError={() => setBroken(true)} className="w-7 h-7 rounded-full bg-gray-800 flex-shrink-0" />
}

// Big horizontal pipeline: numbered nodes, green when done, pulsing when current
// working: the session is busy on this PR, so the current step spins
function Track({ steps, working = false }: { steps: Step[]; working?: boolean }) {
  return (
    <div className="flex items-start py-2">
      {steps.map((s, i) => (
        <div key={s.label} className="flex-1 flex flex-col items-center text-center relative min-w-0">
          {i > 0 && <span className={`absolute top-4 right-1/2 w-full h-[3px] rounded-full ${s.done || s.current ? 'bg-gradient-to-r from-emerald-500 to-blue-500' : 'bg-gray-800'}`} />}
          <span className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ring-4 ring-gray-950 ${
            s.done ? 'bg-emerald-500 text-gray-950' : s.current ? 'bg-blue-500 text-white shadow-[0_0_0_6px_rgba(59,130,246,0.18)]' : 'bg-gray-800 text-gray-500'}`}>
            {s.done ? '✓' : i + 1}
            {s.current && (working || s.label === 'CI running') && <span className="absolute -inset-1.5 rounded-full border-2 border-blue-300 border-t-transparent border-l-transparent animate-spin motion-reduce:animate-none" aria-hidden />}
          </span>
          <span className={`text-xs mt-2 px-1 leading-tight ${s.done ? 'text-gray-200' : s.current ? 'text-blue-300 font-medium' : 'text-gray-600'}`}>{s.label}</span>
          {s.current && working && <span className="text-[10px] text-blue-300/80 animate-pulse motion-reduce:animate-none">Session is working</span>}
        </div>
      ))}
    </div>
  )
}

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-950/60 border border-gray-800/80 p-3.5 min-w-0">
      <div className="flex items-center mb-2.5"><p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{title}</p><span className="ml-auto">{right}</span></div>
      {children}
    </div>
  )
}

function PrPanel({ t, p, auto, onSend, onDismiss, onSetReview }: { t: PrTrack; p: Pipeline; auto: AutoSteps; onSend: () => void; onDismiss: () => void; onSetReview: (r: PrReview) => void }) {
  const review: PrReview = t.review ?? { channel: p.config.slackChannel, reviewers: [] }
  const [editReview, setEditReview] = useState(false)
  const v = t.view
  const [label, cls] = t.view?.isDraft && t.state === 'in-review' ? ['draft', 'bg-gray-700 text-gray-300'] : TRACK_BADGE[t.state]
  const max = p.config.maxRounds
  const ci = CI[v?.checks ?? 'none'] ?? CI.none
  const autoNext = t.suggestion && t.suggestion.kind !== 'open-pr' && auto[t.suggestion.kind]
  return (
    <article className="rounded-2xl border border-gray-800 bg-gradient-to-b from-gray-900/80 to-gray-900/30 p-5 shadow-lg shadow-black/20">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <a href={t.url} target="_blank" rel="noreferrer" className="text-base font-semibold text-gray-100 hover:text-blue-300 leading-snug">{v?.title || shortPr(t.url)}</a>
          <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-2">
            <a href={t.url} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:underline">{shortPr(t.url)}</a>
            {v?.isDraft && <span className="text-amber-300">· draft</span>}
            {!!v?.unresolved && <span className="text-amber-300">· {v.unresolved} unresolved thread{v.unresolved > 1 ? 's' : ''}</span>}
            <span>· review fixes {t.reviewRounds}/{max}</span>
            <span>· CI fixes {t.ciFixes}/{max}</span>
          </p>
        </div>
        <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium ${cls}`}>{label}</span>
        <a href={t.url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-xs px-3 py-1 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-200">Open PR ↗</a>
      </header>

      {!editReview && !review.channel && !review.reviewers.length && !review.dms?.length && !t.slack?.permalink
        ? <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2">
            <p className="text-xs text-amber-300">Not sent for review yet. Choose this PR's Slack channel, people to DM and reviewers.</p>
            <button onClick={() => setEditReview(true)} className="ml-auto text-xs px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap">Choose</button>
          </div>
        : <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-gray-400">
        <span>Review in <b className="text-gray-200 font-medium">{review.channel ? `#${review.channel.name}` : 'no Slack channel'}</b>{!!review.dms?.length && <> · DM <b className="text-gray-200 font-medium">{review.dms.map(personName).join(', ')}</b></>}{review.reviewers.length > 0 && <> · reviewers <b className="text-gray-200 font-medium">{review.reviewers.join(', ')}</b></>}</span>
        {!editReview && <button onClick={() => setEditReview(true)} className="text-blue-400 hover:text-blue-300">Change</button>}
      </div>}
      {editReview && <ReviewEditor initial={review} onSave={r => { onSetReview(r); setEditReview(false) }} onCancel={() => setEditReview(false)} />}

      <div className="mt-4"><Track steps={prSteps(t, !!review.channel)} working={t.state === 'working'} /></div>

      {t.suggestion && <div className="mt-2"><SuggestionBox s={t.suggestion} onSend={onSend} onDismiss={onDismiss} /></div>}
      {autoNext && <p className="text-[11px] text-amber-300/80 mt-1.5">Automatic: goes to the session as soon as it&apos;s idle.</p>}

      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <Panel title="Reviewers">
          {v ? (
            <ul className="space-y-2">
              {v.reviews.map(r => {
                const [txt, c] = REVIEW_CHIP[r.state] ?? [r.state.toLowerCase(), 'bg-gray-800 text-gray-400']
                return <li key={r.login} className="flex items-center gap-2 min-w-0"><Avatar login={r.login} /><span className="text-sm text-gray-200 truncate">{r.login}</span><span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${c}`}>{txt}</span></li>
              })}
              {v.requested.map(r => <li key={r} className="flex items-center gap-2 min-w-0 opacity-70"><Avatar login={r} /><span className="text-sm text-gray-300 truncate">{r}</span><span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400 whitespace-nowrap">Requested</span></li>)}
              {!v.reviews.length && !v.requested.length && <li className="text-xs text-gray-500">No reviewers yet</li>}
            </ul>
          ) : <p className="text-xs text-gray-500 animate-pulse">Loading from GitHub…</p>}
        </Panel>
        <Panel title="CI">
          <p className="flex items-center gap-2 text-sm">
            {v?.checks === 'pending'
              ? <span className="w-4 h-4 rounded-full border-2 border-amber-300 border-t-transparent animate-spin motion-reduce:animate-none" aria-hidden />
              : <span className={`text-lg leading-none ${ci[1]}`}>{ci[0]}</span>}
            <span className="text-gray-200">{ci[2]}</span>
          </p>
          {v && <p className="text-[11px] text-gray-500 mt-2">Updated {new Date(v.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
        </Panel>
        <Panel title={`Slack${t.slack ? ` · #${t.slack.channel}` : ''}`} right={t.slack?.permalink && <a href={t.slack.permalink} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 hover:underline">Open thread ↗</a>}>
          {t.slack ? (
            <div className="space-y-1.5 text-xs">
              {t.slack.reviewers?.length
                ? <p className="text-gray-100">👀 {t.slack.reviewers.join(', ')}</p>
                : <p className="text-gray-500">{t.slack.reviewers ? 'Nobody has claimed it yet' : 'Checking replies…'}</p>}
              {t.slack.replies?.slice(-2).map((r, i) => <p key={i} className="text-gray-400 line-clamp-2"><span className="text-gray-300 font-medium">{r.user}</span> {r.text}</p>)}
            </div>
          ) : <p className="text-xs text-gray-500">{review.channel ? 'Posting…' : review.dms?.length ? 'Sent by DM' : 'No channel set'}</p>}
        </Panel>
      </div>
    </article>
  )
}

export function PipelinePage({ sessionName, pipeline, error, onOpenSession, onReview, onStart, onStop, onAddPr, onSetPrReview, onAct, onDismiss, onSetAuto }: {
  sessionName: string
  pipeline: Pipeline | null
  error: string | null
  onOpenSession: () => void
  onReview?: () => void
  onStart: (config: PipelineConfig) => void
  onStop: (id: string) => void
  onAddPr: (id: string, url: string, review?: PrReview) => void
  onSetPrReview: (id: string, url: string, review: PrReview) => void
  onAct: (id: string, prUrl: string | null) => void
  onDismiss: (id: string, prUrl: string | null) => void
  onSetAuto: (id: string, auto: Partial<AutoSteps>) => void
}) {
  const [channelText, setChannelText] = useState('')
  const [channel, setChannel] = useState<SlackChannel | null>(null)
  const [maxRounds, setMaxRounds] = useState(3)
  const [autoDraft, setAutoDraft] = useState<AutoSteps>(DEFAULT_AUTO)
  const [prUrl, setPrUrl] = useState('')
  const [newReview, setNewReview] = useState<PrReview | null>(null)
  const running = isRunning(pipeline)
  const auto: AutoSteps = running && pipeline ? { ...DEFAULT_AUTO, ...pipeline.config.auto } : autoDraft
  const setAuto = (k: keyof AutoSteps, on: boolean) => running && pipeline ? onSetAuto(pipeline.id, { [k]: on }) : setAutoDraft(a => ({ ...a, [k]: on }))
  const [phaseLabel, phaseCls] = pipeline ? PHASE[pipeline.phase] : ['Not running', 'bg-gray-800 text-gray-400 ring-gray-700']
  const input = 'w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder-gray-500'

  function start() {
    const name = (channel?.name ?? channelText).replace(/^#/, '').trim()
    onStart({ slackChannel: name ? { id: channel?.id ?? '', name } : null, maxRounds, auto: autoDraft })
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gray-950 text-gray-100">
      {/* Hero */}
      <div className="relative border-b border-gray-800 bg-gradient-to-br from-blue-950/50 via-gray-950 to-emerald-950/20 px-8 pt-7 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-300/80">⚡ Ship it pipeline</p>
        <div className="flex items-start gap-4 mt-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold truncate">{sessionName}</h1>
            <p className="text-sm text-gray-400 mt-1">{pipeline ? pipelineSummary(pipeline) : 'Set it up once: it opens the PR, posts it for review, fixes feedback and CI, and asks you before merging.'}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${phaseCls}`}>{phaseLabel}</span>
          <div className="flex gap-2">
            {onReview && <button onClick={onReview} className="text-sm px-3.5 py-1.5 rounded-lg border border-gray-700 bg-gray-900/60 hover:bg-gray-800">Review changes</button>}
            <button onClick={onOpenSession} className="text-sm px-3.5 py-1.5 rounded-lg border border-gray-700 bg-gray-900/60 hover:bg-gray-800">Open session</button>
            {running
              ? <button onClick={() => onStop(pipeline!.id)} className="text-sm px-3.5 py-1.5 rounded-lg border border-red-900/70 text-red-300 hover:bg-red-950/50">Stop</button>
              : <button onClick={start} className="text-sm px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 font-medium">{pipeline ? 'Start again' : 'Start pipeline'}</button>}
          </div>
        </div>
        {pipeline && !pipeline.prs.length && running && <div className="mt-5 max-w-3xl"><Track steps={preprSteps(pipeline)} working={pipeline.phase === 'opening-pr'} /></div>}
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
      </div>

      <div className="px-8 py-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* PRs */}
        <div className="space-y-5 min-w-0">
          {pipeline?.suggestion && <SuggestionBox s={pipeline.suggestion} onSend={() => onAct(pipeline.id, null)} onDismiss={() => onDismiss(pipeline.id, null)} />}
          {pipeline?.prs.map(t => <PrPanel key={t.url} t={t} p={pipeline} auto={auto} onSend={() => onAct(pipeline.id, t.url)} onDismiss={() => onDismiss(pipeline.id, t.url)} onSetReview={r => onSetPrReview(pipeline.id, t.url, r)} />)}
          {running && pipeline && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-4 space-y-2">
              <div className="flex gap-2">
                <input value={prUrl} onChange={e => setPrUrl(e.target.value)} placeholder="Track another PR: https://github.com/org/repo/pull/123" className={input} />
                <button onClick={() => { onAddPr(pipeline.id, prUrl, newReview ?? undefined); setPrUrl(''); setNewReview(null) }} disabled={!prUrl.trim()} className="text-sm px-4 rounded-lg border border-gray-700 hover:bg-gray-800 disabled:opacity-40 flex-shrink-0">Add PR</button>
              </div>
              {newReview
                ? <ReviewEditor initial={newReview} onSave={setNewReview} onCancel={() => setNewReview(null)} saveLabel="Use for this PR" />
                : <button onClick={() => setNewReview({ channel: pipeline.config.slackChannel, reviewers: [] })} className="text-xs text-blue-400 hover:text-blue-300">Different review for this PR (channel, reviewers)…</button>}
              {newReview && <p className="text-[11px] text-gray-500">This PR: {newReview.channel ? `#${newReview.channel.name}` : 'no Slack post'}{newReview.dms?.length ? ` · DM ${newReview.dms.map(personName).join(', ')}` : ''}{newReview.reviewers.length ? ` · ${newReview.reviewers.join(', ')}` : ''}</p>}
            </div>
          )}
          {!running && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 space-y-4">
              <h2 className="text-sm font-semibold">Set up</h2>
              <label className="block text-xs text-gray-400">Slack channel for &quot;ready for review&quot; (optional)
                <div className="mt-1"><SlackChannelPicker value={channelText} onChange={(v, c) => { setChannelText(v); setChannel(c) }} className={input} /></div>
              </label>
              <label className="block text-xs text-gray-400">Fix rounds per PR (review and CI, each)
                <input type="number" min={1} max={10} value={maxRounds} onChange={e => setMaxRounds(Number(e.target.value))} className={`${input} w-24 mt-1`} />
              </label>
            </div>
          )}
        </div>

        {/* Side: steps + activity */}
        <aside className="space-y-5">
          <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
            <h2 className="text-sm font-semibold">Steps</h2>
            <p className="text-[11px] text-gray-500 mb-3">Automatic steps run when the session is idle. Approving is always up to your reviewers.</p>
            <div className="space-y-2">
              {AUTO_ROWS.map(([k, label, hint]) => (
                <div key={k} className="flex items-center justify-between gap-2" title={hint}>
                  <span className="text-sm text-gray-200">{label}</span>
                  <span className="flex rounded-lg border border-gray-700 overflow-hidden text-[11px] flex-shrink-0">
                    <button onClick={() => setAuto(k, true)} className={`px-2.5 py-1 ${auto[k] ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>Auto</button>
                    <button onClick={() => setAuto(k, false)} className={`px-2.5 py-1 ${!auto[k] ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>Ask me</button>
                  </span>
                </div>
              ))}
            </div>
            {pipeline && <p className="text-[11px] text-gray-500 mt-3">Slack: {pipeline.config.slackChannel ? `#${pipeline.config.slackChannel.name}` : 'none'} · up to {pipeline.config.maxRounds} fix rounds per PR</p>}
          </section>

          {pipeline && (
            <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
              <h2 className="text-sm font-semibold mb-3">Activity</h2>
              <ol className="relative border-l border-gray-800 ml-1.5 space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {[...pipeline.log].reverse().map((l, i) => (
                  <li key={i} className="pl-4 relative">
                    <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${i === 0 ? 'bg-blue-400' : 'bg-gray-700'}`} />
                    <p className="text-xs text-gray-200 leading-snug">{l.text}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{new Date(l.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

const personName = (v: string) => v.replace(/ \([UW][A-Z0-9]+\)$/, '')

// One PR's review setup: Slack channel to post in and GitHub reviewers to request.
function ReviewEditor({ initial, onSave, onCancel, saveLabel = 'Save' }: { initial: PrReview; onSave: (r: PrReview) => void; onCancel: () => void; saveLabel?: string }) {
  const [chText, setChText] = useState(initial.channel?.name ?? '')
  const [ch, setCh] = useState<SlackChannel | null>(initial.channel)
  const [who, setWho] = useState(initial.reviewers.join(', '))
  const [dms, setDms] = useState<string[]>(initial.dms ?? [])
  const box = 'w-full bg-gray-950 border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-gray-100 outline-none focus:border-blue-500 placeholder-gray-600'
  const save = () => onSave({ channel: chText.trim() ? (ch ?? { id: '', name: chText.replace(/^#/, '').trim() }) : null, reviewers: who.split(/[\s,]+/).map(x => x.replace(/^@/, '')).filter(Boolean), dms })
  return (
    <div className="mt-2 rounded-lg border border-gray-800 bg-gray-950/60 p-3 grid sm:grid-cols-2 gap-2">
      <label className="text-xs text-gray-400">Slack channel for the review request
        <div className="mt-1"><SlackChannelPicker value={chText} onChange={(v, c) => { setChText(v); setCh(c) }} className={box} /></div>
        <span className="text-[11px] text-gray-500">Leave empty to skip the Slack post.</span>
      </label>
      <div className="text-xs text-gray-400">DM on Slack (optional)
        <div className="mt-1"><SlackPeoplePicker value={dms} onChange={setDms} className={box} /></div>
        <span className="text-[11px] text-gray-500">Each person gets the PR link once. Use only DMs by leaving the channel empty.</span>
      </div>
      <label className="text-xs text-gray-400">GitHub reviewers (optional)
        <input value={who} onChange={e => setWho(e.target.value)} placeholder="alice, bob, org/team" className={`${box} mt-1`} />
      </label>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs px-2.5 py-1 text-gray-400 hover:text-white">Cancel</button>
        <button onClick={save} className="text-xs px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white">{saveLabel}</button>
      </div>
    </div>
  )
}
