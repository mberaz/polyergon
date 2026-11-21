import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'

const DIR = '/tmp/polyergon' // short, readable paths for the agent
const MAX = 25 * 1024 * 1024

// Saves dropped files under their own names (report.pdf, report-2.pdf, …) and returns the paths.
export function saveDropped(files: { name?: unknown; data?: unknown }[]): string[] {
  mkdirSync(DIR, { recursive: true })
  const out: string[] = []
  for (const f of files.slice(0, 20)) {
    const name = basename(String(f.name ?? 'file')).replace(/[\x00-\x1f\x7f/]/g, '').slice(0, 200) || 'file'
    const buf = Buffer.from(String(f.data ?? ''), 'base64')
    if (buf.length > MAX) continue
    const ext = extname(name), stem = name.slice(0, name.length - ext.length)
    let p = join(DIR, name)
    for (let i = 2; existsSync(p); i++) p = join(DIR, `${stem}-${i}${ext}`)
    writeFileSync(p, buf)
    out.push(p)
  }
  return out
}

// Paths with spaces or quotes, quoted for a shell-like prompt.
export const quotePath = (p: string) => /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p
