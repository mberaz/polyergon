export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { LiveSessionStore } from '@/lib/liveSessionStore'
import { sessionDiff, prDiff } from '@/lib/diffReview'

const PR_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

// GET ?id=<live session id>: what that session changed in its folder. Only live sessions' folders are readable.
// GET ?pr=<github PR url>: that PR's diff.
export async function GET(req: NextRequest) {
  const pr = req.nextUrl.searchParams.get('pr')
  if (pr) {
    if (!PR_RE.test(pr)) return NextResponse.json({ error: 'Not a GitHub pull request link' }, { status: 400 })
    try { return NextResponse.json(prDiff(pr)) } catch (e) {
      return NextResponse.json({ error: `Could not load the PR from GitHub: ${String((e as { stderr?: Buffer }).stderr ?? (e as Error).message).trim().split('\n').at(-1)}` }, { status: 502 })
    }
  }
  const s = LiveSessionStore.loadSaved().find(x => x.id === req.nextUrl.searchParams.get('id'))
  if (!s) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  try {
    return NextResponse.json(sessionDiff(s.cwd))
  } catch (e) {
    const msg = String((e as { stderr?: Buffer }).stderr ?? (e as Error).message)
    return NextResponse.json({ error: /not a git repository/i.test(msg) ? 'This session is not in a git repository, so there are no changes to review.' : msg.trim().split('\n').at(-1) }, { status: 400 })
  }
}
