import { resolveDevices, parseAudioDevices } from '../audioCapture'

const air = ['BlackHole 2ch', 'iPhone Microphone', 'MacBook Air Microphone', 'Microsoft Teams Audio']

test("another Mac model: uses its own built-in mic, not 'MacBook Pro Microphone'", () => {
  expect(resolveDevices({}, air)).toEqual({ mic: 'MacBook Air Microphone', system: 'BlackHole 2ch' })
  expect(resolveDevices({ mic: 'MacBook Pro Microphone', system: 'BlackHole 2ch' }, air)).toEqual({ mic: 'MacBook Air Microphone', system: 'BlackHole 2ch' })
})

test('no BlackHole: mic only; a configured device that exists wins', () => {
  expect(resolveDevices({}, ['MacBook Pro Microphone'])).toEqual({ mic: 'MacBook Pro Microphone', system: null })
  expect(resolveDevices({ mic: 'Yeti' }, ['Yeti', 'MacBook Pro Microphone'])).toEqual({ mic: 'Yeti', system: null })
})

test('no inputs: a clear error', () => {
  expect(resolveDevices({}, [])).toEqual({ error: expect.stringContaining('No audio inputs') })
  expect(resolveDevices({}, ['BlackHole 2ch'])).toEqual({ error: expect.stringContaining('No microphone') })
})

test('newer ffmpeg lists devices with a uid tag; the name is used without it', () => {
  const listing = '[AVFoundation indev @ 0x1] [0] BlackHole 2ch [uid:BlackHole2ch_UID]\n[AVFoundation indev @ 0x1] [1] MacBook Pro Microphone [uid:BuiltInMicrophoneDevice]\n'
  expect(parseAudioDevices(listing)).toEqual(['BlackHole 2ch', 'MacBook Pro Microphone'])
  expect(parseAudioDevices('[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone\n')).toEqual(['MacBook Pro Microphone'])
})
