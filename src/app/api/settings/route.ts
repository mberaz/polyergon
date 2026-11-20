export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { getSettings, updateSettings, type Settings } from '@/lib/settingsStore'

export async function GET() {
  return NextResponse.json(getSettings())
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as Partial<Settings> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'bad body' }, { status: 400 })
  return NextResponse.json(updateSettings(body))
}
