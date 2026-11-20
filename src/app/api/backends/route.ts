export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { availableBackends } from '@/lib/backends'

// Backends whose CLI binary is actually installed — the New Session dialog only
// offers these, so a missing binary can't produce a failed spawn.
export async function GET() {
  return NextResponse.json({ backends: availableBackends() })
}
