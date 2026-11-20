import { PrUrlCache } from '../prScanCache'
import * as prDetector from '../prDetector'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('PrUrlCache', () => {
  let tmpDir: string
  let projectsDir: string
  let cacheFile: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pr-scan-cache-test-'))
    projectsDir = join(tmpDir, 'projects')
    cacheFile = join(tmpDir, 'cache', 'pr-url-cache.json')
    mkdirSync(join(projectsDir, 'proj-a'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  it('detects a PR URL in a session file', async () => {
    writeFileSync(
      join(projectsDir, 'proj-a', 'sess-1.jsonl'),
      'some output ... https://github.com/acme/widgets/pull/7 ... more'
    )
    const cache = new PrUrlCache(cacheFile, projectsDir)
    const result = await cache.scan()
    expect(result.get('sess-1')).toBe('https://github.com/acme/widgets/pull/7')
  })

  it('returns no entry for a session with no PR URL', async () => {
    writeFileSync(join(projectsDir, 'proj-a', 'sess-2.jsonl'), 'no links here')
    const cache = new PrUrlCache(cacheFile, projectsDir)
    const result = await cache.scan()
    expect(result.has('sess-2')).toBe(false)
  })

  it('does not re-scan an unchanged file on a second scan', async () => {
    writeFileSync(join(projectsDir, 'proj-a', 'sess-3.jsonl'), 'https://github.com/acme/widgets/pull/9')
    const cache = new PrUrlCache(cacheFile, projectsDir)
    await cache.scan()

    const spy = jest.spyOn(prDetector, 'extractPrUrl')
    const result = await cache.scan()
    expect(result.get('sess-3')).toBe('https://github.com/acme/widgets/pull/9')
    // extractPrUrl is only called on a fresh read — an unchanged file must not trigger one.
    expect(spy).not.toHaveBeenCalled()
  })

  it('re-scans a file whose content and mtime changed', async () => {
    const filePath = join(projectsDir, 'proj-a', 'sess-4.jsonl')
    writeFileSync(filePath, 'https://github.com/acme/widgets/pull/1')
    const cache = new PrUrlCache(cacheFile, projectsDir)
    await cache.scan()

    // Bump mtime forward so the cache sees a real change regardless of fs mtime resolution.
    const future = new Date(Date.now() + 60_000)
    writeFileSync(filePath, 'https://github.com/acme/widgets/pull/2')
    utimesSync(filePath, future, future)

    const result = await cache.scan()
    expect(result.get('sess-4')).toBe('https://github.com/acme/widgets/pull/2')
  })

  it('persists cache across instances', async () => {
    writeFileSync(join(projectsDir, 'proj-a', 'sess-5.jsonl'), 'https://github.com/acme/widgets/pull/3')
    await new PrUrlCache(cacheFile, projectsDir).scan()

    const spy = jest.spyOn(prDetector, 'extractPrUrl')
    const second = new PrUrlCache(cacheFile, projectsDir)
    const result = await second.scan()
    expect(result.get('sess-5')).toBe('https://github.com/acme/widgets/pull/3')
    expect(spy).not.toHaveBeenCalled()
  })
})
