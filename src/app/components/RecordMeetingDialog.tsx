'use client'
import { useEffect, useState } from 'react'
import { listMics, chosenMic, chooseMic } from '@/lib/browserRecorder'
import type { Org } from '@/lib/orgRegistry'

interface Props {
  orgs: Org[]
  defaultOrgId: string
  onStart: (title: string, orgId: string) => void
  onCancel: () => void
  onMicTest: () => Promise<{ level?: number; error?: string; devices?: { mic: string; system: string | null } }>
}

export function RecordMeetingDialog({ orgs, defaultOrgId, onStart, onCancel, onMicTest }: Props) {
  const [title, setTitle] = useState('')
  const [orgId, setOrgId] = useState(defaultOrgId)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ level?: number; error?: string; devices?: { mic: string; system: string | null } } | null>(null)

  const [mics, setMics] = useState<{ id: string; label: string }[]>([])
  const [mic, setMic] = useState('')
  useEffect(() => { setMic(chosenMic()); listMics().then(setMics).catch(() => {}) }, [])

  async function runMicTest() {
    setTesting(true)
    setTestResult(null)
    setTestResult(await onMicTest())
    setTesting(false)
  }

  // Rough mapping of RMS to a 0-10 bar count; speech on a healthy device
  // typically lands around 0.02-0.15 RMS
  const bars = testResult?.level !== undefined ? Math.min(10, Math.round(testResult.level * 100)) : 0

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-[440px] shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Record Meeting
        </h2>
        <p className="text-xs text-gray-500 mb-4">Records in this window: your microphone, plus the other side of the call if BlackHole is installed. Keep Polyergon open while it records.</p>

        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onStart(title.trim(), orgId) }}
          placeholder="Meeting title (optional)"
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-red-500 placeholder-gray-600 mb-3"
          autoFocus
        />

        <label className="text-xs text-gray-500 mb-1 block">Org</label>
        <select
          value={orgId}
          onChange={e => setOrgId(e.target.value)}
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-red-500 mb-4"
        >
          {orgs.map(org => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>

        {mics.length > 0 && <>
          <label className="text-xs text-gray-500 mb-1 block">Microphone</label>
          <select value={mic} onChange={e => { setMic(e.target.value); chooseMic(e.target.value); setTestResult(null) }}
            className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm outline-none border border-gray-700 focus:border-red-500 mb-4">
            <option value="">Mac default input</option>
            {mics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </>}

        {/* Mic check */}
        <div className="border border-gray-800 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={runMicTest}
              disabled={testing}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded px-3 py-1.5 text-xs font-medium"
            >{testing ? 'Listening… (2s)' : 'Test audio'}</button>
            <div className="flex items-end gap-0.5 h-5 flex-1 justify-end">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className={`w-1.5 rounded-sm ${i < bars ? (i < 7 ? 'bg-green-500' : 'bg-yellow-400') : 'bg-gray-800'}`}
                  style={{ height: `${6 + i * 1.5}px` }}
                />
              ))}
            </div>
          </div>
          {testResult?.error && <p className="text-xs text-red-400 mt-2">{testResult.error}</p>}
          {testResult?.devices && <p className="text-[11px] text-gray-500 mt-2">Recording from: {testResult.devices.mic}{testResult.devices.system ? ` + ${testResult.devices.system} (meeting audio)` : ''}</p>}
          {testResult?.devices && !testResult.devices.system && <p className="text-xs text-yellow-500 mt-1">BlackHole isn't installed, so only your microphone is recorded, not the other side of the call. Install it: brew install blackhole-2ch</p>}
          {testResult?.level !== undefined && testResult.level < 0.004 && (
            <p className="text-xs text-yellow-500 mt-2">Silence detected. Say something during the test, and check the microphone isn't muted.</p>
          )}
          {testResult?.level !== undefined && testResult.level >= 0.004 && (
            <p className="text-xs text-green-500 mt-2">Audio detected ✓</p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={() => onStart(title.trim(), orgId)}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Start recording
          </button>
        </div>
      </div>
    </div>
  )
}
