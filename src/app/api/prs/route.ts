export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { buildPrSessionEntries, sortPrEntries } from '@/lib/prSessionEntries'

// Cheap: URL discovery only (cache-aware, no new `gh` calls). Status shown
// here is whatever the last manual refresh already fetched.
export async function GET() {
  const entries = await buildPrSessionEntries()
  return NextResponse.json(sortPrEntries(entries))
}
