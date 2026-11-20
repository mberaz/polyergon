import { parseChannels, toSlackMarkdown } from '../slackBridge'

test('parses channel arrays from a model reply', () => {
  expect(parseChannels('Here:\n```json\n[{"id":"C2","name":"#zeta"},{"id":"C1","name":"alpha"},{"bad":1}]\n```'))
    .toEqual([{ id: 'C1', name: 'alpha' }, { id: 'C2', name: 'zeta' }])
  expect(parseChannels('no channels')).toEqual([])
})

test('converts summary markdown to Slack mrkdwn', () => {
  expect(toSlackMarkdown('## Decisions\n- **Ship** Friday\n  - sub')).toBe('*Decisions*\n• *Ship* Friday\n  • sub')
})
