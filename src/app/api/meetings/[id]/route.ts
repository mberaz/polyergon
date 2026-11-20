export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { meetingStore } from '@/lib/meetingStore'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const meeting = meetingStore.get(params.id)
  if (!meeting) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    meeting,
    transcript: meetingStore.readTranscript(params.id),
    notes: meetingStore.readNotes(params.id),
    summary: meetingStore.readSummary(params.id),
    context: meetingStore.readContext(params.id),
  })
}
