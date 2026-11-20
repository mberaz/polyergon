export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { listLoops, listHooks, runLoopNow, loopLogTail } from '@/lib/existingAutomations'

export async function GET(req: NextRequest) {
  const log = req.nextUrl.searchParams.get('log')
  const loops = await listLoops()
  if (log) return NextResponse.json({ log: loopLogTail(log, loops) })
  return NextResponse.json({ loops, hooks: listHooks() })
}

// { action: 'run', label }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null) as { action?: string; label?: string } | null
  if (b?.action !== 'run' || !b.label) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  try { await runLoopNow(b.label); return NextResponse.json({ ok: true }) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
}
