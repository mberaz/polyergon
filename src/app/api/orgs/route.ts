export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { orgRegistry } from '@/lib/orgRegistry'

export async function GET() {
  return NextResponse.json(orgRegistry.list())
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, configDir, model } = body ?? {}

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof configDir !== 'string' || !configDir.startsWith('/')) {
    return NextResponse.json({ error: 'configDir must be an absolute path' }, { status: 400 })
  }
  if (model !== undefined && model !== null && typeof model !== 'string') {
    return NextResponse.json({ error: 'model must be a string' }, { status: 400 })
  }

  const org = orgRegistry.add(name.trim(), configDir, typeof model === 'string' && model.trim() ? model.trim() : null)
  return NextResponse.json(org)
}
