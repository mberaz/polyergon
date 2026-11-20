export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { orgConfigDir } from '@/lib/orgParam'
import { readSkillByName } from '@/lib/skillsReader'

export async function GET(req: NextRequest) {
  const found = readSkillByName(req.nextUrl.searchParams.get('name') ?? '', orgConfigDir(req))
  return found ? NextResponse.json(found) : NextResponse.json({ error: 'not found' }, { status: 404 })
}
