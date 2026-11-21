export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { downloadLocalModel, localWhisperStatus } from '@/lib/localWhisper'

export async function GET() {
  return NextResponse.json(await localWhisperStatus())
}

// Starts downloading the Whisper model; poll GET for progress.
export async function POST() {
  downloadLocalModel()
  return NextResponse.json(await localWhisperStatus())
}
