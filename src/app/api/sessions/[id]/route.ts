export const dynamic = 'force-dynamic' // never prerender: reads live local state
import { DATA_DIR } from '../../../../lib/dataDir'
import { NextResponse } from 'next/server'
import path from 'path'
import { getSessionMessages } from '@/lib/sessionStore'
import { orgRegistry } from '@/lib/orgRegistry'

const TRASH_DIR = path.join(DATA_DIR, 'trash')

// Yields every candidate transcript path for a session id across all orgs'
// projects roots (a session lives in exactly one, but we don't know which).
async function* candidatePaths(id: string) {
  const fs = await import('fs')
  for (const { root } of orgRegistry.projectRoots()) {
    let projectDirs: string[]
    try { projectDirs = await fs.promises.readdir(root) } catch { continue }
    for (const projectDir of projectDirs) {
      yield { filePath: path.join(root, projectDir, `${id}.jsonl`), projectDir }
    }
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const fs = await import('fs')
  try {
    for await (const { filePath } of candidatePaths(params.id)) {
      try {
        await fs.promises.access(filePath)
        const all = await getSessionMessages(filePath)
        const messages = all.slice(-30)
        return NextResponse.json({ messages })
      } catch { /* not in this dir */ }
    }
    return NextResponse.json({ messages: [] })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}

// "Delete" moves the transcript to a trash folder rather than unlinking it —
// a past incident permanently lost a real conversation to a single misclick
// with no recovery path. This keeps every deleted session recoverable
// (manually, by moving it back) indefinitely; nothing here auto-purges.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const fs = await import('fs')
  if (!/^[a-f0-9-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  try {
    for await (const { filePath, projectDir } of candidatePaths(params.id)) {
      try {
        await fs.promises.access(filePath)
        const trashProjectDir = path.join(TRASH_DIR, projectDir)
        await fs.promises.mkdir(trashProjectDir, { recursive: true })
        const trashPath = path.join(trashProjectDir, `${Date.now()}-${params.id}.jsonl`)
        await fs.promises.rename(filePath, trashPath)
        return NextResponse.json({ ok: true, trashedTo: trashPath })
      } catch { /* not in this dir */ }
    }
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
