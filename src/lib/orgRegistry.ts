import { DATA_DIR } from './dataDir'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface Org {
  id: string
  name: string
  // null = no CLAUDE_CONFIG_DIR override, use the CLI's normal ~/.claude
  configDir: string | null
  // Default --model for sessions in this org; null/absent = app-wide default
  model?: string | null
  // GitHub owners (orgs/users) whose PRs belong to this org. An org with no
  // entries owns every owner not claimed by another org.
  githubOrgs?: string[]
  // The Claude plan behind this org — lets the usage dashboard show actual
  // subscription cost vs API-equivalent value extracted (ROI)
  plan?: { name?: string; monthlyUSD?: number }
}

export const DEFAULT_ORG_ID = 'default'

const DEFAULT_PERSIST_DIR = DATA_DIR
const DEFAULT_PERSIST_FILE = join(DEFAULT_PERSIST_DIR, 'orgs.json')

export class OrgRegistry {
  private orgs = new Map<string, Org>()
  private persistDir: string
  private persistFile: string

  // persistFile defaults to the real on-disk location; tests must pass an
  // isolated path so they never touch the user's actual session state.
  constructor(persistFile: string = DEFAULT_PERSIST_FILE) {
    this.persistFile = persistFile
    this.persistDir = join(persistFile, '..')
    this.load()
  }

  // Re-read on every access: the custom server and Next's API routes hold
  // separate module copies, so an edit made through the API must reach both.
  private load() {
    try {
      const saved: Org[] = JSON.parse(readFileSync(this.persistFile, 'utf-8'))
      this.orgs = new Map(saved.map(org => [org.id, org]))
    } catch {}
    if (!this.orgs.has(DEFAULT_ORG_ID)) {
      this.orgs.set(DEFAULT_ORG_ID, { id: DEFAULT_ORG_ID, name: 'Default', configDir: null })
      this.persist()
    }
  }

  list(): Org[] {
    this.load()
    return Array.from(this.orgs.values())
  }

  // Every org's `<configDir>/projects` root, deduped (two orgs pointing at the
  // same dir — e.g. a misconfigured entry — must not double-list sessions).
  projectRoots(): { orgId: string; root: string }[] {
    const seen = new Set<string>()
    const roots: { orgId: string; root: string }[] = []
    for (const org of this.list()) {
      const root = join(org.configDir ?? join(process.env.HOME!, '.claude'), 'projects')
      if (seen.has(root)) continue
      seen.add(root)
      roots.push({ orgId: org.id, root })
    }
    return roots
  }

  get(id: string): Org | undefined {
    this.load()
    return this.orgs.get(id)
  }

  add(name: string, configDir: string, model?: string | null): Org {
    this.load()
    const org: Org = { id: randomUUID(), name, configDir, model: model ?? null }
    this.orgs.set(org.id, org)
    this.persist()
    return org
  }

  update(id: string, patch: Partial<Pick<Org, 'name' | 'configDir' | 'model' | 'githubOrgs'>>): Org | undefined {
    const org = this.get(id)
    if (!org) return undefined
    const next = { ...org, ...patch, id }
    if (id === DEFAULT_ORG_ID) next.configDir = org.configDir // Default keeps the CLI's own folder
    this.orgs.set(id, next)
    this.persist()
    return next
  }

  // Sessions and meetings of a removed org keep their orgId; the UI shows them under All.
  remove(id: string): boolean {
    if (id === DEFAULT_ORG_ID || !this.get(id)) return false
    this.orgs.delete(id)
    this.persist()
    return true
  }

  private persist() {
    try {
      if (!existsSync(this.persistDir)) mkdirSync(this.persistDir, { recursive: true })
      writeFileSync(this.persistFile, JSON.stringify(Array.from(this.orgs.values())))
    } catch {}
  }
}

declare global { var __orgRegistry: OrgRegistry | undefined }
export const orgRegistry: OrgRegistry =
  global.__orgRegistry ?? (global.__orgRegistry = new OrgRegistry())
