export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { checkForUpdate, upgradeInPlace } from '@/lib/updater'

export async function GET(req: NextRequest) {
  return NextResponse.json(await checkForUpdate(req.nextUrl.searchParams.get('refresh') === '1'))
}

export async function POST() {
  const r = await upgradeInPlace()
  return NextResponse.json(r, { status: 'error' in r ? 400 : 200 })
}
