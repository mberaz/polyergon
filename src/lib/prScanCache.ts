import { DATA_DIR } from './dataDir'
import { promises as fs } from 'fs'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import path from 'path'
import { extractPrUrl } from './prDetector'

const DEFAULT_PROJECTS_DIR = path.join(process.env.HOME!, '.claude', 'projects')
const DEFAULT_CACHE_FILE = path.join(DATA_DIR, 'pr-url-cache.json')

interface CacheEntry {
  prUrl: string | null
  mtimeMs: number
  size: number
}

// Persisted, mtime/size-invalidated cache of session -> PR URL. A PR URL from
// `gh pr create` typically appears well past the small header most other
// session metadata reads scan, so this does a full read — but only for files
// that changed since the last scan, never re-reading unchanged ones.
export class PrUrlCache {
  private cache = new Map<string, CacheEntry>()
  private cacheFile: string
  private cacheDir: string
  private projectsDir: string
  private loaded = false

  // Both paths default to the real on-disk locations; tests must pass
  // isolated paths so they never touch the user's actual session state.
  constructor(cacheFile: string = DEFAULT_CACHE_FILE, projectsDir: string = DEFAULT_PROJECTS_DIR) {
    this.cacheFile = cacheFile
    this.cacheDir = path.join(cacheFile, '..')
    this.projectsDir = projectsDir
  }

  private async load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.cacheFile, 'utf-8')
      const parsed: Record<string, CacheEntry> = JSON.parse(raw)
      this.cache = new Map(Object.entries(parsed))
    } catch { /* no cache yet */ }
  }

  private async persist() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
      await fs.writeFile(this.cacheFile, JSON.stringify(Object.fromEntries(this.cache)))
    } catch { /* best-effort */ }
  }

  // Returns sessionId -> prUrl for every known session with a detected PR.
  // Scans the given projects roots (defaults to the single constructor dir,
  // which callers override with every org's root).
  async scan(projectsDirs: string[] = [this.projectsDir]): Promise<Map<string, string>> {
    await this.load()
    const result = new Map<string, string>()
    let changed = false

    for (const dir of projectsDirs) {
      let projectDirs: string[]
      try { projectDirs = await fs.readdir(dir) } catch { continue }

      for (const projectDir of projectDirs) {
        const projectFullPath = path.join(dir, projectDir)
        let dirStat
        try { dirStat = await fs.stat(projectFullPath) } catch { continue }
        if (!dirStat.isDirectory()) continue

        let files: string[]
        try { files = await fs.readdir(projectFullPath) } catch { continue }

        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          const sessionId = file.replace('.jsonl', '')
          const filePath = path.join(projectFullPath, file)

          let stat
          try { stat = await fs.stat(filePath) } catch { continue }

          const cached = this.cache.get(sessionId)
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            if (cached.prUrl) result.set(sessionId, cached.prUrl)
            continue
          }

          // Stream line by line — extractPrUrl returns the LAST match, so
          // carrying the latest per-line hit is equivalent to scanning the whole
          // file, without loading a multi-hundred-MB transcript into memory.
          let prUrl: string | null = null
          try {
            const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity })
            for await (const line of rl) prUrl = extractPrUrl(line) ?? prUrl
          } catch { /* unreadable, treat as no PR */ }

          this.cache.set(sessionId, { prUrl, mtimeMs: stat.mtimeMs, size: stat.size })
          changed = true
          if (prUrl) result.set(sessionId, prUrl)
        }
      }
    }

    if (changed) await this.persist()
    return result
  }
}

declare global { var __prUrlCache: PrUrlCache | undefined }
export const prUrlCache: PrUrlCache =
  global.__prUrlCache ?? (global.__prUrlCache = new PrUrlCache())
