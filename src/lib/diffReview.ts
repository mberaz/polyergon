import { execFileSync } from 'child_process'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'

// What a session changed: everything since its branch left the main branch,
// committed or not, plus new (untracked) files. Read-only git commands only.
export interface DiffLine { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string; oldNo: number | null; newNo: number | null }
export interface DiffFile { path: string; status: 'added' | 'deleted' | 'modified' | 'renamed'; additions: number; deletions: number; lines: DiffLine[]; binary?: boolean }
export interface DiffResult { base: string; baseLabel: string; branch: string; files: DiffFile[]; truncated: boolean }

const MAX_BYTES = 1_500_000
const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20_000_000, timeout: 20_000 }).toString()

// Parses `git diff` output into files and numbered lines.
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let f: DiffFile | null = null, oldNo = 0, newNo = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/)
      f = { path: m ? m[2] : line.slice(11), status: 'modified', additions: 0, deletions: 0, lines: [] }
      files.push(f)
    } else if (!f) continue
    else if (line.startsWith('new file')) f.status = 'added'
    else if (line.startsWith('deleted file')) f.status = 'deleted'
    else if (line.startsWith('rename to ')) { f.status = 'renamed'; f.path = line.slice(10) }
    else if (line.startsWith('Binary files')) f.binary = true
    else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
      if (m) { oldNo = Number(m[1]); newNo = Number(m[2]) }
      f.lines.push({ kind: 'hunk', text: line, oldNo: null, newNo: null })
    } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('similarity') || line.startsWith('rename from') || line.startsWith('old mode') || line.startsWith('new mode')) continue
    else if (line.startsWith('+')) { f.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ }); f.additions++ }
    else if (line.startsWith('-')) { f.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null }); f.deletions++ }
    else if (line.startsWith(' ')) f.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  return files
}

// Base = where this branch split from the main branch; on the main branch itself, HEAD (so: uncommitted work).
function findBase(cwd: string): { base: string; label: string } {
  const head = git(cwd, ['rev-parse', 'HEAD']).trim()
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    try {
      const mb = git(cwd, ['merge-base', 'HEAD', ref]).trim()
      if (mb && mb !== head) return { base: mb, label: ref.replace(/^origin\//, '') === 'HEAD' ? 'main branch' : ref.replace(/^origin\//, '') }
      if (mb === head) break
    } catch { /* ref missing */ }
  }
  return { base: head, label: 'last commit' }
}

// A pull request's diff from GitHub (needs gh). For sessions that worked outside their own folder.
export function prDiff(url: string): DiffResult {
  const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN
  const run = (args: string[]) => execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20_000_000, timeout: 30_000, env }).toString()
  let text = run(['pr', 'diff', url])
  let truncated = false
  if (text.length > MAX_BYTES) { text = text.slice(0, MAX_BYTES); truncated = true }
  const meta = JSON.parse(run(['pr', 'view', url, '--json', 'headRefName,baseRefName']))
  return { base: meta.baseRefName, baseLabel: meta.baseRefName, branch: meta.headRefName, files: parseUnifiedDiff(text), truncated }
}

export function sessionDiff(cwd: string): DiffResult {
  const { base, label } = findBase(cwd)
  const branch = git(cwd, ['branch', '--show-current']).trim() || 'detached'
  let text = git(cwd, ['diff', '--no-color', '--find-renames', base])
  let truncated = false
  if (text.length > MAX_BYTES) { text = text.slice(0, MAX_BYTES); truncated = true }
  const files = parseUnifiedDiff(text)
  // New files git doesn't track yet
  for (const p of git(cwd, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).slice(0, 200)) {
    try {
      if (statSync(join(cwd, p)).size > 200_000) { files.push({ path: p, status: 'added', additions: 0, deletions: 0, lines: [], binary: true }); continue }
      const body = readFileSync(join(cwd, p), 'utf-8')
      if (body.includes('\u0000')) { files.push({ path: p, status: 'added', additions: 0, deletions: 0, lines: [], binary: true }); continue }
      const rows = body.split('\n'); if (rows.at(-1) === '') rows.pop()
      files.push({ path: p, status: 'added', additions: rows.length, deletions: 0, lines: rows.map((t, i) => ({ kind: 'add' as const, text: t, oldNo: null, newNo: i + 1 })) })
    } catch { /* vanished */ }
  }
  return { base, baseLabel: label, branch, files, truncated }
}
