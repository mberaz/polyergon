import { createReadStream, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { orgRegistry } from './orgRegistry'

const execFileAsync = promisify(execFile)
const PR_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g

function transcriptOf(id: string): string | null {
  for (const { root } of orgRegistry.projectRoots()) {
    let dirs: string[]
    try { dirs = readdirSync(root) } catch { continue }
    for (const d of dirs) { const f = join(root, d, `${id}.jsonl`); if (existsSync(f)) return f }
  }
  return null
}

// Every PR URL a session's transcript mentions, newest mention last.
async function prUrlsIn(file: string): Promise<string[]> {
  const seen = new Map<string, number>()
  let i = 0
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf-8' }), crlfDelay: Infinity })
  for await (const line of rl) for (const u of line.match(PR_RE) ?? []) seen.set(u, i++)
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([u]) => u)
}

const ghEnv = () => { const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN; return env }
const gh = (args: string[]) => execFileAsync('gh', args, { timeout: 30000, env: ghEnv() }).then(r => r.stdout.trim())
let me: Promise<string> | null = null
const myLogin = () => (me ??= gh(['api', 'user', '-q', '.login']).catch(() => { me = null; return '' }))

// Keeps the URLs that are open PRs you authored (sessions mention other people's too).
export async function openAndMine(urls: string[]): Promise<string[]> {
  const login = await myLogin()
  if (!login || !urls.length) return []
  const open = await Promise.all(urls.map(u => gh(['pr', 'view', u, '--json', 'state,author', '-q', '.state + " " + .author.login'])
    .then(o => o === `OPEN ${login}` ? u : null).catch(() => null)))
  return open.filter((u): u is string => !!u)
}

// The open PRs a session worked on that you authored.
export async function openPrsOfSession(claudeSessionId: string): Promise<string[]> {
  const file = transcriptOf(claudeSessionId)
  if (!file) return []
  return openAndMine((await prUrlsIn(file)).slice(-30)) // ponytail: last 30 mentioned; older ones are almost always merged
}

// PR links written to the transcript since `offset` (bytes). First call (offset -1)
// only returns the current end, so old mentions aren't re-read.
export function newPrUrls(claudeSessionId: string, offset: number): { urls: string[]; offset: number } {
  const file = transcriptOf(claudeSessionId)
  if (!file) return { urls: [], offset }
  const size = statSync(file).size
  if (offset < 0 || size < offset) return { urls: [], offset: size }
  const len = Math.min(size - offset, 8 * 1024 * 1024)
  if (!len) return { urls: [], offset }
  const buf = Buffer.alloc(len)
  const fd = openSync(file, 'r')
  try { readSync(fd, buf, 0, len, size - len) } finally { closeSync(fd) }
  return { urls: [...new Set(buf.toString('utf-8').match(PR_RE) ?? [])], offset: size }
}
