import { LiveSessionStore, SessionStatus } from '../liveSessionStore'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('LiveSessionStore', () => {
  let store: LiveSessionStore
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'live-session-store-test-'))
    store = new LiveSessionStore(join(tmpDir, 'live-sessions.json'))
  })

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('adds a session and retrieves it', () => {
    store.add({ id: 'abc', cwd: '/tmp', gitRoot: null, claudeSessionId: null, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId: 'default' })
    expect(store.get('abc')?.cwd).toBe('/tmp')
  })

  it('lists all session ids', () => {
    store.add({ id: 'a', cwd: '/a', gitRoot: null, claudeSessionId: null, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId: 'default' })
    store.add({ id: 'b', cwd: '/b', gitRoot: null, claudeSessionId: null, status: 'waiting' as SessionStatus, createdAt: Date.now(), prUrl: null, orgId: 'default' })
    expect(store.list().map(s => s.id)).toEqual(['a', 'b'])
  })

  it('updates session status', () => {
    store.add({ id: 'x', cwd: '/x', gitRoot: null, claudeSessionId: null, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId: 'default' })
    store.setStatus('x', 'waiting')
    expect(store.get('x')?.status).toBe('waiting')
  })

  it('stores claudeSessionId when detected', () => {
    store.add({ id: 'x', cwd: '/x', gitRoot: null, claudeSessionId: null, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId: 'default' })
    store.setClaudeSessionId('x', 'claude-abc-123')
    expect(store.get('x')?.claudeSessionId).toBe('claude-abc-123')
  })

  it('stores prUrl when detected', () => {
    store.add({ id: 'x', cwd: '/x', gitRoot: null, claudeSessionId: null, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId: 'default' })
    store.setPrUrl('x', 'https://github.com/acme/widgets/pull/42')
    expect(store.get('x')?.prUrl).toBe('https://github.com/acme/widgets/pull/42')
  })

  it('removes a session', () => {
    store.add({ id: 'x', cwd: '/x', gitRoot: null, claudeSessionId: null, status: 'thinking', createdAt: Date.now(), prUrl: null, orgId: 'default' })
    store.remove('x')
    expect(store.get('x')).toBeUndefined()
  })
})
