import { isNewer, installMethod } from '../updater'

test('compares versions numerically', () => {
  expect(isNewer('0.1.10', '0.1.9')).toBe(true)
  expect(isNewer('v0.2.0', '0.1.9')).toBe(true)
  expect(isNewer('0.1.6', '0.1.6')).toBe(false)
  expect(isNewer('0.1.5', '0.1.6')).toBe(false)
})

test('knows how it was installed', () => {
  expect(installMethod('/Users/a/.polyergon/app/node_modules/polyergon')).toBe('installer')
  expect(installMethod('/Users/a/.npm/_npx/abc123/node_modules/polyergon')).toBe('npx')
  expect(installMethod('/opt/homebrew/lib/node_modules/polyergon')).toBe('global')
})
