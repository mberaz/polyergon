import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.POLYERGON_DATA_DIR = mkdtempSync(join(tmpdir(), 'pipes-'))

const session = { id: 'L1', status: 'waiting', prUrl: null as string | null, backend: 'claude', cwd: '/repo' }
const writes: string[] = []
const posts: string[] = []
let dirty = true
let threads: { isResolved: boolean }[] = []
type Pr = { number: number; state: string; isDraft: boolean; reviewDecision: string | null; statusCheckRollup: object[]; author: { login: string }; reviews: object[]; latestReviews: object[]; reviewRequests: object[]; comments: object[]; title: string }
const base = (n: number): Pr => ({ number: n, state: 'OPEN', isDraft: false, reviewDecision: null, statusCheckRollup: [], author: { login: 'me' }, reviews: [], latestReviews: [], reviewRequests: [{ login: 'alice' }], comments: [], title: `PR ${n}` })
const prs: Record<string, Pr> = {}

jest.mock('../liveSessionStore', () => ({ liveSessionStore: { get: (id: string) => (id === 'L1' ? session : undefined) } }))
jest.mock('../ptyManager', () => ({ submitLine: (_id: string, t: string) => writes.push(t), onAnyStatusChange: () => () => {}, onAnyPrUrlChange: () => () => {} }))
jest.mock('../slackBridge', () => ({ postToSlack: async (_c: unknown, t: string) => { posts.push(t); return { permalink: null } }, readSlackThread: async () => null }))
jest.mock('child_process', () => ({ execFile: (cmd: string, a: string[], _o: object, cb: (e: Error | null, r?: { stdout: string }) => void) => {
  if (cmd === 'git') return a.includes('--porcelain') ? cb(null, { stdout: dirty ? ' M file.ts' : '' }) : cb(new Error('no upstream'))
  if (a[0] === 'api') return cb(null, { stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } } }) })
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
  prs[U4].isDraft = false; threads = [{ isResolved: true }]
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('ready')
  expect(p.prs[0].suggestion).toMatchObject({ kind: 'merge' })
  threads = [{ isResolved: false }]                              // a new comment arrives
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs[0].state).toBe('in-review')
})
