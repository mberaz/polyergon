const authEnv = { value: {} as Record<string, string> }
jest.mock('../claudeAuth', () => ({ claudeAuthEnv: () => authEnv.value }))
jest.mock('../orgRegistry', () => ({ orgRegistry: { get: () => ({ configDir: '/nope' }) } }))
jest.mock('child_process', () => ({ execFile: (_c: string, _a: string[], _o: unknown, cb: (e: Error) => void) => cb(new Error('no keychain item')) }))

import { getModels } from '../modelCatalog'

describe('getModels (claude)', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('uses the API key in API-key mode', async () => {
    authEnv.value = { ANTHROPIC_API_KEY: 'sk-ant-test' }
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'claude-x', display_name: 'X' }] })))
    expect(await getModels('claude', 'o1', true)).toEqual([{ id: 'claude-x', displayName: 'X' }])
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test')
  })

  it('falls back to the CLI default when there is no login', async () => {
    authEnv.value = {}
    const models = await getModels('claude', 'o2', true)
    expect(models[0].id).toBe('default')
  })
})
