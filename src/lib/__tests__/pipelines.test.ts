import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.POLYERGON_DATA_DIR = mkdtempSync(join(tmpdir(), 'pipes-'))

const session = { id: 'L1', status: 'waiting', prUrl: null as string | null, backend: 'claude', cwd: '/repo', claudeSessionId: 'c1' }
const writes: string[] = []
const posts: string[] = []
const postedTo: string[] = []
let dirty = true
let threads: { isResolved: boolean }[] = []
let gqlReviews: { author: { login: string }; state: string; commit: { oid: string } }[] = []
type Pr = { number: number; state: string; isDraft: boolean; reviewDecision: string | null; statusCheckRollup: object[]; author: { login: string }; reviews: object[]; latestReviews: object[]; reviewRequests: object[]; comments: object[]; title: string }
const base = (n: number): Pr => ({ number: n, state: 'OPEN', isDraft: false, reviewDecision: null, statusCheckRollup: [], author: { login: 'me' }, reviews: [], latestReviews: [], reviewRequests: [{ login: 'alice' }], comments: [], title: `PR ${n}` })
const prs: Record<string, Pr> = {}

let foundPrs: string[] = []
const dmed: string[] = []
jest.mock('../liveSessionStore', () => ({ liveSessionStore: { get: (id: string) => (id === 'L1' ? session : undefined) } }))
jest.mock('../ptyManager', () => ({ submitLine: (_id: string, t: string) => writes.push(t), sendWhenReady: (_id: string, t: string) => writes.push(t), onAnyStatusChange: () => () => {}, onAnyPrUrlChange: () => () => {} }))
jest.mock('../sessionPrs', () => ({ openPrsOfSession: async () => foundPrs }))
jest.mock('../slackBridge', () => ({ postToSlack: async (c: { name: string }, t: string) => { posts.push(t); postedTo.push(c.name); return { permalink: null } }, readSlackThread: async () => null, DM_TARGET: /^@?[\p{L}\p{N} ._'-]{1,60}( \([UW][A-Z0-9]{5,}\))?$/u, dmOnSlack: async (who: string) => { dmed.push(who); return { permalink: null } } }))
jest.mock('child_process', () => ({ execFile: (cmd: string, a: string[], _o: object, cb: (e: Error | null, r?: { stdout: string }) => void) => {
  if (cmd === 'git') return a.includes('--porcelain') ? cb(null, { stdout: dirty ? ' M file.ts' : '' }) : cb(new Error('no upstream'))
  if (a[0] === 'pr' && a[1] === 'edit') { posts.push(`gh ${a.join(' ')}`); return cb(null, { stdout: '' }) }
  if (a[0] === 'api') return cb(null, { stdout: JSON.stringify({ data: { repository: { pullRequest: { headRefOid: 'H2', reviewThreads: { nodes: threads }, latestReviews: { nodes: gqlReviews } } } } }) })
  const pr = prs[a[2]]
  pr ? cb(null, { stdout: JSON.stringify(pr) }) : cb(new Error('no pr'))
} }))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pipelineEngine } = require('../pipelines')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pipelineSummary } = require('../pipelineView')

let now = 1_000_000
jest.spyOn(Date, 'now').mockImplementation(() => now)
const later = () => { now += 60_000 }
const flush = () => new Promise(r => setImmediate(r))
const U1 = 'https://github.com/o/r/pull/1', U2 = 'https://github.com/o/r/pull/2'

test('with every step on "Ask me", never writes to the session on its own; suggestions are sent only by act()', async () => {
  prs[U1] = base(1); prs[U2] = base(2)
  const p = pipelineEngine.create('L1', { slackChannel: { id: 'C1', name: 'reviews' }, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush(); later(); await pipelineEngine.step(p.id, true)
  expect(writes).toEqual([])
  expect(p.suggestion).toMatchObject({ kind: 'open-pr' })

  expect(pipelineEngine.act(p.id, null)).toBeNull() // your click
  expect(writes.at(-1)).toMatch(/open a pull request/)
  expect(p.phase).toBe('opening-pr')

  session.prUrl = U1
  later(); await pipelineEngine.step(p.id); await flush()
  expect(p.phase).toBe('tracking')
  expect(posts.at(-1)).toContain(U1)
  expect(pipelineEngine.addPr(p.id, U2)).toBeNull(); await flush()

  later(); await pipelineEngine.step(p.id, true) // baselines
  const before = writes.length
  prs[U1].latestReviews = [{ author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }]
  prs[U1].reviews = [{ author: { login: 'bob' } }]
  prs[U2].statusCheckRollup = [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }]
  later(); await pipelineEngine.step(p.id, true)
  later(); await pipelineEngine.step(p.id, true)
  expect(writes.length).toBe(before) // still nothing typed
  expect(p.prs[0].suggestion).toMatchObject({ kind: 'review' })
  expect(p.prs[1].suggestion).toMatchObject({ kind: 'ci' })
  expect(pipelineSummary(p)).toMatch(/^2 suggestions for you/)

  pipelineEngine.dismiss(p.id, U2)
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[1].suggestion).toBeNull() // CI still failing, but suggested once per failure

  expect(pipelineEngine.act(p.id, U1)).toBeNull()
  expect(writes.at(-1)).toContain(U1)
  expect(p.prs[0].state).toBe('working')
})

test('no open-PR suggestion without code to ship; one automation per session', async () => {
  pipelineEngine.list().forEach((x: { id: string }) => pipelineEngine.stop(x.id))
  session.prUrl = null; dirty = false
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3 })
  await flush(); later(); await pipelineEngine.step(p.id, true)
  expect(p.suggestion ?? null).toBeNull()
  expect(pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3 })).toEqual({ error: 'This session already has a running automation' })
})

test('default automatic steps send review feedback to the idle session, up to maxRounds', async () => {
  pipelineEngine.list().forEach((x: { id: string }) => pipelineEngine.stop(x.id))
  const U3 = 'https://github.com/o/r/pull/3'
  prs[U3] = base(3); session.prUrl = U3
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 1 })
  await flush(); later(); await pipelineEngine.step(p.id, true); await flush()
  later(); await pipelineEngine.step(p.id, true) // baseline feedback
  const before = writes.length
  prs[U3].reviews = [{ author: { login: 'bob' } }]
  later(); await pipelineEngine.step(p.id, true)
  expect(writes.length).toBe(before + 1)
  expect(writes.at(-1)).toContain(U3)
  expect(p.prs[0].reviewRounds).toBe(1)

  // session finishes; more feedback; limit (1) reached → stays a suggestion for you
  later(); await pipelineEngine.step(p.id, true)
  prs[U3].reviews = [{ author: { login: 'bob' } }, { author: { login: 'carol' } }]
  later(); await pipelineEngine.step(p.id, true)
  later(); await pipelineEngine.step(p.id, true)
  expect(writes.length).toBe(before + 1)
  expect(p.prs[0].suggestion).toMatchObject({ kind: 'review' })
})

test('ready to merge only when approved, green, not a draft and no unresolved threads', async () => {
  pipelineEngine.list().forEach((x: { id: string }) => pipelineEngine.stop(x.id))
  const U4 = 'https://github.com/o/r/pull/4'
  prs[U4] = { ...base(4), reviewDecision: 'APPROVED', isDraft: true, statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
  threads = [{ isResolved: false }, { isResolved: true }]
  session.prUrl = U4
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush(); later(); await pipelineEngine.step(p.id, true); await flush()
  later(); await pipelineEngine.step(p.id, true)
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).not.toBe('ready')                       // draft + 1 open thread
  expect(p.prs[0].suggestion).toMatchObject({ kind: 'review' })  // asks the session to handle the thread
  pipelineEngine.dismiss(p.id, U4)
  prs[U4].isDraft = false; threads = [{ isResolved: true }]; prs[U4].reviewRequests = []
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('ready')
  expect(p.prs[0].suggestion).toMatchObject({ kind: 'merge' })
  threads = [{ isResolved: false }]                              // a new comment arrives
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('in-review')

  // Copilot reviewed an older commit: not ready. A person who only commented doesn't block
  threads = []
  gqlReviews = [{ author: { login: 'copilot-pull-request-reviewer' }, state: 'COMMENTED', commit: { oid: 'H1' } }, { author: { login: 'bob' }, state: 'COMMENTED', commit: { oid: 'H2' } }]
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('in-review')
  expect(p.prs[0].view?.blockers).toEqual(["copilot hasn't reviewed the latest commit"])
  await flush()
  expect(posts.filter(x => x.includes('--add-reviewer @copilot'))).toHaveLength(1) // asked Copilot once for this commit
  later(); await pipelineEngine.step(p.id, true); await flush()
  expect(posts.filter(x => x.includes('--add-reviewer @copilot'))).toHaveLength(1)
  // while Copilot re-reviews, GitHub drops its old review: still not ready
  gqlReviews = [{ author: { login: 'bob' }, state: 'APPROVED', commit: { oid: 'H2' } }]
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('in-review')
  expect(p.prs[0].view?.blockers).toContain('copilot is reviewing the latest commit')
  gqlReviews = [{ author: { login: 'copilot-pull-request-reviewer' }, state: 'COMMENTED', commit: { oid: 'H2' } }, { author: { login: 'bob' }, state: 'APPROVED', commit: { oid: 'H2' } }]
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('ready')
})

test('each PR can have its own review channel and reviewers', async () => {
  const U3 = 'https://github.com/o/labeling/pull/3', U4 = 'https://github.com/o/infra/pull/4'
  prs[U3] = base(3); prs[U4] = base(4)
  session.prUrl = null
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  const p = pipelineEngine.create('L1', { slackChannel: { id: 'C1', name: 'reviews' }, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush()
  postedTo.length = 0
  expect(pipelineEngine.addPr(p.id, U3)).toBeNull(); await flush()
  expect(pipelineEngine.addPr(p.id, U4, { channel: { id: 'C9', name: '#infra-reviews' }, reviewers: ['@dana', 'org/sre', 'bad name!'] })).toBeNull(); await flush()
  expect(postedTo).toEqual(['reviews', 'infra-reviews'])
  expect(posts).toContain(`gh pr edit ${U4} --add-reviewer dana,org/sre`)

  // Change U3: new channel gets a post, new reviewer is requested
  expect(pipelineEngine.setPrReview(p.id, U3, { channel: { id: 'C7', name: 'labeling' }, reviewers: ['eve'] })).toBeNull(); await flush()
  expect(postedTo.at(-1)).toBe('labeling')
  expect(posts).toContain(`gh pr edit ${U3} --add-reviewer eve`)
  // No channel: no new post
  const n = postedTo.length
  expect(pipelineEngine.setPrReview(p.id, U3, { channel: null, reviewers: ['eve'] })).toBeNull(); await flush()
  expect(postedTo).toHaveLength(n)
  pipelineEngine.stop(p.id)
})

test('starting finds every open PR of the session, not just the latest', async () => {
  const A = 'https://github.com/o/labeling/pull/16', B = 'https://github.com/o/infra/pull/5061', C = 'https://github.com/o/api/pull/648'
  prs[A] = base(16); prs[B] = base(5061); prs[C] = base(648)
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  session.prUrl = B
  foundPrs = [A, B, C]
  postedTo.length = 0
  const p = pipelineEngine.create('L1', { slackChannel: { id: 'C1', name: 'reviews' }, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush(); await flush()
  expect(p.prs.map((t: { url: string }) => t.url).sort()).toEqual([A, B, C].sort())
  // Only the session's own PR is posted; found ones wait for you to pick their channel
  expect(postedTo).toEqual(['reviews'])
  pipelineEngine.stop(p.id)
  foundPrs = []
})

test('a PR can also DM people on Slack, each once', async () => {
  const D = 'https://github.com/o/labeling/pull/40'
  prs[D] = base(40)
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  session.prUrl = null
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush()
  dmed.length = 0
  expect(pipelineEngine.addPr(p.id, D, { channel: null, reviewers: [], dms: ['@dana', 'Koren Tako (U0BPBE68RJR)', 'bad;name'] })).toBeNull()
  await flush(); await flush()
  expect(dmed).toEqual(['dana', 'Koren Tako (U0BPBE68RJR)'])
  expect(pipelineEngine.setPrReview(p.id, D, { channel: null, reviewers: [], dms: ['dana', 'Koren Tako (U0BPBE68RJR)', 'eve'] })).toBeNull()
  await flush(); await flush()
  expect(dmed).toEqual(['dana', 'Koren Tako (U0BPBE68RJR)', 'eve'])
  pipelineEngine.stop(p.id)
})

test('a finished or stopped automation can be closed; a running one cannot', async () => {
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  session.prUrl = null
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush()
  pipelineEngine.remove(p.id)
  expect(pipelineEngine.list().some((x: { id: string }) => x.id === p.id)).toBe(true)
  pipelineEngine.stop(p.id)
  pipelineEngine.remove(p.id)
  expect(pipelineEngine.list().some((x: { id: string }) => x.id === p.id)).toBe(false)
})

test('a reviewer who only commented (e.g. the claude app) does not block; changes requested does', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reviewBlockersOf } = require('../pipelines')
  expect(reviewBlockersOf([{ login: 'claude', state: 'COMMENTED', commit: 'H' }, { login: 'dean', state: 'APPROVED', commit: 'H' }], 'H', [])).toEqual([])
  expect(reviewBlockersOf([{ login: 'gal', state: 'CHANGES_REQUESTED', commit: 'H' }], 'H', [])).toEqual(['gal requested changes'])
})

test('only reviewers you chose block while pending; GitHub auto-requested ones do not', async () => {
  const E = 'https://github.com/o/api/pull/648', F = 'https://github.com/o/api/pull/649'
  prs[E] = { ...base(648), reviewRequests: [{ login: 'GalBenSinai' }] }
  prs[F] = { ...base(649), reviewRequests: [{ login: 'GalBenSinai' }] }
  threads = []; gqlReviews = []
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  session.prUrl = null
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush()
  pipelineEngine.addPr(p.id, E)
  pipelineEngine.addPr(p.id, F, { channel: null, reviewers: ['galbensinai'] })
  await flush(); await flush(); await flush()
  later(); await pipelineEngine.step(p.id, true)
  const blockers = (u: string) => p.prs.find((t: { url: string }) => t.url === u).view?.blockers
  expect(blockers(E)).toEqual([])
  expect(blockers(F)).toEqual(['waiting for GalBenSinai'])
  pipelineEngine.stop(p.id)
})

test('a draft is not sent for review until it is marked ready', async () => {
  const G = 'https://github.com/o/discovery/pull/9500'
  prs[G] = { ...base(9500), isDraft: true, reviewRequests: [] }
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  session.prUrl = null
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush()
  postedTo.length = 0; dmed.length = 0
  pipelineEngine.addPr(p.id, G, { channel: { id: 'C2', name: 'discovery-prs' }, reviewers: [], dms: ['dana'] })
  await flush(); await flush(); await flush()
  later(); await pipelineEngine.step(p.id, true); await flush()
  expect(postedTo).toEqual([]); expect(dmed).toEqual([])
  // changing the review setup on a draft doesn't DM either
  pipelineEngine.setPrReview(p.id, G, { channel: { id: 'C2', name: 'discovery-prs' }, reviewers: [], dms: ['dana', 'tal'] })
  await flush(); await flush(); await flush()
  expect(dmed).toEqual([])
  prs[G].isDraft = false
  later(); await pipelineEngine.step(p.id, true); await flush(); await flush(); await flush()
  expect(postedTo).toEqual(['discovery-prs']); expect(dmed).toEqual(['dana', 'tal'])
  pipelineEngine.stop(p.id)
})

test('you can tell Claude something about one PR', async () => {
  const H = 'https://github.com/o/app/pull/7831'
  prs[H] = base(7831)
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false } })
  await flush()
  pipelineEngine.addPr(p.id, H); await flush()
  writes.length = 0
  expect(pipelineEngine.instruct(p.id, H, 'let product (Shiri and Lior) know')).toBeNull()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toContain(H)
  expect(writes[0]).toContain('let product (Shiri and Lior) know')
  expect(pipelineEngine.instruct(p.id, H, '  ')).toEqual({ error: expect.any(String) })
  pipelineEngine.stop(p.id)
})

test('post-merge checks are optional: off, a merged PR is done; on, the session verifies it first', async () => {
  const M = 'https://github.com/o/svc/pull/77'
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  session.prUrl = null
  const auto = { openPr: false, review: false, ci: false, merge: false, postMerge: true }
  dirty = false // no open-PR suggestion in the way
  // off (default)
  prs[M] = { ...base(77), state: 'MERGED' }
  let p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto })
  await flush(); pipelineEngine.addPr(p.id, M); await flush(); await flush()
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('done')
  pipelineEngine.stop(p.id)
  // on, automatic
  writes.length = 0
  p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto, postMergeOn: true, postMergeChecks: 'pods healthy in prod-eu' })
  await flush(); pipelineEngine.addPr(p.id, M); await flush(); await flush()
  for (let i = 0; i < 3; i++) { later(); await pipelineEngine.step(p.id, true) } // merged → checks sent (idle, Auto) → session finished
  expect(writes.some((w: string) => w.includes('post-merge checks') && w.includes('pods healthy in prod-eu'))).toBe(true)
  expect(p.log.some((l: { text: string }) => l.text.startsWith('Post-merge checks finished'))).toBe(true)
  expect(p.prs[0].state).toBe('done')
  expect(p.phase).toBe('done')
  const labels = (t: object) => pipelineSummary && require('../pipelineView').prSteps(t, false).map((s: { label: string }) => s.label)
  expect(labels(p.prs[0])).toContain('Post-merge checks done')
  expect(labels({ ...p.prs[0], postMergeRan: false })).not.toContain('Post-merge checks done') // merged before the step was on
})

test('you can close one PR you are finished with', async () => {
  const A = 'https://github.com/o/a/pull/1', B = 'https://github.com/o/b/pull/2'
  prs[A] = base(1); prs[B] = base(2)
  for (const old of pipelineEngine.list()) pipelineEngine.stop(old.id)
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3, auto: { openPr: false, review: false, ci: false, merge: false, postMerge: false } })
  await flush(); pipelineEngine.addPr(p.id, A); pipelineEngine.addPr(p.id, B); await flush()
  expect(pipelineEngine.removePr(p.id, A)).toBeNull()
  expect(p.prs.find((t: { url: string }) => t.url === A).closed).toBe(true) // folded into a 'finished' row, not deleted
  expect(pipelineEngine.removePr(p.id, A, true)).toBeNull()
  expect(p.prs.find((t: { url: string }) => t.url === A).closed).toBe(false) // brought back
  expect(pipelineEngine.removePr(p.id, 'https://github.com/o/x/pull/9')).toEqual({ error: 'PR not found' })
  pipelineEngine.stop(p.id)
})
