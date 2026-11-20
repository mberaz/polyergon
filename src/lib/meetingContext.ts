import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { meetingStore, type ContextKind } from './meetingStore'
import { liveSessionStore } from './liveSessionStore'
import { orgRegistry } from './orgRegistry'
import { sessionNameStore } from './sessionNameStore'
import { getSessionMessages, firstUserMessageSync } from './sessionStore'
import { claudeProjectDir } from './ptyManager'

// ponytail: hard cap per item; summarize long sources first if this proves too small.
export const MAX_CONTEXT_CHARS = 40_000

export interface ResolvedContext {
  label: string
  body: string
  // true: body is a reference (URL, file path, Slack/Notion/Drive link…) the
  // assistant loads itself with its tools and MCP connectors
  fetch: boolean
}

const clip = (s: string) => (s.length > MAX_CONTEXT_CHARS ? '…' + s.slice(-MAX_CONTEXT_CHARS) : s)

// Turns what the user picked into text (or a reference) for the assistant.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Finds <id>.jsonl under any org's projects root (ids are UUIDs, so no path tricks).
function findTranscript(id: string): string | null {
  for (const { root } of orgRegistry.projectRoots()) {
    let dirs: string[]
    try { dirs = readdirSync(root) } catch { continue }
    for (const d of dirs) {
      const f = join(root, d, `${id}.jsonl`)
      if (existsSync(f)) return f
    }
  }
  return null
}

export async function resolveContext(kind: ContextKind, value: string): Promise<ResolvedContext> {
  const v = value.trim()
  if (!v) throw new Error('Nothing to add')
  if (kind === 'text') return { label: v.split('\n')[0].slice(0, 60), body: clip(v), fetch: false }
  if (kind === 'link') return { label: v.slice(0, 80), body: v, fetch: true }
  if (kind === 'slack') {
    const channel = v.startsWith('http') ? v : '#' + v.replace(/^#/, '')
    return { label: `Slack: ${channel}`, body: `the Slack channel ${channel}. Use the Slack connector to read its messages from the last 7 days, including thread replies that matter`, fetch: true }
  }

  if (kind === 'meeting') {
    const m = meetingStore.get(v)
    if (!m) throw new Error('Meeting not found')
    const notes = meetingStore.readNotes(v)
    const summary = meetingStore.readSummary(v)
    const parts = [`Past meeting "${m.title}" on ${new Date(m.startedAt).toLocaleString()}`]
    if (summary) parts.push(summary)
    else if (notes) parts.push(`Decisions:\n- ${notes.decisions.join('\n- ')}\nAction items:\n- ${notes.actionItems.join('\n- ')}`)
    else parts.push(meetingStore.readTranscript(v).map(s => s.text).join('\n'))
    return { label: `Meeting: ${m.title}`, body: clip(parts.join('\n\n')), fetch: false }
  }

  if (kind === 'session') {
    // A live card id, or a Claude session id from History
    const s = liveSessionStore.get(v)
    const claudeId = s?.claudeSessionId ?? (UUID.test(v) ? v : null)
    const file = s?.claudeSessionId
      ? join(claudeProjectDir(s.cwd, orgRegistry.get(s.orgId)?.configDir), `${s.claudeSessionId}.jsonl`)
      : claudeId ? findTranscript(claudeId) : null
    if (!claudeId || !file || !existsSync(file)) throw new Error('Session not found or has no Claude transcript yet')
    const msgs = await getSessionMessages(file, 40)
    if (msgs.length === 0) throw new Error('Session transcript is empty')
    const names = sessionNameStore.all()
    const name = (s && names[s.id]) ?? names[claudeId] ?? firstUserMessageSync(file)?.slice(0, 60) ?? claudeId
    const text = msgs.map(m => `${m.role === 'user' ? 'User' : 'Claude'}: ${m.content}`).join('\n\n')
    return { label: `Session: ${name}`, body: clip(`Claude Code session${s ? ` in ${s.cwd}` : ''}\n\n${text}`), fetch: false }
  }

  throw new Error('Unknown context type')
}
