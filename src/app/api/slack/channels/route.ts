export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { listSlackChannels } from '@/lib/slackBridge'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await listSlackChannels(req.nextUrl.searchParams.get('refresh') === '1'))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
