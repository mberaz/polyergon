
import { titleFromLines } from '../sessionStore'
test('session title: last /rename wins over the auto title', () => {
  const lines = [
    '{"type":"ai-title","aiTitle":"Fix login bug"}',
    '{"type":"custom-title","customTitle":"auth fix"}',
    '{"type":"ai-title","aiTitle":"Fix login bug v2"}',
    '{"type":"custom-title","customTitle":"auth fix final"}',
  ].join('\n')
  expect(titleFromLines(lines)).toBe('auth fix final')
  expect(titleFromLines('{"type":"ai-title","aiTitle":"Only auto"}\n{"type":"user"')).toBe('Only auto')
  expect(titleFromLines('')).toBeNull()
})
