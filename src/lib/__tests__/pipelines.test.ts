import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.POLYERGON_DATA_DIR = mkdtempSync(join(tmpdir(), 'pipes-'))

const session = { id: 'L1', status: 'waiting', prUrl: null as string | null, backend: 'claude' }
const writes: string[] = []
const posts: string[] = []
let pr = { state: 'OPEN', reviewDecision: null as string | null, statusCheckRollup: [] as object[], author: { login: 'me' }, reviews: [] as object[], comments: [] as object[], title: 'Add X' }

jest.mock('../liveSessionStore', () => ({ liveSessionStore: { get: (id: string) => (id === 'L1' ? session : undefined) } }))
jest.mock('../ptyManager', () => ({ writeToSession: (_id: string, t: string) => writes.push(t), onAnyStatusChange: () => () => {}, onAnyPrUrlChange: () => () => {} }))
jest.mock('../slackBridge', () => ({ postToSlack: async (_c: unknown, t: string) => { posts.push(t) } }))
jest.mock('child_process', () => ({ execFile: (_c: string, _a: string[], _o: object, cb: (e: null, r: { stdout: string }) => void) => cb(null, { stdout: JSON.stringify(pr) }) }))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pipelineEngine } = require('../pipelines')

let now = 1_000_000
jest.spyOn(Date, 'now').mockImplementation(() => now)
const later = () => { now += 60_000 }
const flush = () => new Promise(r => setImmediate(r))

test('Ship it: open PR → Slack → review feedback → CI fix → ready, with limits', async () => {
  const p = pipelineEngine.create('L1', { slackChannel: { id: 'C1', name: 'reviews' }, maxRounds: 1 })
  await pipelineEngine.step(p.id, true)
  expect(writes.at(-1)).toMatch(/open a pull request/)
  expect(p.phase).toBe('opening-pr')

  session.prUrl = 'https://github.com/o/r/pull/1'
  later(); await pipelineEngine.step(p.id)
  expect(p.phase).toBe('in-review')
  expect(posts.at(-1)).toContain('https://github.com/o/r/pull/1')

  later(); await pipelineEngine.step(p.id, true) // baseline feedback count
  pr.reviews = [{ author: { login: 'bob' } }]
  later(); await pipelineEngine.step(p.id, true)
  expect(p.phase).toBe('working')
  expect(writes.at(-1)).toMatch(/new review feedback/)

  later(); await pipelineEngine.step(p.id) // session quiet again
  pr.statusCheckRollup = [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }]
  later(); await pipelineEngine.step(p.id, true)
  expect(writes.at(-1)).toMatch(/CI is failing/)

  later(); await pipelineEngine.step(p.id)
  pr.comments = [{ author: { login: 'bob' } }]
  later(); await pipelineEngine.step(p.id, true)
  expect(p.phase).toBe('needs-you') // review limit 1 reached
})

test('approved and green → ready; one running automation per session', async () => {
  session.prUrl = 'https://github.com/o/r/pull/2'
  pr = { ...pr, reviews: [], comments: [], statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }], reviewDecision: 'APPROVED' }
  const p = pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3 })
  expect(pipelineEngine.create('L1', { slackChannel: null, maxRounds: 3 })).toEqual({ error: 'This session already has a running automation' })
  await flush() // create() already ran the first check (sets the feedback baseline)
  later(); await pipelineEngine.step(p.id, true)
  expect(p.phase).toBe('ready')
})
