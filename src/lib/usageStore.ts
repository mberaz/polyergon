import { DATA_DIR } from './dataDir'
import { createReadStream, promises as fsp } from 'fs'
import { createInterface } from 'readline'
import path from 'path'
import { orgRegistry } from './orgRegistry'

// Estimated API-equivalent pricing, $ per MTok. Cache reads bill ~0.1× input,
// cache writes ~1.25× input (5-minute TTL).
const PRICING: [RegExp, { input: number; output: number }][] = [
  [/fable|mythos/i, { input: 10, output: 50 }],
  [/opus/i, { input: 5, output: 25 }],
  [/sonnet/i, { input: 3, output: 15 }],
  [/haiku/i, { input: 1, output: 5 }],
]

function priceFor(model: string): { input: number; output: number } {
  return PRICING.find(([re]) => re.test(model))?.[1] ?? { input: 5, output: 25 }
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface SessionUsage {
  tokens: TokenTotals
  costUSD: number
  requests: number
  lastActivity: number
  // Context size of the LAST request (input + cache read + cache write) — i.e.
  // what Claude actually sent on its latest turn. Drives the per-card context
  // badge; large contexts are the main cost driver (cache writes/reads).
  contextTokens: number
  // Cost per hour bucket (epoch ms of hour start), pruned to the last 8 days —
  // lets org rollups compute 5h/24h/7d windows without per-request storage
  hourlyCost: Record<string, number>
  hourlyOutput: Record<string, number>
}

interface CacheEntry {
  mtimeMs: number
  size: number
  usage: SessionUsage
}

const HOUR = 3_600_000
const PRUNE_MS = 8 * 24 * HOUR
const DEFAULT_CACHE_FILE = path.join(DATA_DIR, 'usage-cache.json')

function emptyUsage(): SessionUsage {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    costUSD: 0,
    requests: 0,
    lastActivity: 0,
    contextTokens: 0,
    hourlyCost: {},
    hourlyOutput: {},
  }
}

// Streams one transcript and aggregates its assistant-message usage.
// Claude Code writes the same message id on multiple lines as content
// streams in (usage repeated) — dedupe by message id, last write wins.
async function scanFile(filePath: string): Promise<SessionUsage> {
  const byMessage = new Map<string, { usage: SessionUsage['tokens'] & { cost: number }; t: number }>()

  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue
    try {
      const entry = JSON.parse(line)
      const msg = entry.message
      const u = msg?.usage
      if (!u || !msg?.id) continue
      const model: string = msg.model ?? ''
      if (model === '<synthetic>') continue
      const p = priceFor(model)
      const input = u.input_tokens ?? 0
      const output = u.output_tokens ?? 0
      const cacheRead = u.cache_read_input_tokens ?? 0
      const cacheCreation = u.cache_creation_input_tokens ?? 0
      const cost =
        (input * p.input + output * p.output + cacheRead * 0.1 * p.input + cacheCreation * 1.25 * p.input) / 1_000_000
      const t = entry.timestamp ? Date.parse(entry.timestamp) : 0
      byMessage.set(msg.id, { usage: { input, output, cacheRead, cacheCreation, cost }, t: Number.isNaN(t) ? 0 : t })
    } catch { /* malformed line */ }
  }

  const usage = emptyUsage()
  byMessage.forEach(({ usage: u, t }) => {
    usage.tokens.input += u.input
    usage.tokens.output += u.output
    usage.tokens.cacheRead += u.cacheRead
    usage.tokens.cacheCreation += u.cacheCreation
    usage.costUSD += u.cost
    usage.requests += 1
    if (t >= usage.lastActivity) usage.contextTokens = u.input + u.cacheRead + u.cacheCreation
    if (t > usage.lastActivity) usage.lastActivity = t
    if (t > 0) {
      const bucket = String(Math.floor(t / HOUR) * HOUR)
      usage.hourlyCost[bucket] = (usage.hourlyCost[bucket] ?? 0) + u.cost
      usage.hourlyOutput[bucket] = (usage.hourlyOutput[bucket] ?? 0) + u.output
    }
  })
  return usage
}

function pruneHourly(usage: SessionUsage) {
  const cutoff = Date.now() - PRUNE_MS
  for (const key of Object.keys(usage.hourlyCost)) {
    if (Number(key) < cutoff) { delete usage.hourlyCost[key]; delete usage.hourlyOutput[key] }
  }
}

export interface OrgWindow {
  costUSD: number
  outputTokens: number
}

export interface OrgUsage {
  last5h: OrgWindow
  last24h: OrgWindow
  last7d: OrgWindow
  totalCostUSD: number
  totalTokens: TokenTotals
  sessions: number
  // Cost per calendar day (local midnight epoch ms), oldest first, last 7 days
  daily: { dayStart: number; costUSD: number }[]
}

export interface UsageReport {
  sessions: Record<string, { costUSD: number; tokens: TokenTotals; requests: number; contextTokens: number; orgId: string }>
  orgs: Record<string, OrgUsage>
  scannedAt: number
}

export class UsageScanner {
  private cache = new Map<string, CacheEntry>() // key: sessionId
  private cacheFile: string
  private loaded = false
  private lastReport: UsageReport | null = null
  private inFlight: Promise<UsageReport> | null = null

  constructor(cacheFile: string = DEFAULT_CACHE_FILE) {
    this.cacheFile = cacheFile
  }

  private async load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fsp.readFile(this.cacheFile, 'utf-8')
      this.cache = new Map(Object.entries(JSON.parse(raw)))
    } catch { /* no cache yet */ }
  }

  private async persist() {
    try {
      await fsp.mkdir(path.dirname(this.cacheFile), { recursive: true })
      await fsp.writeFile(this.cacheFile, JSON.stringify(Object.fromEntries(this.cache)))
    } catch { /* best-effort */ }
  }

  async report(ttlMs = 60_000): Promise<UsageReport> {
    if (this.lastReport && Date.now() - this.lastReport.scannedAt < ttlMs) return this.lastReport
    if (!this.inFlight) {
      this.inFlight = this.buildReport()
        .then(r => { this.lastReport = r; return r })
        .finally(() => { this.inFlight = null })
    }
    return this.inFlight
  }

  private async buildReport(): Promise<UsageReport> {
    await this.load()
    const sessions: UsageReport['sessions'] = {}
    const orgs: Record<string, OrgUsage> = {}
    let cacheChanged = false
    const now = Date.now()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const dayStarts = Array.from({ length: 7 }, (_, i) => todayStart.getTime() - (6 - i) * 24 * HOUR)

    for (const { orgId, root } of orgRegistry.projectRoots()) {
      let projectDirs: string[]
      try { projectDirs = await fsp.readdir(root) } catch { continue }

      const orgUsage: OrgUsage = orgs[orgId] ?? {
        last5h: { costUSD: 0, outputTokens: 0 },
        last24h: { costUSD: 0, outputTokens: 0 },
        last7d: { costUSD: 0, outputTokens: 0 },
        totalCostUSD: 0,
        totalTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        sessions: 0,
        daily: dayStarts.map(dayStart => ({ dayStart, costUSD: 0 })),
      }
      orgs[orgId] = orgUsage

      for (const projectDir of projectDirs) {
        let files: string[]
        try { files = await fsp.readdir(path.join(root, projectDir)) } catch { continue }
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          const sessionId = file.replace('.jsonl', '')
          const filePath = path.join(root, projectDir, file)
          let stat
          try { stat = await fsp.stat(filePath) } catch { continue }

          let entry = this.cache.get(sessionId)
          // `contextTokens === undefined` = entry cached before the field existed → rescan once
          if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size || entry.usage.contextTokens === undefined) {
            try {
              entry = { mtimeMs: stat.mtimeMs, size: stat.size, usage: await scanFile(filePath) }
            } catch { continue }
            this.cache.set(sessionId, entry)
            cacheChanged = true
          }
          pruneHourly(entry.usage)
          const u = entry.usage
          if (u.requests === 0) continue

          sessions[sessionId] = { costUSD: u.costUSD, tokens: u.tokens, requests: u.requests, contextTokens: u.contextTokens ?? 0, orgId }
          orgUsage.sessions += 1
          orgUsage.totalCostUSD += u.costUSD
          orgUsage.totalTokens.input += u.tokens.input
          orgUsage.totalTokens.output += u.tokens.output
          orgUsage.totalTokens.cacheRead += u.tokens.cacheRead
          orgUsage.totalTokens.cacheCreation += u.tokens.cacheCreation
          for (const [bucket, cost] of Object.entries(u.hourlyCost)) {
            const t = Number(bucket)
            const age = now - t
            const out = u.hourlyOutput[bucket] ?? 0
            if (age < 5 * HOUR) { orgUsage.last5h.costUSD += cost; orgUsage.last5h.outputTokens += out }
            if (age < 24 * HOUR) { orgUsage.last24h.costUSD += cost; orgUsage.last24h.outputTokens += out }
            if (age < 7 * 24 * HOUR) { orgUsage.last7d.costUSD += cost; orgUsage.last7d.outputTokens += out }
            const day = orgUsage.daily.find(d => t >= d.dayStart && t < d.dayStart + 24 * HOUR)
            if (day) day.costUSD += cost
          }
        }
      }
    }

    if (cacheChanged) await this.persist()
    return { sessions, orgs, scannedAt: Date.now() }
  }
}

declare global { var __usageScanner: UsageScanner | undefined }
export const usageScanner: UsageScanner =
  global.__usageScanner ?? (global.__usageScanner = new UsageScanner())
