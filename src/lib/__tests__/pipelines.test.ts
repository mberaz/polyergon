import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.POLYERGON_DATA_DIR = mkdtempSync(join(tmpdir(), 'pipes-'))

const session = { id: 'L1', status: 'waiting', prUrl: null as string | null, backend: 'claude' }
const writes: string[] = []
const posts: string[] = []
type Pr = { number: number; state: string; isDraft: boolean; reviewDecision: string | null; statusCheckRollup: object[]; author: { login: string }; reviews: object[]; latestReviews: object[]; reviewRequests: object[]; comments: object[]; title: string }
const base = (n: number): Pr => ({ number: n, state: 'OPEN', isDraft: false, reviewDecision: null, statusCheckRollup: [], author: { login: 'me' }, reviews: [], latestReviews: [], reviewRequests: [{ login: 'alice' }], comments: [], title: `PR ${n}` })
const prs: Record<string, Pr> = {}

jest.mock('../liveSessionStore', () => ({ liveSessionStore: { get: (id: string) => (id === 'L1' ? session : undefined) } }))
jest.mock('../ptyManager', () => ({ writeToSession: (_id: string, t: string) => writes.push(t), onAnyStatusChange: () => () => {}, onAnyPrUrlChange: () => () => {} }))
jest.mock('../slackBridge', () => ({ postToSlack: async (_c: unknown, t: string) => { posts.push(t); return { permalink: null } }, readSlackThread: async () => null }))
jest.mock('child_process', () => ({ execFile: (_c: string, a: string[], _o: object, cb: (e: Error | null, r?: { stdout: string }) => void) => {
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

test('opens a PR, then tracks two PRs independently and queues session work', async () => {
  prs[U1] = base(1); prs[U2] = base(2)
  const p = pipelineEngine.create('L1', { slackChannel: { id: 'C1', name: 'reviews' }, maxRounds: 1 })
  await flush()
  expect(writes.at(-1)).toMatch(/open a pull request/)
  expect(p.phase).toBe('opening-pr')

  session.prUrl = U1
  later(); await pipelineEngine.step(p.id); await flush()
  expect(p.phase).toBe('tracking')
  expect(posts.at(-1)).toContain(U1)

  expect(pipelineEngine.addPr(p.id, 'not a url')).toEqual({ error: 'Not a GitHub pull request URL' })
  expect(pipelineEngine.addPr(p.id, U2)).toBeNull()
  await flush()
  expect(p.prs.map((t: { url: string }) => t.url)).toEqual([U1, U2])

  later(); await pipelineEngine.step(p.id, true) // baselines
  // Both PRs get feedback; the session is asked about one at a time
  prs[U1].reviews = [{ author: { login: 'bob' } }]
  prs[U1].latestReviews = [{ author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }]
  prs[U2].comments = [{ author: { login: 'carol' } }]
  const before = writes.length
  later(); await pipelineEngine.step(p.id, true)
  expect(writes.length).toBe(before + 1)
  expect(writes.at(-1)).toContain(U1)
  expect(p.workingOn).toBe(U1)
  expect(p.prs[0].view).toMatchObject({ requested: ['alice'], reviews: [{ login: 'bob', state: 'CHANGES_REQUESTED' }] })

  later(); await pipelineEngine.step(p.id) // session went quiet → next PR
  expect(writes.at(-1)).toContain(U2)
  expect(p.workingOn).toBe(U2)

  // PR 1 approved + green → ready; PR 2 merged → done
  later(); await pipelineEngine.step(p.id)
  prs[U1].reviewDecision = 'APPROVED'
  prs[U1].statusCheckRollup = [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }]
  prs[U2].state = 'MERGED'
  later(); await pipelineEngine.step(p.id, true)
  expect(p.prs.map((t: { state: string }) => t.state)).toEqual(['ready', 'done'])
  expect(pipelineSummary(p)).toBe('2 PRs · 1 ready')

  prs[U1].state = 'MERGED'
  later(); await pipelineEngine.step(p.id, true)
  expect(p.phase).toBe('done')
})

test('one running automation per session', () => {
  session.prUrl = null
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3 })
  expect(pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3 })).toEqual({ error: 'This session already has a running automation' })
  pipelineEngine.stop(p.id)
  expect(p.phase).toBe('stopped')
})
