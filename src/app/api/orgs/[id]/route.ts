export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { orgRegistry } from '@/lib/orgRegistry'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, props: Ctx) {
  const params = await props.params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 })
  const patch: Parameters<typeof orgRegistry.update>[1] = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    patch.name = body.name.trim().slice(0, 40)
  }
  if (body.configDir !== undefined) {
    if (typeof body.configDir !== 'string' || !body.configDir.startsWith('/')) return NextResponse.json({ error: 'Config folder must be an absolute path' }, { status: 400 })
    patch.configDir = body.configDir
  }
  if (body.model !== undefined) patch.model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null
  if (body.githubOrgs !== undefined) {
    if (!Array.isArray(body.githubOrgs) || !body.githubOrgs.every(g => typeof g === 'string')) return NextResponse.json({ error: 'githubOrgs must be a list' }, { status: 400 })
    patch.githubOrgs = (body.githubOrgs as string[]).map(g => g.trim()).filter(Boolean)
  }
  const org = orgRegistry.update(params.id, patch)
  return org ? NextResponse.json(org) : NextResponse.json({ error: 'not found' }, { status: 404 })
}

export async function DELETE(_req: Request, props: Ctx) {
  const params = await props.params;
  return orgRegistry.remove(params.id)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'The Default org cannot be removed' }, { status: 400 })
}
