export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { LiveSessionStore } from '@/lib/liveSessionStore'
import { sessionDiff } from '@/lib/diffReview'

// GET ?id=<live session id>: what that session changed. Only live sessions' folders are readable.
export async function GET(req: NextRequest) {
  const s = LiveSessionStore.loadSaved().find(x => x.id === req.nextUrl.searchParams.get('id'))
  if (!s) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  try {
    return NextResponse.json(sessionDiff(s.cwd))
  } catch (e) {
    const msg = String((e as { stderr?: Buffer }).stderr ?? (e as Error).message)
    return NextResponse.json({ error: /not a git repository/i.test(msg) ? 'This session is not in a git repository, so there are no changes to review.' : msg.trim().split('\n').at(-1) }, { status: 400 })
  }
}
