export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { getClaudeAuthStatus, saveClaudeAuth, type ClaudeAuthInput } from '@/lib/claudeAuth'

export async function GET() {
  return NextResponse.json(getClaudeAuthStatus())
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
