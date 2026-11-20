import { execSync } from 'child_process'

const cache = new Map<string, string | null>()

export function getGitRoot(dir: string): string | null {
  if (!dir) return null
  // ~/General/<hash> chat scratch dirs are never repos — skip the synchronous
  // git spawn (hundreds of them made /api/sessions block for ~40s).
  if (/\/General(\/[^/]+)?$/.test(dir)) return null
  if (cache.has(dir)) return cache.get(dir)!
  try {
    const root = execSync(`git -C "${dir}" rev-parse --show-toplevel`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).toString().trim()
    cache.set(dir, root)
    return root
  } catch {
    cache.set(dir, null)
    return null
  }
}
