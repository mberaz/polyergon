jest.mock('node-pty', () => ({}))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { STARTUP_DIALOG_RE } = require('../ptyManager')

test('recognises the folder-trust screen but not the normal prompt', () => {
  const trust = 'Accessing workspace:\n/Users/x/General/47ad41e6\nQuick safety check: Is this a project you created or one you trust?\n  No, exit\n❯ Yes, I trust this folder\nEnter to confirm · Esc to cancel'
  expect(STARTUP_DIALOG_RE.test(trust)).toBe(true)
  expect(STARTUP_DIALOG_RE.test('● Hi. What do you need?\n✻ Brewed for 1s\n❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)')).toBe(false)
})
