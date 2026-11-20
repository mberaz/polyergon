export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { slackConfigured } from '@/lib/slackBridge'
import { orgRegistry } from '@/lib/orgRegistry'

// { configured } for ?org=; 'all' → true if any org has Slack
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('org')
  const configured = id === 'all' ? orgRegistry.list().some(o => slackConfigured(o.id)) : slackConfigured(orgRegistry.get(id ?? '') ? id! : undefined)
  return NextResponse.json({ configured })
}
