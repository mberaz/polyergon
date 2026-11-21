export const dynamic = 'force-dynamic' // never prerender: writes files
import { NextRequest, NextResponse } from 'next/server'
import { saveDropped } from '@/lib/dropFiles'

// Chat view drops: save the files, return their paths for the message.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { files?: { name?: unknown; data?: unknown }[] } | null
  if (!Array.isArray(body?.files)) return NextResponse.json({ error: 'No files' }, { status: 400 })
  return NextResponse.json({ paths: saveDropped(body!.files) })
}
