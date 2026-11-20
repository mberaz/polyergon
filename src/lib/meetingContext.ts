import { join } from 'path'
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
export async function resolveContext(kind: ContextKind, value: string): Promise<ResolvedContext> {
  const v = value.trim()
  if (!v) throw new Error('Nothing to add')
  if (kind === 'text') return { label: v.split('\n')[0].slice(0, 60), body: clip(v), fetch: false }
  if (kind === 'link') return { label: v.slice(0, 80), body: v, fetch: true }

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
    const s = liveSessionStore.get(v)
    if (!s?.claudeSessionId) throw new Error('Session not found or has no Claude transcript yet')
    const file = join(claudeProjectDir(s.cwd, orgRegistry.get(s.orgId)?.configDir), `${s.claudeSessionId}.jsonl`)
    const msgs = await getSessionMessages(file, 40)
    if (msgs.length === 0) throw new Error('Session transcript is empty')
    const names = sessionNameStore.all()
    const name = names[s.id] ?? names[s.claudeSessionId] ?? firstUserMessageSync(file)?.slice(0, 60) ?? s.cwd
    const text = msgs.map(m => `${m.role === 'user' ? 'User' : 'Claude'}: ${m.content}`).join('\n\n')
    return { label: `Session: ${name}`, body: clip(`Claude Code session in ${s.cwd}\n\n${text}`), fetch: false }
  }

  throw new Error('Unknown context type')
}
