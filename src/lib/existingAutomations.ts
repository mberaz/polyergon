import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { orgRegistry } from './orgRegistry'

const execFileAsync = promisify(execFile)

// Automations that already exist on this Mac, outside Polyergon: launchd agents
// that run Claude (e.g. ~/.claude/loops/run.sh <name>), cron lines, and Claude
// Code hooks. Read-only, except "Run now" (launchctl kickstart).

export interface LoopRun { at: string; output: string }
export interface ExistingLoop {
  label: string
  command: string
  everySec: number | null
  calendar: string | null
  running: boolean
  lastExit: number | null
  model: string | null
  prompt: string | null // first lines of its prompt file, when we can find it
  lastRun: LoopRun | null
  logFile: string | null
}
export interface ExistingHook { org: string; event: string; matcher: string; command: string }

const HOME = () => process.env.HOME!

// Splits a loop log into runs: "=== 2026-11-20 16:10:04 board (model, prompt)" + output lines
export function parseLoopLog(text: string): (LoopRun & { model: string | null })[] {
  const runs: (LoopRun & { model: string | null })[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^=== (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \S+ \(([^,)]+)/)
    if (m) runs.push({ at: m[1], model: m[2], output: '' })
    else if (runs.length && line.trim()) runs[runs.length - 1].output += (runs[runs.length - 1].output ? '\n' : '') + line
  }
  return runs
}

async function launchdStatus(): Promise<Map<string, { pid: number | null; exit: number | null }>> {
  const out = await execFileAsync('launchctl', ['list'], { timeout: 5000 }).then(r => r.stdout).catch(() => '')
  const map = new Map<string, { pid: number | null; exit: number | null }>()
  for (const line of out.split('\n').slice(1)) {
    const [pid, exit, label] = line.split('\t')
    if (label) map.set(label, { pid: pid === '-' ? null : Number(pid), exit: exit === '-' ? null : Number(exit) })
  }
  return map
}

export async function listLoops(): Promise<ExistingLoop[]> {
  const dir = join(HOME(), 'Library', 'LaunchAgents')
  let files: string[] = []
  try { files = readdirSync(dir).filter(f => f.endsWith('.plist')) } catch { return [] }
  const status = await launchdStatus()
  const loops: ExistingLoop[] = []
  for (const f of files) {
    const path = join(dir, f)
    let raw = ''
    try { raw = readFileSync(path, 'utf-8') } catch { continue }
    if (!/claude/i.test(raw)) continue
    let j: { Label?: string; ProgramArguments?: string[]; StartInterval?: number; StartCalendarInterval?: unknown; StandardOutPath?: string }
    try { j = JSON.parse((await execFileAsync('plutil', ['-convert', 'json', '-o', '-', path], { timeout: 5000 })).stdout) } catch { continue }
    const args = j.ProgramArguments ?? []
    const label = j.Label ?? f.replace(/\.plist$/, '')
    // ~/.claude/loops/run.sh <name> → prompts/<name>.md and logs/<name>.log
    const runSh = args.findIndex(a => a.endsWith('/loops/run.sh'))
    const name = runSh >= 0 ? args[runSh + 1] : null
    const loopsDir = runSh >= 0 ? args[runSh].replace(/\/run\.sh$/, '') : null
    const logFile = loopsDir && name ? join(loopsDir, 'logs', `${name}.log`) : j.StandardOutPath ?? null
    let lastRun: LoopRun | null = null, model: string | null = null
    if (logFile && existsSync(logFile)) {
      const runs = parseLoopLog(readFileSync(logFile, 'utf-8').slice(-20000))
      const last = runs.at(-1)
      if (last) { lastRun = { at: last.at, output: last.output.slice(0, 600) }; model = last.model }
    }
    let prompt: string | null = null
    if (loopsDir && name) { try { prompt = readFileSync(join(loopsDir, 'prompts', `${name}.md`), 'utf-8').slice(0, 1500) } catch { /* none */ } }
    const st = status.get(label)
    loops.push({
      label, command: args.join(' '), everySec: j.StartInterval ?? null,
      calendar: j.StartCalendarInterval ? JSON.stringify(j.StartCalendarInterval) : null,
      running: !!st?.pid, lastExit: st?.exit ?? null, model, prompt, lastRun, logFile,
    })
  }
  return loops.sort((a, b) => a.label.localeCompare(b.label))
}

export function listHooks(): ExistingHook[] {
  const out: ExistingHook[] = []
  for (const org of orgRegistry.list()) {
    try {
      const s = JSON.parse(readFileSync(join(org.configDir || join(HOME(), '.claude'), 'settings.json'), 'utf-8'))
      for (const [event, groups] of Object.entries(s.hooks ?? {}) as [string, { matcher?: string; hooks?: { command?: string }[] }[]][]) {
        for (const g of groups) for (const h of g.hooks ?? []) out.push({ org: org.name, event, matcher: g.matcher ?? '', command: String(h.command ?? '').slice(0, 300) })
      }
    } catch { /* no settings */ }
  }
  return out
}

export async function runLoopNow(label: string): Promise<void> {
  if (!(await listLoops()).some(l => l.label === label)) throw new Error('Unknown loop')
  const uid = process.getuid?.() ?? 501
  await execFileAsync('launchctl', ['kickstart', `gui/${uid}/${label}`], { timeout: 10000 })
}

export function loopLogTail(label: string, loops: ExistingLoop[], lines = 80): string {
  const l = loops.find(x => x.label === label)
  if (!l?.logFile) return ''
  try { return readFileSync(l.logFile, 'utf-8').split('\n').slice(-lines).join('\n') } catch { return '' }
}
