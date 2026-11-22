import { typeInto, isExitCommand } from '../exitCommand'

test('spots /exit typed key by key, with edits; ignores other commands', () => {
  let st = { line: '', submitted: null as string | null }
  for (const k of ['/', 'e', 'x', 'x', '\x7f', 'i', 't']) st = typeInto(st.line, k)
  st = typeInto(st.line, '\x1b[A')
  expect(st.line).toBe('/exit')
  st = typeInto(st.line, '\r')
  expect(st.submitted).toBe('/exit')
  expect(isExitCommand(st.submitted!)).toBe(true)
  expect(isExitCommand('/qu')).toBe(true)
  expect(isExitCommand('/export')).toBe(false)
  expect(isExitCommand('/ex')).toBe(false)
  expect(isExitCommand('please /exit')).toBe(false)
  expect(typeInto('/exit', '\x03').line).toBe('')
})
