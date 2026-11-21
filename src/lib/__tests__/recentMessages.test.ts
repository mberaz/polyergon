import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getRecentMessages, getSessionMessages } from '../sessionStore'

test('reading only the end gives the same last messages as reading everything', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tr-')), 's.jsonl')
  const lines: string[] = []
  for (let i = 0; i < 5000; i++) {
    lines.push(JSON.stringify({ type: 'user', timestamp: `t${i}`, message: { role: 'user', content: `question ${i} ${'x'.repeat(400)}` } }))
    lines.push(JSON.stringify({ type: 'assistant', timestamp: `a${i}`, message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }, { type: 'tool_use' }] } }))
  }
  writeFileSync(f, lines.join('\n') + '\n')
  expect(getRecentMessages(f, 30)).toEqual(await getSessionMessages(f, 30))
})
