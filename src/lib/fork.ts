import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

// Copy of a Claude transcript up to and including entry `at`, as session `newId`.
// The CLI's --resume-session-at only works with -p, so an interactive fork resumes this copy.
export function forkLines(lines: string[], at: string, newId: string): string[] | null {
  const out: string[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'last-prompt') continue // points at the old leaf
    if ('sessionId' in e) e.sessionId = newId
    out.push(JSON.stringify(e))
    if (e.uuid === at) return out
  }
  return null // `at` not in this transcript
}

export function forkTranscript(file: string, at: string, newId: string): boolean {
  const lines = forkLines(readFileSync(file, 'utf-8').split('\n'), at, newId)
  if (!lines) return false
  writeFileSync(join(dirname(file), `${newId}.jsonl`), lines.join('\n') + '\n')
  return true
}
