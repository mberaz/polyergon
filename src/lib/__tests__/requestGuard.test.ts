import { isAllowedRequest } from '../requestGuard'

const hosts = ['localhost', '127.0.0.1', '[::1]', 'polyergon']

test('allows the app itself', () => {
  expect(isAllowedRequest({ host: 'localhost:3030' }, hosts)).toBe(true)
  expect(isAllowedRequest({ host: 'polyergon:3030', origin: 'http://polyergon:3030' }, hosts)).toBe(true)
  expect(isAllowedRequest({ host: '[::1]:3030', origin: 'http://[::1]:3030' }, hosts)).toBe(true)
})

test('blocks other websites and DNS rebinding', () => {
  expect(isAllowedRequest({ host: 'localhost:3030', origin: 'https://evil.example' }, hosts)).toBe(false)
  expect(isAllowedRequest({ host: 'evil.example:3030' }, hosts)).toBe(false)
  expect(isAllowedRequest({ host: 'localhost:3030', origin: 'null' }, hosts)).toBe(false)
  expect(isAllowedRequest({}, hosts)).toBe(false)
})
