export interface ScreenQuestion { text: string; options: { n: string; label: string }[] }

// Claude's menus (questions, permission prompts) live only on the terminal
// screen, not in the transcript. A menu has numbered options with the ❯ cursor
// on one of them; a plain numbered list in an answer never has the cursor.
export function parseScreenQuestion(screen: string): ScreenQuestion | null {
  const lines = screen.split('\n').map(l => l.replace(/[│╭╮╰╯]/g, '').trimEnd())
  const opt = /^\s*(❯\s*)?(\d+)\.\s+(.+)$/
  const first = lines.findIndex(l => opt.test(l))
  if (first < 0) return null
  const options: ScreenQuestion['options'] = []
  let cursor = false
  for (const l of lines.slice(first)) {
    const m = l.match(opt)
    if (m) { cursor ||= !!m[1]; options.push({ n: m[2], label: m[3].trim() }) }
  }
  if (!cursor || options.length < 2 || options[0].n !== '1') return null
  const above = lines.slice(Math.max(0, first - 10), first).map(l => l.trim()).filter(l => l && !/^[─━-]+$/.test(l))
  return { text: above.join('\n'), options }
}
