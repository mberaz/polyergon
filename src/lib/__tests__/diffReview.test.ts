import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { parseUnifiedDiff, sessionDiff } from '../diffReview'

test('parses hunks with line numbers', () => {
  const f = parseUnifiedDiff(['diff --git a/x.ts b/x.ts', 'index 1..2 100644', '--- a/x.ts', '+++ b/x.ts', '@@ -3,3 +3,3 @@ fn', ' keep', '-old', '+new', ' end'].join('\n'))
  expect(f).toHaveLength(1)
  expect(f[0]).toMatchObject({ path: 'x.ts', additions: 1, deletions: 1 })
  expect(f[0].lines.map(l => [l.kind, l.oldNo, l.newNo])).toEqual([['hunk', null, null], ['ctx', 3, 3], ['del', 4, null], ['add', null, 4], ['ctx', 5, 5]])
})

test('branch diff vs main includes commits, uncommitted and new files', () => {
  const r = mkdtempSync(join(tmpdir(), 'diff-'))
  const g = (...a: string[]) => execFileSync('git', ['-C', r, ...a], { stdio: 'pipe' })
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
  writeFileSync(join(r, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-qm', 'init')
  g('checkout', '-qb', 'feature')
  writeFileSync(join(r, 'a.txt'), 'two\n'); g('commit', '-qam', 'change')
  writeFileSync(join(r, 'a.txt'), 'three\n')          // uncommitted on top
  writeFileSync(join(r, 'new.txt'), 'hello\n')        // untracked
  const d = sessionDiff(r)
  expect(d.branch).toBe('feature')
  expect(d.baseLabel).toBe('main')
  expect(d.files.map(f => [f.path, f.status])).toEqual([['a.txt', 'modified'], ['new.txt', 'added']])
  expect(d.files[0].lines.filter(l => l.kind === 'add').map(l => l.text)).toEqual(['three'])
})
