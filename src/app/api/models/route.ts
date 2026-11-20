export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextRequest, NextResponse } from 'next/server'
import { getModels } from '@/lib/modelCatalog'
import { DEFAULT_BACKEND, type BackendId } from '@/lib/backends'
import { DEFAULT_ORG_ID } from '@/lib/orgRegistry'

// Live model list for a backend+org (cached ~10 min). Feeds the model dropdown
// in the New Session dialog.
export async function GET(req: NextRequest) {
  const backend = (req.nextUrl.searchParams.get('backend') as BackendId) || DEFAULT_BACKEND
  const orgId = req.nextUrl.searchParams.get('orgId') || DEFAULT_ORG_ID
  const force = req.nextUrl.searchParams.get('refresh') === '1'
  try {
    const models = await getModels(backend, orgId, force)
    return NextResponse.json({ models })
  } catch (e) {
    return NextResponse.json(
      { models: [], error: e instanceof Error ? e.message : 'failed to load models' },
      { status: 200 },
    )
  }
}
