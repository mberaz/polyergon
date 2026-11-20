import { wavRms, SILENCE_RMS_THRESHOLD } from '../audioCapture'

// Builds a minimal valid WAV (RIFF + fmt + data) around the given 16-bit samples
function makeWav(samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2))
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  const dataHeader = Buffer.alloc(8)
  dataHeader.write('data', 0, 'ascii')
  dataHeader.writeUInt32LE(data.length, 4)
  return Buffer.concat([header, fmt, dataHeader, data])
}

describe('wavRms', () => {
  test('silence is 0', () => {
    expect(wavRms(makeWav([0, 0, 0, 0]))).toBe(0)
  })

  test('full-scale square wave is ~1', () => {
    expect(wavRms(makeWav([32767, -32767, 32767, -32767]))).toBeCloseTo(1, 2)
  })

  test('quiet signal is below the silence threshold', () => {
    // ~0.003 of full scale
    const quiet = Array.from({ length: 100 }, (_, i) => (i % 2 ? 100 : -100))
    expect(wavRms(makeWav(quiet))).toBeLessThan(SILENCE_RMS_THRESHOLD)
  })

  test('speech-level signal is above the silence threshold', () => {
    // ~0.06 of full scale
    const speech = Array.from({ length: 100 }, (_, i) => (i % 2 ? 2000 : -2000))
    expect(wavRms(makeWav(speech))).toBeGreaterThan(SILENCE_RMS_THRESHOLD)
  })

  test('skips non-data chunks (e.g. LIST) to find the data chunk', () => {
    const wav = makeWav([32767, -32767])
    const list = Buffer.alloc(12)
    list.write('LIST', 0, 'ascii')
    list.writeUInt32LE(4, 4)
    list.write('INFO', 8, 'ascii')
    // Insert LIST between fmt and data: header(12) + fmt(24), rest after
    const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)])
    expect(wavRms(withList)).toBeCloseTo(1, 2)
  })

  test('malformed buffer returns 0 instead of throwing', () => {
    expect(wavRms(Buffer.from('not a wav file'))).toBe(0)
    expect(wavRms(Buffer.alloc(0))).toBe(0)
  })
})
