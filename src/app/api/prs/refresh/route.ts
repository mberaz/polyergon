export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { buildPrSessionEntries, sortPrEntries } from '@/lib/prSessionEntries'
import { fetchAllPrStatuses } from '@/lib/ghPrStatus'

// The only network-calling path — runs `gh pr view` for every currently
// known PR URL. Only triggered by an explicit button click (no background
// polling in this MVP).
export async function POST() {
  const entries = await buildPrSessionEntries()
  await fetchAllPrStatuses(entries.map(e => e.prUrl))
  const refreshed = await buildPrSessionEntries()
  return NextResponse.json(sortPrEntries(refreshed))
}
