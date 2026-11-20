jest.mock('child_process', () => ({ execFile: jest.fn() }))

import { execFile } from 'child_process'
import { isValidPrUrl, summarizeChecks, fetchPrStatus, fetchAllPrStatuses, prStatusCache } from '../ghPrStatus'

const mockExecFile = execFile as unknown as jest.Mock

function mockGhResponse(json: object) {
  mockExecFile.mockImplementation((_cmd, _args, optsOrCb, maybeCb) => {
    const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb
    cb(null, { stdout: JSON.stringify(json), stderr: '' })
  })
}

function mockGhFailure() {
  mockExecFile.mockImplementation((_cmd, _args, optsOrCb, maybeCb) => {
    const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb
    cb(new Error('gh: not found'), { stdout: '', stderr: 'error' })
  })
}

describe('isValidPrUrl', () => {
  it('accepts a well-formed PR URL', () => {
    expect(isValidPrUrl('https://github.com/acme/widgets/pull/42')).toBe(true)
  })

  it.each([
    ['-x'],
    ['--repo=evil'],
    ['https://github.com/acme/widgets/pull/42 && rm -rf /'],
    ['not a url'],
    [''],
    ['https://gitlab.com/acme/widgets/pull/42'],
  ])('rejects %p', (input) => {
    expect(isValidPrUrl(input)).toBe(false)
  })
})

describe('summarizeChecks', () => {
  it('returns none for an empty list', () => {
    expect(summarizeChecks([])).toBe('none')
  })

  it('returns failing when any CheckRun conclusion failed', () => {
    expect(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }]))
      .toBe('failing')
  })

  it('returns failing when a legacy StatusContext state failed', () => {
    expect(summarizeChecks([{ state: 'FAILURE' }])).toBe('failing')
  })

  it('returns pending when a check is still in progress', () => {
    expect(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: null }]))
      .toBe('pending')
  })

  it('returns passing when everything succeeded', () => {
    expect(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }])).toBe('passing')
  })
})

describe('fetchPrStatus', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    prStatusCache.clear()
  })

  it('returns null without calling gh for an invalid URL', async () => {
    const result = await fetchPrStatus('--repo=evil')
    expect(result).toBeNull()
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('parses a successful gh response and caches it', async () => {
    mockGhResponse({
      number: 42, title: 'Fix thing', state: 'OPEN', reviewDecision: 'APPROVED',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    })
    const status = await fetchPrStatus('https://github.com/acme/widgets/pull/42')
    expect(status).toMatchObject({ number: 42, title: 'Fix thing', state: 'OPEN', reviewDecision: 'APPROVED', checks: 'passing' })
    expect(prStatusCache.get('https://github.com/acme/widgets/pull/42')).toEqual(status)
  })

  it('returns null when gh fails', async () => {
    mockGhFailure()
    const status = await fetchPrStatus('https://github.com/acme/widgets/pull/42')
    expect(status).toBeNull()
  })
})

describe('fetchAllPrStatuses', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    prStatusCache.clear()
  })

  it('fetches distinct URLs and skips failures without throwing', async () => {
    let call = 0
    mockExecFile.mockImplementation((_cmd, args, optsOrCb, maybeCb) => {
      const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb
      call++
      if (args[2].includes('/1')) {
        cb(new Error('boom'), { stdout: '', stderr: '' })
      } else {
        cb(null, { stdout: JSON.stringify({ number: 2, title: 'ok', state: 'OPEN', reviewDecision: null, statusCheckRollup: [] }), stderr: '' })
      }
    })

    const urls = [
      'https://github.com/acme/widgets/pull/1',
      'https://github.com/acme/widgets/pull/2',
      'https://github.com/acme/widgets/pull/2', // duplicate, should be deduped
    ]
    const result = await fetchAllPrStatuses(urls)
    expect(result.has('https://github.com/acme/widgets/pull/1')).toBe(false)
    expect(result.get('https://github.com/acme/widgets/pull/2')?.number).toBe(2)
    expect(call).toBe(2) // deduped — only 2 distinct URLs actually fetched
  })
})
