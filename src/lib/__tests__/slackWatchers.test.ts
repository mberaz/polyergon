import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.POLYERGON_DATA_DIR = mkdtempSync(join(tmpdir(), 'watch-'))

const posted: string[] = []
let draft = ''
jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
jest.mock('../liveSessionStore', () => ({ liveSessionStore: { get: () => undefined } }))
jest.mock('../orgRegistry', () => ({ orgRegistry: { get: () => undefined } }))
jest.mock('../slackBridge', () => ({
  NEEDS_OWNER: 'NEEDS_OWNER:',
  newChannelRequests: async () => [{ permalink: `https://x.slack.com/archives/C1/p${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`, author: 'Koren', text: '?' }],
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
