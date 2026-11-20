import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './dataDir'
import { runClaude } from './meetingAssistant'
import { orgRegistry, DEFAULT_ORG_ID } from './orgRegistry'

// Slack goes through the Slack connector in the user's Claude setup (no Slack
// token in Polyergon). Each call is a short headless `claude -p` run.

export interface SlackChannel { id: string; name: string }

const CACHE_FILE = join(DATA_DIR, 'slack-channels.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function opts() {
  const org = orgRegistry.get(DEFAULT_ORG_ID)
  mkdirSync(DATA_DIR, { recursive: true })
  return { cwd: DATA_DIR, configDir: org?.configDir ?? null, model: 'claude-haiku-5-5' }
}

// Pulls the first JSON array out of a reply (tolerates fences / prose).
export function parseChannels(raw: string): SlackChannel[] {
  const start = raw.indexOf('['), end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(raw.slice(start, end + 1))
    return (Array.isArray(arr) ? arr : [])
      .filter((c: unknown): c is SlackChannel => !!c && typeof (c as SlackChannel).name === 'string')
      .map(c => ({ id: String(c.id ?? ''), name: c.name.replace(/^#/, '') }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}

export async function listSlackChannels(refresh = false): Promise<{ channels: SlackChannel[]; fetchedAt: number }> {
  if (!refresh) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.channels?.length) return cached
    } catch { /* no cache */ }
  }
  const { result } = await runClaude(
    'Use the Slack connector to list every Slack channel I am a member of (public and private, not DMs). ' +
    'Page through all results. Respond with ONLY a JSON array, no prose: [{"id": "C123", "name": "channel-name"}, ...]',
    opts(),
  )
  const channels = parseChannels(result)
  if (!channels.length) throw new Error(`Could not read Slack channels. Is the Slack connector set up in Claude? (${result.slice(0, 120)})`)
  const data = { channels, fetchedAt: Date.now() }
  writeFileSync(CACHE_FILE, JSON.stringify(data))
  return data
}

// Meeting summary markdown → Slack mrkdwn
export function toSlackMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.*)$/gm, '*$1*')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ')
    .trim()
}

export async function postToSlack(channel: SlackChannel, text: string): Promise<void> {
  const target = channel.id ? `${channel.id} (#${channel.name})` : `#${channel.name}`
  const { result } = await runClaude(
    `Use the Slack connector to post the message below to the Slack channel ${target}. ` +
    'Post it exactly as written, as one message, without changes or additions. ' +
    'Reply with only "OK" when posted, or "FAILED: <reason>".\n\n<message>\n' + text + '\n</message>',
    opts(),
  )
  const reply = result.trim()
  if (!/^OK\b/i.test(reply)) throw new Error(reply.replace(/^FAILED:?\s*/i, '') || 'Slack did not confirm the post')
}
