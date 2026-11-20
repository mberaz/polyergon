import type { SessionStatus } from './liveSessionStore'

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g
// cursor-forward codes between words (\x1b[NC) — strip separately
const CURSOR_FWD_RE = /\x1b\[\d*C/g

// Claude's spinner glyph, shown at the start of its working-status line
// (e.g. "✻ Vibing… (3s · thinking)") while actively processing. Deliberately
// excludes '·' (middle dot) — it's one real spinner frame, but it's also used
// as a plain decorative separator in the idle footer ("... · ← for agents"),
// which can land at column 0 if that line wraps and falsely read as thinking.
// The spinner cycles through several other frames, so missing this one frame
// doesn't hurt real detection.
const SPINNER_RE = /^[✢✳✶✻✽]\s/m
// When a turn ends, newer Claude Code leaves a summary in the same spot with the
// same glyph: "✻ Brewed for 1s · done 14:49" / "✻ Cooked for 2m 3s". That's
// finished, not busy. Active lines read "✻ Vibing… (3s · thinking)".
const DONE_LINE_RE = /^[✢✳✶✻✽]\s+\S+ for \d[\dhms ]*(?:·|$)/

// Copilot's TUI: the prompt glyph ❯ is on screen in EVERY state, so it can't
// signal "waiting". Its footer row says "◎ Working  esc edit prompt" while
// busy and "← open sidebar · Interactive · …" when idle — that's the signal.
// Callers pass the bottom rows of the screen for copilot (not the cursor tail).
const COPILOT_WORKING_RE = /\bWorking\b[^\n]*esc edit prompt|◎ Working/

export function detectStatus(chunk: string, backend?: string): SessionStatus {
  const stripped = chunk.replace(ANSI_RE, '').replace(CURSOR_FWD_RE, '')
  if (backend === 'copilot') return COPILOT_WORKING_RE.test(stripped) ? 'thinking' : 'waiting'
  // The ❯ prompt is rendered as permanent UI chrome below the status line
  // regardless of state, so it can't distinguish thinking from waiting on its
  // own — the spinner is the actual "busy" signal and must be checked first.
  if (stripped.split('\n').some(l => SPINNER_RE.test(l) && !DONE_LINE_RE.test(l))) return 'thinking'
  // The footer shows "esc to interrupt" for as long as a turn is running
  if (/esc to interrupt/i.test(stripped)) return 'thinking'
  // Claude shows ❯ (U+276F) when waiting for input at the prompt.
  // It appears mid-chunk (above the status bar), so we search anywhere.
  if (stripped.includes('❯')) return 'waiting'
  // Fallback patterns for other prompts
  if (/[>?]\s*$/.test(stripped.trimEnd())) return 'waiting'
  if (/\(y\/n\)\s*$/i.test(stripped.trimEnd())) return 'waiting'
  return 'thinking'
}
