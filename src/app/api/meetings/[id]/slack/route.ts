export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { MeetingStore } from '@/lib/meetingStore'
import { postToSlack, toSlackMarkdown } from '@/lib/slackBridge'

// The message for a meeting: title line + summary in Slack formatting.
function message(store: MeetingStore, id: string): string | null {
  const m = store.get(id)
  const summary = m && store.readSummary(id)
  if (!m || !summary) return null
  const when = new Date(m.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `*${m.title}* · ${when}\n\n${toSlackMarkdown(summary)}`
}

// Preview of exactly what will be posted
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const text = message(new MeetingStore(), params.id)
  return text ? NextResponse.json({ text }) : NextResponse.json({ error: 'This meeting has no summary yet' }, { status: 404 })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null) as { channel?: { id?: string; name?: string } } | null
  const name = body?.channel?.name?.replace(/^#/, '').trim()
  if (!name || !/^[\w.-]{1,80}$/.test(name)) return NextResponse.json({ error: 'Pick a channel' }, { status: 400 })
  const text = message(new MeetingStore(), params.id)
  if (!text) return NextResponse.json({ error: 'This meeting has no summary yet' }, { status: 404 })
  try {
    await postToSlack({ id: String(body?.channel?.id ?? '').replace(/[^A-Z0-9]/gi, ''), name }, text, new MeetingStore().get(params.id)?.orgId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
