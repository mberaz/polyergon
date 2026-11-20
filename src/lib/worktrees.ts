import { execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { DATA_DIR } from './dataDir'

// One git worktree per session: its own branch and folder, so parallel sessions
// in the same repo never edit the same files. Folders live under DATA_DIR/worktrees.
export interface Worktree { repo: string; path: string; branch: string }

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).toString().trim()

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || Math.random().toString(36).slice(2, 8)

export function createWorktree(dir: string, name: string, base = join(DATA_DIR, 'worktrees')): Worktree {
  const repo = git(dir, ['rev-parse', '--show-toplevel'])
  const slug = slugify(name)
  let branch = `polyergon/${slug}`, path = join(base, basename(repo), slug)
  for (let n = 2; existsSync(path) || branchExists(repo, branch); n++) {
    branch = `polyergon/${slug}-${n}`; path = join(base, basename(repo), `${slug}-${n}`)
  }
  mkdirSync(join(base, basename(repo)), { recursive: true })
  git(repo, ['worktree', 'add', '-b', branch, path]) // branches from the repo's current HEAD
  return { repo, path, branch }
}

function branchExists(repo: string, branch: string): boolean {
  try { git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); return true } catch { return false }
}

// Removes the folder, keeps the branch. Refuses (throws) when there are uncommitted changes.
export function removeWorktree(wt: Worktree) {
  try { git(wt.repo, ['worktree', 'remove', wt.path]) } catch (e) {
    const msg = String((e as { stderr?: Buffer }).stderr ?? e)
    throw new Error(/modified|untracked|dirty/i.test(msg) ? 'The worktree has uncommitted changes. Commit or discard them first.' : msg.trim().split('\n').at(-1) || 'Could not remove the worktree')
  }
}
