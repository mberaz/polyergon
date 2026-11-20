import { OrgRegistry, DEFAULT_ORG_ID } from '../orgRegistry'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('OrgRegistry', () => {
  let tmpDir: string
  let persistFile: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'org-registry-test-'))
    persistFile = join(tmpDir, 'orgs.json')
  })

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('seeds a default org with no configDir override when the registry is empty', () => {
    const registry = new OrgRegistry(persistFile)
    expect(registry.list()).toEqual([{ id: DEFAULT_ORG_ID, name: 'Default', configDir: null }])
  })

  it('adds a new org and lists it alongside the default', () => {
    const registry = new OrgRegistry(persistFile)
    const org = registry.add('Claude Teams', '/Users/me/.claude-teams')
    expect(org.name).toBe('Claude Teams')
    expect(org.configDir).toBe('/Users/me/.claude-teams')
    expect(registry.list().map(o => o.id)).toEqual([DEFAULT_ORG_ID, org.id])
  })

  it('persists added orgs across instances', () => {
    const registry = new OrgRegistry(persistFile)
    const org = registry.add('Claude Teams', '/Users/me/.claude-teams')

    const reloaded = new OrgRegistry(persistFile)
    expect(reloaded.get(org.id)).toEqual(org)
    expect(reloaded.get(DEFAULT_ORG_ID)?.configDir).toBeNull()
  })

  it('does not duplicate the default org across reloads', () => {
    new OrgRegistry(persistFile)
    const reloaded = new OrgRegistry(persistFile)
    expect(reloaded.list().filter(o => o.id === DEFAULT_ORG_ID)).toHaveLength(1)
  })
})
