import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Plugins (which bundle skills) from the marketplaces Claude Code already knows
// (~/.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json).
export interface MarketplacePlugin {
  name: string
  marketplace: string
  description: string
  category: string | null
  installed: boolean
}

const pluginsDir = () => join(process.env.HOME!, '.claude', 'plugins')
const SAFE = /^[\w.-]{1,100}$/

function installedIds(): Set<string> {
  try {
    const d = JSON.parse(readFileSync(join(pluginsDir(), 'installed_plugins.json'), 'utf-8'))
    return new Set(Object.keys(d.plugins ?? d))
  } catch { return new Set() }
}

export function listMarketplacePlugins(): MarketplacePlugin[] {
  const installed = installedIds()
  const out: MarketplacePlugin[] = []
  let markets: string[] = []
  try { markets = readdirSync(join(pluginsDir(), 'marketplaces')) } catch { return [] }
  for (const m of markets) {
    try {
      const d = JSON.parse(readFileSync(join(pluginsDir(), 'marketplaces', m, '.claude-plugin', 'marketplace.json'), 'utf-8'))
      const market = typeof d.name === 'string' ? d.name : m
      for (const p of d.plugins ?? []) {
        if (typeof p?.name !== 'string') continue
        out.push({ name: p.name, marketplace: market, description: String(p.description ?? ''), category: p.category ?? null, installed: installed.has(`${p.name}@${market}`) })
      }
    } catch { /* unreadable marketplace */ }
  }
  return out.sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
}

// Installs for the user (all projects). Plugins that need a marketplace-declared
// command to be accepted are refused here; the error says to install in a terminal.
export async function installPlugin(name: string, marketplace: string): Promise<void> {
  if (!SAFE.test(name) || !SAFE.test(marketplace)) throw new Error('Invalid plugin name')
  try {
    await execFileAsync('claude', ['plugin', 'install', `${name}@${marketplace}`, '--scope', 'user', '--json'], { timeout: 180_000, maxBuffer: 5 * 1024 * 1024 })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string }
    const text = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim() || err.message
    throw new Error(/shownCommand|accept-command/.test(text)
      ? `This plugin runs a setup command that needs your approval. Install it in a terminal: claude plugin install ${name}@${marketplace}`
      : text.split('\n').filter(Boolean).at(-1)?.slice(0, 300) ?? 'Install failed')
  }
}
