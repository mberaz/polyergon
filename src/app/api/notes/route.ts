export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { notesStore, type Note } from '@/lib/notesStore'

// All notes (newest first, client-controlled order).
export async function GET() {
  return NextResponse.json({ notes: notesStore.all() })
}

// Replace the whole list: { notes }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { notes?: Note[] } | null
  if (body?.notes) notesStore.replace(body.notes)
  return NextResponse.json({ notes: notesStore.all() })
}

// One-time migration of the client's localStorage notes: { notes } — merged,
// only adding ids the server doesn't already have.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as { notes?: Note[] } | null
  if (body?.notes) notesStore.merge(body.notes)
  return NextResponse.json({ notes: notesStore.all() })
}
