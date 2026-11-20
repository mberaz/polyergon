// Creates the two virtual audio devices the meeting recorder needs:
//  - "Claude Recorder"  (aggregate: BlackHole + default mic)  -> ffmpeg records this
//  - "Claude Playback"  (multi-output: speakers + BlackHole)  -> select as sound
//    output during meetings so Zoom's audio flows into BlackHole while you hear it
// Run: swift scripts/setup-audio-devices.swift
// Idempotent: skips devices that already exist.

import CoreAudio
import Foundation

func getDevices() -> [AudioDeviceID] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    var devices = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices)
    return devices
}

func getString(_ device: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<CFString?>.size)
    var value: CFString? = nil
    let status = withUnsafeMutablePointer(to: &value) { ptr in
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, ptr)
    }
    guard status == noErr, let s = value else { return nil }
    return s as String
}

func hasStreams(_ device: AudioDeviceID, scope: AudioObjectPropertyScope) -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreams,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size)
    return size > 0
}

func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioDeviceID? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var device: AudioDeviceID = 0
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    return status == noErr ? device : nil
}

let devices = getDevices()
let names = devices.compactMap { d -> (AudioDeviceID, String, String)? in
    guard let name = getString(d, kAudioObjectPropertyName),
          let uid = getString(d, kAudioDevicePropertyDeviceUID) else { return nil }
    return (d, name, uid)
}

guard let blackhole = names.first(where: { $0.1.contains("BlackHole") }) else {
    print("ERROR: BlackHole device not found. Install it first (brew install --cask blackhole-2ch) and restart coreaudiod or reboot.")
    exit(1)
}

let existing = Set(names.map { $0.1 })

// --- Claude Recorder: aggregate of BlackHole + default input (mic) ---
if existing.contains("Claude Recorder") {
    print("Claude Recorder already exists — skipping")
} else {
    guard let micId = defaultDevice(kAudioHardwarePropertyDefaultInputDevice),
          let micUid = getString(micId, kAudioDevicePropertyDeviceUID),
          hasStreams(micId, scope: kAudioDevicePropertyScopeInput) else {
        print("ERROR: no default input (mic) device found")
        exit(1)
    }
    let desc: [String: Any] = [
        kAudioAggregateDeviceNameKey as String: "Claude Recorder",
        kAudioAggregateDeviceUIDKey as String: "com.claude-session-manager.recorder",
        kAudioAggregateDeviceSubDeviceListKey as String: [
            [kAudioSubDeviceUIDKey as String: blackhole.2],
            [kAudioSubDeviceUIDKey as String: micUid],
        ],
        kAudioAggregateDeviceMainSubDeviceKey as String: blackhole.2,
    ]
    var aggId: AudioDeviceID = 0
    let status = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggId)
    if status == noErr {
        print("Created 'Claude Recorder' (BlackHole + mic \(micUid))")
    } else {
        print("ERROR creating Claude Recorder: OSStatus \(status)")
        exit(1)
    }
}

// --- Claude Playback: stacked multi-output of default output + BlackHole ---
if existing.contains("Claude Playback") {
    print("Claude Playback already exists — skipping")
} else {
    guard let outId = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice),
          var outUid = getString(outId, kAudioDevicePropertyDeviceUID) else {
        print("ERROR: no default output device found")
        exit(1)
    }
    // If the current default output is already a virtual device, fall back to
    // the built-in speakers so we don't nest aggregates
    if outUid.contains("BlackHole") || outUid.contains("claude-session-manager") {
        if let builtin = names.first(where: { $0.2.contains("BuiltInSpeaker") }) { outUid = builtin.2 }
    }
    let desc: [String: Any] = [
        kAudioAggregateDeviceNameKey as String: "Claude Playback",
        kAudioAggregateDeviceUIDKey as String: "com.claude-session-manager.playback",
        kAudioAggregateDeviceIsStackedKey as String: 1,
        kAudioAggregateDeviceSubDeviceListKey as String: [
            [kAudioSubDeviceUIDKey as String: outUid],
            [kAudioSubDeviceUIDKey as String: blackhole.2],
        ],
        kAudioAggregateDeviceMainSubDeviceKey as String: outUid,
    ]
    var aggId: AudioDeviceID = 0
    let status = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggId)
    if status == noErr {
        print("Created 'Claude Playback' (\(outUid) + BlackHole)")
    } else {
        print("ERROR creating Claude Playback: OSStatus \(status)")
        exit(1)
    }
}

print("\nDone. During meetings: System Settings > Sound > Output = 'Claude Playback'")
