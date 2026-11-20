export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { getInbox } from '@/lib/ghInbox'

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('refresh') === '1'
  return NextResponse.json(await getInbox(force))
}
