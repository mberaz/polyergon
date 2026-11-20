export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { listAllSessions } from '@/lib/sessionStore'

export async function GET() {
  return NextResponse.json(await listAllSessions())
}
