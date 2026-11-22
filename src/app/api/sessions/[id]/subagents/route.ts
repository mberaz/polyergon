export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { transcriptOf } from '@/lib/sessionPrs'
import { getRecentMessages } from '@/lib/sessionStore'
import { listSubagents, subagentFile, subagentsDir } from '@/lib/subagents'

// GET → this session's subagents; ?agent=<id> → that subagent's last messages
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const transcript = transcriptOf(params.id)
  if (!transcript) return NextResponse.json({ agents: [], messages: [] })
  const dir = subagentsDir(transcript, params.id)
  const agent = new URL(req.url).searchParams.get('agent')
  if (!agent) return NextResponse.json({ agents: listSubagents(dir) })
  const file = subagentFile(dir, agent)
  return NextResponse.json({ messages: file && existsSync(file) ? getRecentMessages(file, 60) : [] })
}
