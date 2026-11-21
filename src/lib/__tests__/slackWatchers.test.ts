import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.POLYERGON_DATA_DIR = mkdtempSync(join(tmpdir(), 'watch-'))

const posted: string[] = []
let draft = ''
let mockReqs: { permalink: string; author: string; text: string }[] | null = null
jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
const typed: string[] = []
jest.mock('../liveSessionStore', () => ({ liveSessionStore: { get: (id: string) => (id === 'L1' ? { claudeSessionId: 'c1', cwd: '/r', orgId: 'o' } : undefined) } }))
jest.mock('../ptyManager', () => ({ sendWhenReady: (_id: string, t: string) => typed.push(t) }))
jest.mock('../orgRegistry', () => ({ orgRegistry: { get: () => undefined } }))
jest.mock('../slackBridge', () => ({
  NEEDS_OWNER: 'NEEDS_OWNER:',
  newChannelRequests: async () => mockReqs ?? [{ permalink: `https://x.slack.com/archives/C1/p${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`, author: 'Koren', text: '?' }],
  draftChannelReply: async () => draft,
  replyInThread: async (_p: string, t: string) => { posted.push(t) },
  timeFromPermalink: (p: string) => new Date(Number(p.split('/p')[1]) / 1000 + 60_000).toISOString(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { slackWatchers } = require('../slackWatchers')

test('auto mode posts real answers but keeps NEEDS_OWNER drafts for you', async () => {
  const w = slackWatchers.create({ channel: { id: 'C1', name: 'deployment' }, liveId: null, mode: 'auto', intervalMin: 5, orgId: 'o' })

  draft = 'The rollout is done.'
  await slackWatchers.run(w.id)
  expect(posted).toEqual(['The rollout is done.'])

  draft = "NEEDS_OWNER: I'll check and post results."
  await slackWatchers.run(w.id)
  expect(posted).toHaveLength(1)
  const it = slackWatchers.list()[0].items[0]
  expect(it.state).toBe('pending')
  expect(it.draft).toBe("I'll check and post results.")
})

test('auto mode with a linked session hands NEEDS_OWNER requests to the session', async () => {
  const w = slackWatchers.create({ channel: { id: 'C1', name: 'deployment' }, liveId: 'L1', mode: 'auto', intervalMin: 5, orgId: 'o' })
  draft = "NEEDS_OWNER: I'll check the rollout."
  await slackWatchers.run(w.id)
  const it = slackWatchers.list().find((x: { id: string }) => x.id === w.id).items[0]
  expect(it.state).toBe('delegated')
  expect(typed).toHaveLength(1)
  expect(typed[0]).toContain('reply in that Slack thread')
  expect(slackWatchers.delegate(w.id, it.permalink)).toEqual({ error: 'Already handed off' })
})

test('your instruction goes to the linked session; without one it errors', () => {
  const linked = slackWatchers.create({ channel: { id: 'C1', name: 'deployment' }, liveId: 'L1', mode: 'approve', intervalMin: 5, orgId: 'o' })
  const before = typed.length
  expect(slackWatchers.instruct(linked.id, 'answer Koren with the deploy status')).toBeNull()
  expect(typed.slice(before)).toHaveLength(1)
  expect(typed.at(-1)).toContain('#deployment')
  expect(typed.at(-1)).toContain('answer Koren with the deploy status')
  const unlinked = slackWatchers.create({ channel: { id: 'C2', name: 'other' }, liveId: null, mode: 'approve', intervalMin: 5, orgId: 'o' })
  expect(slackWatchers.instruct(unlinked.id, 'x')).toEqual({ error: expect.stringContaining('Link a session') })
})

test('a follow-up in a thread the session handles goes back to that session, not to a draft', async () => {
  const ts = Math.floor(Date.now() / 1000) + 60
  const w = slackWatchers.create({ channel: { id: 'C1', name: 'deployment' }, liveId: 'L1', mode: 'auto', intervalMin: 5, orgId: 'o' })
  mockReqs = [{ permalink: `https://x.slack.com/archives/C1/p${ts}000100`, author: 'Koren', text: 'When will it be ready?' }]
  draft = 'NEEDS_OWNER: needs the rollout'
  await slackWatchers.run(w.id)
  expect(slackWatchers.list().find((x: { id: string }) => x.id === w.id).items[0].state).toBe('delegated')

  const before = typed.length
  mockReqs = [{ permalink: `https://x.slack.com/archives/C1/p${ts + 5}000200?thread_ts=${ts}.000100&cid=C1`, author: 'Koren', text: 'still not working' }]
  draft = 'should not be used'
  jest.setSystemTime(Date.now() + 10 * 60_000)
  await slackWatchers.run(w.id)
  const items = slackWatchers.list().find((x: { id: string }) => x.id === w.id).items
  expect(items[0].state).toBe('delegated')
  expect(typed.slice(before)).toHaveLength(1)
  expect(typed.at(-1)).toContain('still not working')
  mockReqs = null
})

test('threadKey matches a top-level post and its replies', () => {
  const { threadKey } = require('../slackWatchers')
  expect(threadKey('https://x.slack.com/archives/C1/p1795082828257279')).toBe('1795082828.257279')
  expect(threadKey('https://x.slack.com/archives/C1/p1795083000000100?thread_ts=1795082828.257279&cid=C1')).toBe('1795082828.257279')
})
