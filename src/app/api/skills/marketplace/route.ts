export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { listMarketplacePlugins, installPlugin } from '@/lib/marketplace'

export async function GET() {
  return NextResponse.json({ plugins: listMarketplacePlugins() })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { name?: string; marketplace?: string } | null
  try {
    await installPlugin(String(body?.name ?? ''), String(body?.marketplace ?? ''))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
