import { detectStatus } from '../statusDetector'

describe('detectStatus', () => {
  it('returns waiting when output ends with claude prompt', () => {
    expect(detectStatus('\r\n> ')).toBe('waiting')
    expect(detectStatus('some output\n> ')).toBe('waiting')
  })

  it('returns waiting for y/n prompts', () => {
    expect(detectStatus('Continue? (y/n) ')).toBe('waiting')
  })

  it('returns thinking for active output', () => {
    expect(detectStatus('Working on the file...')).toBe('thinking')
  })

  it('returns thinking for empty chunk', () => {
    expect(detectStatus('')).toBe('thinking')
  })

  it('strips ANSI codes before matching', () => {
    expect(detectStatus('\x1b[32m>\x1b[0m ')).toBe('waiting')
    expect(detectStatus('\x1b[2K\x1b[1GWorking...')).toBe('thinking')
  })

  it('returns thinking when the spinner is present even if ❯ is also visible', () => {
    // The ❯ prompt is permanent UI chrome rendered below the status line
    // regardless of state — the spinner glyph is what actually distinguishes
    // active work from a genuine idle prompt.
    expect(detectStatus('✻ Vibing… (3s · thinking)\n\n\n❯ ')).toBe('thinking')
    expect(detectStatus('✢ Hashing…                    esc to interrupt · ← for agents\n\n\n❯ ')).toBe('thinking')
  })

  it('returns waiting when the idle footer wraps and "·" lands at column 0', () => {
    // "·" is a real spinner frame, but it's also the separator in the idle
    // hint line — if that line wraps, "·" can start a line and must not be
    // mistaken for the spinner.
    expect(detectStatus('❯ \n⏵⏵ bypass permissions on (shift+tab to cycle)\n· ← for agents')).toBe('waiting')
  })
})

describe('copilot backend (footer-based; ❯ is always on screen)', () => {
  const idle = '──────\n❯\n──────\n ← open sidebar · Interactive · Allow All · / commands · ? help    Claude Haiku 4.5'
  const busy = '──────\n❯\n──────\n ◎ Working esc edit prompt                                        Claude Haiku 4.5'
  test('idle footer → waiting even though ❯ is present', () => {
    expect(detectStatus(idle, 'copilot')).toBe('waiting')
  })
  test('"Working" footer → thinking', () => {
    expect(detectStatus(busy, 'copilot')).toBe('thinking')
  })
  test('claude logic unchanged when backend omitted', () => {
    expect(detectStatus(idle)).toBe('waiting')
  })
})
