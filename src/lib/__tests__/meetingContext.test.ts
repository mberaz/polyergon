import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The resolver reads the global stores, so point them at a throwaway data dir first.
const dataDir = mkdtempSync(join(tmpdir(), 'mctx-'))
process.env.POLYERGON_DATA_DIR = dataDir
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveContext, MAX_CONTEXT_CHARS } = require('../meetingContext')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { meetingStore } = require('../meetingStore')

afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

test('text is passed through and clipped; links are fetched by the assistant', async () => {
  const t = await resolveContext('text', 'Agenda: pricing\nmore')
  expect(t).toEqual({ label: 'Agenda: pricing', body: 'Agenda: pricing\nmore', fetch: false })
  const long = await resolveContext('text', 'x'.repeat(MAX_CONTEXT_CHARS + 10))
  expect(long.body.length).toBe(MAX_CONTEXT_CHARS + 1)
  expect(await resolveContext('link', ' https://example.com ')).toEqual({ label: 'https://example.com', body: 'https://example.com', fetch: true })
  const slack = await resolveContext('slack', 'eng-oncall')
  expect(slack).toMatchObject({ label: 'Slack: #eng-oncall', fetch: true })
  expect(slack.body).toContain('Slack channel #eng-oncall')
})

test('past meeting uses its summary, falling back to the transcript', async () => {
  const a = meetingStore.create('Pricing sync', 'default')
  meetingStore.saveSummary(a.id, '## Summary\nWe agreed on tiers.')
  const ra = await resolveContext('meeting', a.id)
  expect(ra.label).toBe('Meeting: Pricing sync')
  expect(ra.body).toContain('We agreed on tiers.')

  const b = meetingStore.create('Raw', 'default')
  meetingStore.appendTranscript(b.id, { t: 1, text: 'hello there' })
  expect((await resolveContext('meeting', b.id)).body).toContain('hello there')
})

test('rejects empty input and unknown ids', async () => {
  await expect(resolveContext('text', '  ')).rejects.toThrow('Nothing to add')
  await expect(resolveContext('meeting', 'nope')).rejects.toThrow('Meeting not found')
  await expect(resolveContext('session', 'nope')).rejects.toThrow('Session not found')
})
