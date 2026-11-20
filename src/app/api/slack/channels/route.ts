export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { listSlackChannels, SlackError } from '@/lib/slackBridge'
import { orgParam } from '@/lib/orgParam'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await listSlackChannels(req.nextUrl.searchParams.get('refresh') === '1', orgParam(req)))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, problem: e instanceof SlackError ? e.problem : 'other' }, { status: 502 })
  }
}
