'use client'
import { useCallback } from 'react'

// Plays public/alert.mp3 when the user dropped one in (git-ignored, so a personal
// sound never ships); otherwise a short two-note chime made with Web Audio.
function chime(volume: number) {
  const ctx = new AudioContext()
  const gain = ctx.createGain()
  gain.connect(ctx.destination)
  gain.gain.value = volume * 0.3
  ;[880, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    osc.frequency.value = freq
    osc.connect(gain)
    osc.start(ctx.currentTime + i * 0.15)
    osc.stop(ctx.currentTime + i * 0.15 + 0.12)
  })
  setTimeout(() => ctx.close(), 600)
}

function play(volume: number) {
  try {
    const audio = new Audio('/alert.mp3')
    audio.volume = volume
    audio.play().catch(() => { try { chime(volume) } catch {} })
  } catch {}
}

export function useAudioAlerts(volume = 0.8) {
  const playNeedsInput = useCallback(() => play(volume), [volume])
  const playNeedsAttention = useCallback(() => play(volume), [volume])
  return { playNeedsInput, playNeedsAttention }
}
