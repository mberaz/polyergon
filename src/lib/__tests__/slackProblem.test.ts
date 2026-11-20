import { classifySlackFailure } from '../slackBridge'

test('classifies Slack connector failures', () => {
  expect(classifySlackFailure("The Slack connector needs you to sign in again. It refused the reconnect")).toBe('auth')
  expect(classifySlackFailure('I don\'t have access to a Slack connector in this environment')).toBe('missing')
  expect(classifySlackFailure('The Slack connector refused the connection, so it isn\'t signed in. You\'ll need to authorize "claude.ai Slack"')).toBe('auth')
  expect(classifySlackFailure('Slack API returned 500')).toBe('other')
})
