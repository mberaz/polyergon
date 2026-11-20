import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

process.env.POLYERGON_DATA_DIR = mkdtempSync(join(tmpdir(), 'wt-data-'))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createWorktree, removeWorktree } = require('../worktrees')

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe' }).toString().trim()

test('creates a branch + folder per session, unique names, refuses to remove dirty ones', () => {
  const repo = mkdtempSync(join(tmpdir(), 'wt-repo-'))
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'a.txt'), 'a'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init')

  const a = createWorktree(repo, 'Fix login bug')
  expect(a.branch).toBe('polyergon/fix-login-bug')
  expect(git(a.path, 'branch', '--show-current')).toBe('polyergon/fix-login-bug')
  const b = createWorktree(repo, 'Fix login bug')
  expect(b.branch).toBe('polyergon/fix-login-bug-2')

  writeFileSync(join(a.path, 'a.txt'), 'changed')
  expect(() => removeWorktree(a)).toThrow(/uncommitted/)
  removeWorktree(b)
  expect(existsSync(b.path)).toBe(false)
  expect(git(repo, 'branch', '--list', 'polyergon/fix-login-bug-2')).toContain('fix-login-bug-2') // branch kept
})
