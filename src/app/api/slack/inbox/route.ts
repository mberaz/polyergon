export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { getInbox, refreshInbox, markDone } from '@/lib/slackInbox'
import { replyInThread, addReaction, draftReply } from '@/lib/slackBridge'
import { orgParam } from '@/lib/orgParam'

// Emoji the inbox offers (Slack names)
const REACTIONS = ['thumbsup', 'eyes', 'white_check_mark', 'pray', 'heart', 'joy', 'raised_hands', 'fire']

const isPermalink = (s: unknown): s is string => typeof s === 'string' && /^https:\/\/[\w.-]+\.slack\.com\/archives\/[\w/?=&.-]+$/.test(s)

// GET: cached inbox. ?refresh=1 starts a refresh in the background (poll for the result).
export async function GET(req: NextRequest) {
  const org = orgParam(req)
  if (req.nextUrl.searchParams.get('refresh') === '1') refreshInbox(org).catch(() => {})
  return NextResponse.json(getInbox(org))
}

// POST { action: 'reply' | 'draft' | 'done', permalink, text?, react? }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null) as { action?: string; permalink?: string; text?: string; react?: boolean } | null
  if (!b || !isPermalink(b.permalink)) return NextResponse.json({ error: 'Bad Slack link' }, { status: 400 })
  const org = orgParam(req)
  try {
    if (b.action === 'draft') return NextResponse.json({ text: await draftReply(b.permalink, org) })
    if (b.action === 'reply') {
      const text = String(b.text ?? '').trim()
      if (!text) return NextResponse.json({ error: 'Write a reply first' }, { status: 400 })
      await replyInThread(b.permalink, text.slice(0, 4000), org)
      markDone(b.permalink, org)
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'react') {
      const emoji = (b as { emoji?: string }).emoji
      if (!emoji || !REACTIONS.includes(emoji)) return NextResponse.json({ error: 'Unknown emoji' }, { status: 400 })
      await addReaction(b.permalink, emoji, org)
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'done') {
      if (b.react) await addReaction(b.permalink, 'white_check_mark', org)
      markDone(b.permalink, org)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
