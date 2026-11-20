export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { MeetingStore } from '@/lib/meetingStore'

// Fresh instance (MeetingStore only reads disk): the global singleton is created by
// server.ts at boot and would keep serving the old code after a hot reload.
export async function GET(req: NextRequest) {
  return NextResponse.json(new MeetingStore().library(req.nextUrl.searchParams.get('q') ?? ''))
}
