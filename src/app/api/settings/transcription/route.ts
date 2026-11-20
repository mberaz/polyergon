export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { getTranscriptionStatus, saveTranscriptionConfig, type TranscriptionInput } from '@/lib/meetingConfig'

export async function GET() {
  return NextResponse.json(getTranscriptionStatus())
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as TranscriptionInput | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'bad body' }, { status: 400 })
  try {
    return NextResponse.json(saveTranscriptionConfig(body))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
