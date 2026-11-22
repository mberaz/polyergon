// Follows what the user types into a session, to tell when they ran /exit (or /quit).
// Keystrokes arrive one by one from xterm; Enter is \r, Backspace \x7f, arrows etc. start with \x1b.
export function typeInto(line: string, data: string): { line: string; submitted: string | null } {
  if (data.startsWith('\x1b')) return { line, submitted: null }
  let submitted: string | null = null
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') { submitted = line; line = '' }
    else if (ch === '\x7f' || ch === '\b') line = line.slice(0, -1)
    else if (ch === '\x03' || ch === '\x15') line = '' // Ctrl+C, Ctrl+U clear the prompt
    else if (ch >= ' ') line = (line + ch).slice(-200)
  }
  return { line, submitted }
}

// "/exi" and "/qu" + Enter pick /exit and /quit from Claude's command menu
export const isExitCommand = (s: string) => /^\/(exi|exit|qu|qui|quit)$/.test(s.trim())
