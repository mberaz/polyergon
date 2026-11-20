export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { readUserSkill, saveUserSkill, trashUserSkill, type SkillInput } from '@/lib/skillsReader'

type Ctx = { params: { name: string } }

export async function GET(_req: Request, { params }: Ctx) {
  const raw = readUserSkill(params.name)
  return raw === null ? NextResponse.json({ error: 'not found' }, { status: 404 }) : NextResponse.json({ raw })
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  if (readUserSkill(params.name) === null) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const body = await req.json().catch(() => null) as SkillInput | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'bad body' }, { status: 400 })
  try {
    return NextResponse.json({ name: saveUserSkill(body, params.name) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return trashUserSkill(params.name) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not found' }, { status: 404 })
}
