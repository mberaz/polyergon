import { DATA_DIR } from './dataDir'
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs'
import { join } from 'path'

// <data>/config.json holds secrets (API keys), so it is always written 0600.
export const CONFIG_FILE = join(DATA_DIR, 'config.json')

export function readConfig(file = CONFIG_FILE): Record<string, unknown> {
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return {} }
}

export function writeConfig(cfg: Record<string, unknown>, file = CONFIG_FILE): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  chmodSync(file, 0o600) // mode above only applies when the file is created
}
