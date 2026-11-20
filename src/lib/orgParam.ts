import type { NextRequest } from 'next/server'
import { orgRegistry, DEFAULT_ORG_ID } from './orgRegistry'

// ?org=<id> on API calls; 'all', missing or unknown → Default.
export function orgParam(req: NextRequest): string {
  const id = req.nextUrl.searchParams.get('org')
  return id && id !== 'all' && orgRegistry.get(id) ? id : DEFAULT_ORG_ID
}

// The org's Claude config folder (null = ~/.claude), for skills/plugins
export function orgConfigDir(req: NextRequest): string | null {
  return orgRegistry.get(orgParam(req))?.configDir ?? null
}
