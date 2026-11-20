import { parseLoopLog } from '../existingAutomations'

test('splits a loop log into runs', () => {
  const log = '=== 2026-11-20 16:06:43 board (claude-haiku-4-5, board)\nqueue empty\n=== 2026-11-20 16:10:04 board (claude-sonnet-5-5, board-full)\nESCALATE\nfixed 2 items\n'
  expect(parseLoopLog(log)).toEqual([
    { at: '2026-11-20 16:06:43', model: 'claude-haiku-4-5', output: 'queue empty' },
    { at: '2026-11-20 16:10:04', model: 'claude-sonnet-5-5', output: 'ESCALATE\nfixed 2 items' },
  ])
})
