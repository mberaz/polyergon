const sent: string[] = []
let screenNow = ''
const session = { id: 'S1', status: 'waiting', backend: 'claude', cwd: '/x', orgId: 'default', claudeSessionId: null as string | null }
jest.mock('../ptyManager', () => ({ screenText: () => screenNow, submitLine: (_id: string, t: string) => sent.push(t), lastOutputAt: new Map(), claudeProjectDir: () => '/nope' }))
jest.mock('../liveSessionStore', () => ({ liveSessionStore: { list: () => [session], get: () => session } }))
jest.mock('../orgRegistry', () => ({ orgRegistry: { get: () => undefined } }))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseLimitReset, sessionWatch } = require('../sessionWatch')

const at = (h: number, m = 0) => new Date(2026, 10, 21, h, m, 0, 0).getTime()

test('reads the reset time from Claude limit messages', () => {
  const now = at(13, 10)
  expect(parseLimitReset('Claude usage limit reached. Your limit will reset at 5pm (Asia/Jerusalem).', now)).toBe(at(17))
  expect(parseLimitReset('5-hour limit reached ∙ resets 3:30pm', now)).toBe(at(15, 30))
  expect(parseLimitReset("You've hit your session limit · resets 1am", now)).toBe(at(1) + 86_400_000) // tomorrow
  expect(parseLimitReset('Usage limit reached · resets in 2h 15m', now)).toBe(now + 135 * 60_000)
  expect(parseLimitReset('❯ waiting for your input', now)).toBeNull()
})

test('continues the session a minute after the limit resets, once', () => {
  const alerts: string[] = []
  sessionWatch.onAlert((a: { title: string }) => alerts.push(a.title))
  screenNow = '5-hour limit reached ∙ resets 3pm'
  sessionWatch.tick(at(14))
  expect(sessionWatch.limitResetAt.get('S1')).toBe(at(15))
  expect(alerts).toEqual(['Usage limit reached'])
  sessionWatch.tick(at(15, 0))
  expect(sent).toEqual([])                       // not before reset + 1 min
  sessionWatch.tick(at(15, 1))
  expect(sent).toEqual(['continue'])
  sessionWatch.tick(at(15, 2))                   // message still on screenNow: don't repeat
  expect(sent).toEqual(['continue'])
  expect(sessionWatch.limitResetAt.has('S1')).toBe(false)
})

test('flags a session that thinks without progress for 15 minutes', () => {
  screenNow = ''
  session.status = 'thinking'
  sessionWatch.tick(at(16))                      // no output ever recorded: quiet since epoch
  expect(sessionWatch.stalledSince.has('S1')).toBe(true)
  session.status = 'waiting'
  sessionWatch.tick(at(16, 1))
  expect(sessionWatch.stalledSince.has('S1')).toBe(false)
})
