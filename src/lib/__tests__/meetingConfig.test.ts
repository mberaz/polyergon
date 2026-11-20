import { saveTranscriptionConfig, getTranscriptionStatus, getTranscriptionConfig } from '../meetingConfig'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('transcription config', () => {
  let dir: string, file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcfg-')); file = join(dir, 'config.json') })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('saves azure at 0600, keeps other keys, never exposes the key', () => {
    writeFileSync(file, JSON.stringify({ micDevice: 'Mic' }), { mode: 0o644 })
    const st = saveTranscriptionConfig({ provider: 'azure', endpoint: 'https://x.openai.azure.com/', apiKey: 'secret-1234' }, file)
    expect(st).toEqual({ provider: 'azure', keyHint: '…1234', fromEnv: false, endpoint: 'https://x.openai.azure.com', deployment: 'gpt-4o-transcribe' })
    expect(JSON.stringify(st)).not.toContain('secret')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf-8')).micDevice).toBe('Mic')
  })

  test('blank key keeps the saved one; switching provider and none clear old keys', () => {
    saveTranscriptionConfig({ provider: 'azure', endpoint: 'https://x.example', apiKey: 'k-azure' }, file)
    saveTranscriptionConfig({ provider: 'azure', endpoint: 'https://y.example', apiKey: '' }, file)
    expect(getTranscriptionConfig(file)).toMatchObject({ kind: 'azure', apiKey: 'k-azure', endpoint: 'https://y.example' })
    saveTranscriptionConfig({ provider: 'openai', apiKey: 'sk-open' }, file)
    expect(JSON.parse(readFileSync(file, 'utf-8')).azureApiKey).toBeUndefined()
    saveTranscriptionConfig({ provider: 'none' }, file)
    expect(getTranscriptionStatus(file).provider).toBeNull()
  })

  test('rejects bad input', () => {
    expect(() => saveTranscriptionConfig({ provider: 'openai' }, file)).toThrow('API key is required')
    expect(() => saveTranscriptionConfig({ provider: 'azure', endpoint: 'http://x', apiKey: 'k' }, file)).toThrow('https')
    expect(() => saveTranscriptionConfig({ provider: 'azure', endpoint: 'nope', apiKey: 'k' }, file)).toThrow('URL')
  })
})
