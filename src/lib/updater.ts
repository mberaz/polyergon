import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const REPO = 'polyergon/polyergon'

// How this copy was installed decides how it can be upgraded.
export type InstallMethod = 'installer' | 'npx' | 'global' | 'source'

export interface UpdateInfo {
  current: string
  latest: string | null
  newer: boolean
  notesUrl: string | null
  method: InstallMethod
  command: string | null // what to run yourself when we can't upgrade in place
}

const root = () => process.env.POLYERGON_ROOT || process.cwd()

export function installMethod(dir = root()): InstallMethod {
  // the installer's launchd agent sets POLYERGON_LABEL; default home is ~/.polyergon
  if (dir.includes('/.polyergon/app/node_modules/polyergon') || (process.env.POLYERGON_LABEL && dir.includes('/app/node_modules/polyergon'))) return 'installer'
  if (dir.includes('/_npx/')) return 'npx'
  if (existsSync(join(dir, '.git'))) return 'source'
  return 'global'
}

export function currentVersion(dir = root()): string {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).version } catch { return '0.0.0' }
}

// 0.1.10 > 0.1.9; pre-releases ignored
export function isNewer(a: string, b: string): boolean {
  const p = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map(n => Number(n) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

let cache: { at: number; latest: string | null; notesUrl: string | null; tarball: string | null } | null = null

// Latest GitHub release: published there the moment it's cut (npm lags ~10 min).
async function latestRelease(force = false) {
  if (!force && cache && Date.now() - cache.at < 60 * 60_000) return cache
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'polyergon-updater' } })
    if (!r.ok) throw new Error(String(r.status))
    const j = await r.json() as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] }
    const tgz = j.assets?.find(a => a.name.endsWith('.tgz'))?.browser_download_url ?? null
    cache = { at: Date.now(), latest: j.tag_name?.replace(/^v/, '') ?? null, notesUrl: j.html_url ?? null, tarball: tgz }
  } catch { cache = { at: Date.now(), latest: null, notesUrl: null, tarball: null } }
  return cache
}

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const current = currentVersion()
  const rel = await latestRelease(force)
  const method = installMethod()
  const pkg = rel.tarball ?? `polyergon@${rel.latest ?? 'latest'}`
  const command = method === 'installer' ? null
    : method === 'npx' ? `npx -y ${pkg}`
    : method === 'global' ? `npm install -g ${pkg} && polyergon`
    : 'git pull && npm ci && npm run build'
  return { current, latest: rel.latest, newer: !!rel.latest && isNewer(rel.latest, current), notesUrl: rel.notesUrl, method, command }
}

// Installer installs only: install the new version, then have launchd restart us.
export async function upgradeInPlace(): Promise<{ error: string } | { version: string }> {
  if (installMethod() !== 'installer') return { error: 'This copy was not installed with the Mac installer. Run the command shown instead.' }
  const rel = await latestRelease(true)
  if (!rel.latest || !isNewer(rel.latest, currentVersion())) return { error: 'Already up to date' }
  const appDir = root().split('/node_modules/polyergon')[0]
  const npm = join(dirname(process.execPath), 'npm')
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` }
  try {
    await execFileAsync(existsSync(npm) ? npm : 'npm', ['install', '--prefix', appDir, '--no-fund', '--no-audit', '--loglevel=error', rel.tarball ?? `polyergon@${rel.latest}`], { timeout: 5 * 60_000, env })
  } catch (e) {
    return { error: `Install failed: ${String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').at(-1)}` }
  }
  const label = process.env.POLYERGON_LABEL || 'ai.polyergon'
  // Answer first; then launchd kills and restarts this process on the new code
  setTimeout(() => { execFile('launchctl', ['kickstart', '-k', `gui/${process.getuid?.() ?? 501}/${label}`], () => {}) }, 1500)
  return { version: rel.latest }
}
