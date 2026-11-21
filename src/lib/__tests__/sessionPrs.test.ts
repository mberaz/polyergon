import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = mkdtempSync(join(tmpdir(), 'projects-'))
jest.mock('../orgRegistry', () => ({ orgRegistry: { projectRoots: () => [{ orgId: 'o', root }] } }))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { newPrUrls } = require('../sessionPrs')

test('reads only PR links written since the last look', () => {
  mkdirSync(join(root, 'proj'))
  const f = join(root, 'proj', 'sid.jsonl')
  writeFileSync(f, '{"x":"old https://github.com/o/r/pull/1"}\n')
  const first = newPrUrls('sid', -1)
  expect(first.urls).toEqual([]) // first look: start from the end
  appendFileSync(f, '{"x":"Created https://github.com/o/r/pull/2 and https://github.com/o/r/pull/2"}\n')
  const second = newPrUrls('sid', first.offset)
  expect(second.urls).toEqual(['https://github.com/o/r/pull/2'])
  expect(newPrUrls('sid', second.offset).urls).toEqual([])
})
