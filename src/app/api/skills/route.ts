export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { NextResponse } from 'next/server'
import { listSkills } from '@/lib/skillsReader'

// Installed skills (user + plugin), deduped by name, for the Skills tab.
export async function GET() {
  return NextResponse.json({ skills: listSkills() })
}
