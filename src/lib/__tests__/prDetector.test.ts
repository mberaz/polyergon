import { extractPrUrl, STRICT_PR_URL_RE } from '../prDetector'

describe('extractPrUrl', () => {
  it('finds a single PR URL', () => {
    expect(extractPrUrl('created https://github.com/acme/widgets/pull/42 for you'))
      .toBe('https://github.com/acme/widgets/pull/42')
  })

  it('returns the last URL when multiple are present', () => {
    const text = 'https://github.com/acme/widgets/pull/1 ... later https://github.com/acme/widgets/pull/2'
    expect(extractPrUrl(text)).toBe('https://github.com/acme/widgets/pull/2')
  })

  it('returns null when no PR URL is present', () => {
    expect(extractPrUrl('just some regular output, no links here')).toBeNull()
  })

  it('ignores near-miss urls that are not pull requests', () => {
    expect(extractPrUrl('https://github.com/acme/widgets/issues/42')).toBeNull()
    expect(extractPrUrl('https://gitlab.com/acme/widgets/pull/42')).toBeNull()
  })
})

describe('STRICT_PR_URL_RE', () => {
  it('accepts a well-formed PR URL', () => {
    expect(STRICT_PR_URL_RE.test('https://github.com/acme/widgets/pull/42')).toBe(true)
  })

  it('rejects strings that look like shell flags', () => {
    expect(STRICT_PR_URL_RE.test('-x')).toBe(false)
    expect(STRICT_PR_URL_RE.test('--repo=evil')).toBe(false)
  })

  it('rejects a URL with trailing garbage', () => {
    expect(STRICT_PR_URL_RE.test('https://github.com/acme/widgets/pull/42 && rm -rf /')).toBe(false)
  })
})
