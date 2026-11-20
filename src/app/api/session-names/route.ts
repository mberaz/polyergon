export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { sessionNameStore } from '@/lib/sessionNameStore'

// All saved session names, keyed by session id.
export async function GET() {
  return NextResponse.json({ names: sessionNameStore.all() })
}

// Set one name: { key, name }. Deleting: name === '' removes it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { key?: string; name?: string } | null
  if (!body?.key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  if (body.name && body.name.trim()) sessionNameStore.set(body.key, body.name)
  else sessionNameStore.remove(body.key)
  return NextResponse.json({ names: sessionNameStore.all() })
}

// Bulk-merge (one-time migration of browser localStorage names). Only fills
// keys the server doesn't already have.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as { names?: Record<string, string> } | null
  if (body?.names && typeof body.names === 'object') sessionNameStore.merge(body.names)
  return NextResponse.json({ names: sessionNameStore.all() })
}
