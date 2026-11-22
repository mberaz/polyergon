export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { meetingStore, MeetingStore } from '@/lib/meetingStore'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  return new MeetingStore().trash(params.id)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Not found, or still recording' }, { status: 409 })
}
