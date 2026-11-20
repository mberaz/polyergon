import { saveClaudeAuth, getClaudeAuthStatus, claudeAuthEnv } from '../claudeAuth'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

test('login by default; api key mode sets env, 0600, hint only; login keeps the key for later', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-')), file = join(dir, 'config.json')
  try {
    expect(getClaudeAuthStatus(file)).toEqual({ mode: 'login', keyHint: null })
    expect(claudeAuthEnv(file)).toEqual({})
    expect(() => saveClaudeAuth({ mode: 'apiKey', apiKey: 'nope' }, file)).toThrow('sk-ant-')
    expect(saveClaudeAuth({ mode: 'apiKey', apiKey: 'sk-ant-abc1234' }, file)).toEqual({ mode: 'apiKey', keyHint: '…1234' })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(claudeAuthEnv(file)).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-abc1234' })
    saveClaudeAuth({ mode: 'login' }, file)
    expect(claudeAuthEnv(file)).toEqual({})
    expect(saveClaudeAuth({ mode: 'apiKey' }, file).mode).toBe('apiKey') // blank keeps the saved key
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
