export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { meetingStore } from '@/lib/meetingStore'

export async function GET() {
  return NextResponse.json(meetingStore.list())
}
