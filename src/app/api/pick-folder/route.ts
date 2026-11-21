export const dynamic = 'force-dynamic' // never prerender: opens a native dialog
import { execFile } from 'child_process'
import { NextResponse } from 'next/server'

// Opens the macOS folder picker on this Mac and returns the chosen path.
// The browser can't read real paths from its own file picker, so the server asks Finder.
export async function POST() {
  if (process.platform !== 'darwin') return NextResponse.json({ error: 'Folder picker works on macOS only. Paste the path instead.' }, { status: 400 })
  // Finder shows the picker in front; System Events can't (it cancels at once).
  const script = 'tell application "Finder"\nactivate\nset f to choose folder with prompt "Choose a folder for the new session"\nend tell\nPOSIX path of f'
  return new Promise<NextResponse>(resolve => {
    execFile('osascript', ['-e', script], { timeout: 10 * 60_000 }, (err, stdout) => {
      if (err) return resolve(NextResponse.json({ path: null })) // cancelled or timed out
      resolve(NextResponse.json({ path: stdout.trim().replace(/\/$/, '') || '/' }))
    })
  })
}
