export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { listSkills, saveUserSkill, type SkillInput } from '@/lib/skillsReader'

// Installed skills (user + plugin), deduped by name, for the Skills tab.
export async function GET() {
  return NextResponse.json({ skills: listSkills() })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as SkillInput | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'bad body' }, { status: 400 })
  try {
    return NextResponse.json({ name: saveUserSkill(body) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
