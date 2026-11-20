import { MeetingStore } from '../meetingStore'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('MeetingStore', () => {
  let tmpDir: string
  let store: MeetingStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'meeting-store-test-'))
    store = new MeetingStore(tmpDir)
  })

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  test('create + get round-trips', () => {
    const m = store.create('Standup', 'default')
    expect(store.get(m.id)).toEqual(m)
    expect(m.status).toBe('recording')
  })

  test('create falls back to a generated title', () => {
    const m = store.create('', 'default')
    expect(m.title).toMatch(/^Meeting /)
  })

  test('update patches and persists', () => {
    const m = store.create('Standup', 'default')
    store.update(m.id, { status: 'ended', endedAt: 123 })
    expect(store.get(m.id)).toMatchObject({ status: 'ended', endedAt: 123 })
  })

  test('list sorts newest first', () => {
    const a = store.create('A', 'default')
    store.update(a.id, { startedAt: 1000 })
    const b = store.create('B', 'default')
    store.update(b.id, { startedAt: 2000 })
    expect(store.list().map(m => m.title)).toEqual(['B', 'A'])
  })

  test('transcript appends and reads in order', () => {
    const m = store.create('T', 'default')
    store.appendTranscript(m.id, { t: 1, text: 'hello' })
    store.appendTranscript(m.id, { t: 2, text: 'world' })
    expect(store.readTranscript(m.id)).toEqual([
      { t: 1, text: 'hello' },
      { t: 2, text: 'world' },
    ])
  })

  test('reads empty transcript for missing file', () => {
    const m = store.create('T', 'default')
    expect(store.readTranscript(m.id)).toEqual([])
  })

  test('notes and summary round-trip', () => {
    const m = store.create('N', 'default')
    const notes = { topics: ['t1'], decisions: ['d1'], actionItems: [] }
    store.saveNotes(m.id, notes)
    store.saveSummary(m.id, '## Summary\nhi')
    expect(store.readNotes(m.id)).toEqual(notes)
    expect(store.readSummary(m.id)).toBe('## Summary\nhi')
  })

  test('markInterrupted flips recording meetings only', () => {
    const rec = store.create('rec', 'default')
    const done = store.create('done', 'default')
    store.update(done.id, { status: 'ended', endedAt: 5 })
    store.markInterrupted()
    expect(store.get(rec.id)!.status).toBe('interrupted')
    expect(store.get(rec.id)!.endedAt).not.toBeNull()
    expect(store.get(done.id)!.status).toBe('ended')
  })

  test('library searches title, summary and transcript, all words required', () => {
    const a = store.create('Nestle sync', 'default')
    store.saveSummary(a.id, '## Summary\nWe covered **SharePoint** scanning.')
    store.saveNotes(a.id, { topics: ['t'], decisions: ['d1', 'd2'], actionItems: [] })
    const b = store.create('Standup', 'default')
    store.appendTranscript(b.id, { t: 1, text: 'the Kafka lag is back' })

    expect(store.library().map(e => e.title).sort()).toEqual(['Nestle sync', 'Standup'])
    const [hit] = store.library('sharepoint')
    expect(hit).toMatchObject({ title: 'Nestle sync', snippet: 'We covered SharePoint scanning.', counts: { topics: 1, decisions: 2, actionItems: 0 } })
    expect(store.library('kafka lag')[0].match).toContain('Kafka lag')
    expect(store.library('kafka sharepoint')).toEqual([])
  })
})

