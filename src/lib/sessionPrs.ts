import { createReadStream, existsSync, readdirSync } from 'fs'
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

// The open PRs a session worked on that you authored (it mentions other people's too).
export async function openPrsOfSession(claudeSessionId: string): Promise<string[]> {
  const file = transcriptOf(claudeSessionId)
  if (!file) return []
  const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN
  const gh = (args: string[]) => execFileAsync('gh', args, { timeout: 30000, env }).then(r => r.stdout.trim())
  const me = await gh(['api', 'user', '-q', '.login']).catch(() => '')
  if (!me) return []
  const urls = (await prUrlsIn(file)).slice(-30) // ponytail: last 30 mentioned; older ones are almost always merged
  const open = await Promise.all(urls.map(u => gh(['pr', 'view', u, '--json', 'state,author', '-q', '.state + " " + .author.login'])
    .then(o => o === `OPEN ${me}` ? u : null).catch(() => null)))
  return open.filter((u): u is string => !!u)
}
