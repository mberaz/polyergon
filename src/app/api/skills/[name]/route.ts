export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { orgConfigDir } from '@/lib/orgParam'
import { readUserSkill, saveUserSkill, trashUserSkill, type SkillInput } from '@/lib/skillsReader'

type Ctx = { params: { name: string } }

export async function GET(req: NextRequest, { params }: Ctx) {
  const raw = readUserSkill(params.name, orgConfigDir(req))
  return raw === null ? NextResponse.json({ error: 'not found' }, { status: 404 }) : NextResponse.json({ raw })
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  if (readUserSkill(params.name, orgConfigDir(req)) === null) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const body = await req.json().catch(() => null) as SkillInput | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'bad body' }, { status: 400 })
  try {
    return NextResponse.json({ name: saveUserSkill(body, params.name, orgConfigDir(req)) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return trashUserSkill(params.name, orgConfigDir(req)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not found' }, { status: 404 })
}
