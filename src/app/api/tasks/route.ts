export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { listTasks, addTask, updateTask, removeTask } from '@/lib/taskStore'

export async function GET() {
  return NextResponse.json(listTasks())
}

// POST { title, details, cwd, worktree, orgId }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null)
  if (!b || typeof b.title !== 'string' || !b.title.trim()) return NextResponse.json({ error: 'Give the task a title' }, { status: 400 })
  return NextResponse.json(addTask({ title: b.title, details: String(b.details ?? ''), cwd: String(b.cwd ?? 'general'), worktree: b.worktree === true, orgId: String(b.orgId ?? 'default') }))
}

// PATCH { id, ...fields }
export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => null)
  if (!b?.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { id, title, details, cwd, worktree, done, liveId } = b
  const t = updateTask(id, Object.fromEntries(Object.entries({ title, details, cwd, worktree, done, liveId }).filter(([, v]) => v !== undefined)))
  return t ? NextResponse.json(t) : NextResponse.json({ error: 'Task not found' }, { status: 404 })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  removeTask(id)
  return NextResponse.json({ ok: true })
}
