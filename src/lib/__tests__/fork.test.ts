import { forkLines } from '../fork'

test('keeps history up to the fork point, under the new id', () => {
  const src = [
    { type: 'last-prompt', leafUuid: 'c', sessionId: 'old' },
    { type: 'user', uuid: 'a', sessionId: 'old' },
    { type: 'assistant', uuid: 'b', sessionId: 'old' },
    { type: 'user', uuid: 'c', sessionId: 'old' },
  ].map(e => JSON.stringify(e))
  const out = forkLines(src, 'b', 'new')!.map(l => JSON.parse(l))
  expect(out.map(e => e.uuid)).toEqual(['a', 'b'])
  expect(out.every(e => e.sessionId === 'new')).toBe(true)
  expect(forkLines(src, 'zzz', 'new')).toBeNull()
})
