import { parseScreenQuestion } from '../screenQuestion'

test('reads a Claude menu from the screen; ignores a plain numbered list', () => {
  const menu = ['Do you want to run this command?', '  kubectl -n tstr-app set image deploy/support-extract …', '', '❯ 1. Yes', '  2. Yes, and don’t ask again', '  3. No, and tell Claude what to do differently', '', 'Esc to cancel'].join('\n')
  const q = parseScreenQuestion(menu)!
  expect(q.options.map(o => o.n)).toEqual(['1', '2', '3'])
  expect(q.options[0].label).toBe('Yes')
  expect(q.text).toContain('Do you want to run this command?')
  expect(parseScreenQuestion('Steps:\n1. Build\n2. Deploy\n\n❯ ')).toBeNull()
})

test('activity line: the spinner text, else the last tool line', () => {
  const { activityLine } = require('../screenQuestion')
  expect(activityLine('⏺ Bash(npm test)\n  ⎿  running\n\n✻ Running tests… (12s · ↓ 3.1k tokens · esc to interrupt)\n\n╭────╮\n│ >  │')).toBe('Running tests… · 12s')
  expect(activityLine('⏺ Read(src/app/page.tsx)\n  ⎿  Read 40 lines')).toBe('Read(src/app/page.tsx)')
  expect(activityLine('hello')).toBeNull()
})
