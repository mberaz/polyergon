export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { getClaudeAuthStatus, saveClaudeAuth, claudeLoginStatus, type ClaudeAuthInput } from '@/lib/claudeAuth'
import { orgConfigDir } from '@/lib/orgParam'

export async function GET(req: NextRequest) {
  return NextResponse.json({ ...getClaudeAuthStatus(), login: await claudeLoginStatus(orgConfigDir(req)) })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as ClaudeAuthInput | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'bad body' }, { status: 400 })
  try {
    return NextResponse.json(saveClaudeAuth(body))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
