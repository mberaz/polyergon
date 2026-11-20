import { CONFIG_FILE, readConfig, writeConfig } from './configFile'

// How Claude sessions authenticate: the CLI's own login (subscription / SSO),
// or an Anthropic API key passed as ANTHROPIC_API_KEY.
export interface ClaudeAuthStatus {
  mode: 'login' | 'apiKey'
  keyHint: string | null // last 4 chars only; the key never reaches the browser
}

export type ClaudeAuthInput = { mode: 'login' } | { mode: 'apiKey'; apiKey?: string }

export function getClaudeAuthStatus(file = CONFIG_FILE): ClaudeAuthStatus {
  const cfg = readConfig(file)
  const key = typeof cfg.anthropicApiKey === 'string' ? cfg.anthropicApiKey : ''
  return cfg.claudeAuth === 'apiKey' && key ? { mode: 'apiKey', keyHint: '…' + key.slice(-4) } : { mode: 'login', keyHint: key ? '…' + key.slice(-4) : null }
}

// Blank apiKey keeps the saved key. Switching to login keeps the key on disk
// so switching back doesn't need it again.
export function saveClaudeAuth(input: ClaudeAuthInput, file = CONFIG_FILE): ClaudeAuthStatus {
  const cfg = readConfig(file)
  if (input.mode === 'login') {
    cfg.claudeAuth = 'login'
  } else if (input.mode === 'apiKey') {
    const key = (typeof input.apiKey === 'string' ? input.apiKey.trim() : '') || (typeof cfg.anthropicApiKey === 'string' ? cfg.anthropicApiKey : '')
    if (!key) throw new Error('API key is required')
    if (!key.startsWith('sk-ant-')) throw new Error('That does not look like an Anthropic API key (it should start with sk-ant-)')
    Object.assign(cfg, { claudeAuth: 'apiKey', anthropicApiKey: key })
  } else {
    throw new Error('Unknown mode')
  }
  writeConfig(cfg, file)
  return getClaudeAuthStatus(file)
}

// Env for a Claude spawn. Login mode adds nothing (the CLI uses its own login).
export function claudeAuthEnv(file = CONFIG_FILE): Record<string, string> {
  const cfg = readConfig(file)
  return cfg.claudeAuth === 'apiKey' && typeof cfg.anthropicApiKey === 'string' && cfg.anthropicApiKey
    ? { ANTHROPIC_API_KEY: cfg.anthropicApiKey }
    : {}
}
