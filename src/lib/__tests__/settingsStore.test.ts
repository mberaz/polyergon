import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getSettings, updateSettings, DEFAULT_SETTINGS } from '../settingsStore'

describe('settingsStore', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'settings-')), 'settings.json')

  it('returns defaults when no file', () => {
    expect(getSettings(file())).toEqual(DEFAULT_SETTINGS)
  })

  it('persists and clamps the window to 100k–1M', () => {
    const f = file()
    expect(updateSettings({ autoCompact: { enabled: false, windowTokens: 5_000 } }, f).autoCompact).toEqual({ enabled: false, windowTokens: 100_000 })
    expect(updateSettings({ autoCompact: { enabled: true, windowTokens: 9_000_000 } }, f).autoCompact.windowTokens).toBe(1_000_000)
    expect(getSettings(f).autoCompact).toEqual({ enabled: true, windowTokens: 1_000_000 })
  })

  it('toggles notifications without touching auto-compact', () => {
    const f = file()
    updateSettings({ autoCompact: { enabled: true, windowTokens: 250_000 } }, f)
    const s = updateSettings({ notifications: { enabled: false } }, f)
    expect(s).toEqual({ autoCompact: { enabled: true, windowTokens: 250_000 }, notifications: { enabled: false }, sessions: { skipPermissions: false } })
  })

  test('permission prompts stay on unless explicitly skipped', () => {
    const f = file()
    expect(getSettings(f).sessions.skipPermissions).toBe(false)
    updateSettings({ sessions: { skipPermissions: true } }, f)
    expect(getSettings(f).sessions.skipPermissions).toBe(true)
    updateSettings({ autoCompact: { enabled: false, windowTokens: 200_000 } }, f)
    expect(getSettings(f).sessions.skipPermissions).toBe(true)
  })
})

