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

function opts(model = 'claude-haiku-5-5') {
  const org = orgRegistry.get(DEFAULT_ORG_ID)
  mkdirSync(DATA_DIR, { recursive: true })
  return { cwd: DATA_DIR, configDir: org?.configDir ?? null, model }
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

// Posts and returns the message permalink when Slack reports one.
export async function postToSlack(channel: SlackChannel, text: string): Promise<{ permalink: string | null }> {
  const target = channel.id ? `${channel.id} (#${channel.name})` : `#${channel.name}`
  const { result } = await runClaude(
    `Use the Slack connector to post the message below to the Slack channel ${target}. ` +
    'Post it exactly as written, as one message, without changes or additions. ' +
    'Reply with only "OK <the posted message permalink>" when posted, or "FAILED: <reason>".\n\n<message>\n' + text + '\n</message>',
    opts(),
  )
  const reply = result.trim()
  if (!/^OK\b/i.test(reply)) throw new Error(reply.replace(/^FAILED:?\s*/i, '') || 'Slack did not confirm the post')
  return { permalink: reply.match(/https:\/\/\S+slack\.com\/archives\/\S+/)?.[0] ?? null }
}

export interface SlackThreadView {
  reviewers: string[] // said they'll review / are reviewing, or reacted 👀
  reactions: { emoji: string; users: string[] }[]
  replies: { user: string; text: string }[]
}

export function parseThread(raw: string): SlackThreadView | null {
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const j = JSON.parse(raw.slice(start, end + 1))
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [])
    return {
      reviewers: strs(j.reviewers),
      reactions: (Array.isArray(j.reactions) ? j.reactions : []).map((r: { emoji?: unknown; users?: unknown }) => ({ emoji: String(r.emoji ?? ''), users: strs(r.users) })).filter((r: { emoji: string }) => r.emoji),
      replies: (Array.isArray(j.replies) ? j.replies : []).map((r: { user?: unknown; text?: unknown }) => ({ user: String(r.user ?? ''), text: String(r.text ?? '').slice(0, 300) })).slice(-5),
    }
  } catch { return null }
}

// Reads replies and reactions on a posted message and picks out who is reviewing.
export async function readSlackThread(permalink: string): Promise<SlackThreadView | null> {
  const { result } = await runClaude(
    `Use the Slack connector to read the Slack message at ${permalink}: its reactions and all thread replies. ` +
    'Respond with ONLY a JSON object, no prose: {"reviewers": [display names of people who said they will review, are reviewing, or reacted with eyes], ' +
    '"reactions": [{"emoji": "eyes", "users": ["Name"]}], "replies": [{"user": "Name", "text": "..."}]}',
    opts(),
  )
  return parseThread(result)
}

// ---- Slack inbox: mentions and DMs you haven't answered ----

export interface SlackMention {
  permalink: string
  channel: string
  author: string
  text: string
  time: string // ISO, from the permalink's timestamp
  isDm: boolean
  checked?: boolean // false until we know you haven't answered it
  suggestion?: string // Claude's suggested reply
}

// Slack permalinks carry the message time: …/p1795174145426439 → 1795174145.426439 s
export function timeFromPermalink(permalink: string): string {
  const m = permalink.match(/\/p(\d{10})(\d{6})/)
  return m ? new Date(Number(m[1]) * 1000).toISOString() : ''
}

export function parseMentions(raw: string): SlackMention[] {
  const start = raw.indexOf('['), end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(raw.slice(start, end + 1))
    const seen = new Set<string>()
    return (Array.isArray(arr) ? arr : [])
      .filter((m: Partial<SlackMention>) => typeof m?.permalink === 'string' && /slack\.com\/archives\//.test(m.permalink) && !seen.has(m.permalink) && !!seen.add(m.permalink))
      .map((m: Partial<SlackMention>) => ({ permalink: m.permalink!, channel: String(m.channel ?? '').replace(/^#/, ''), author: String(m.author ?? ''), text: String(m.text ?? '').slice(0, 2000), time: timeFromPermalink(m.permalink!), isDm: !!m.isDm, checked: false }))
      .sort((a, b) => b.time.localeCompare(a.time))
  } catch { return [] }
}

// Step 1 (fast): every recent mention and DM, answered or not.
export async function fetchMentions(days = 7): Promise<SlackMention[]> {
  const { result } = await runClaude(
    `Use the Slack connector. Find messages from the last ${days} days that @-mention me (the signed-in Slack user), and direct messages sent to me. ` +
    'Skip bot and automated messages. At most 40, newest first. ' +
    'Respond with ONLY a JSON array, no prose: [{"permalink": "https://…slack.com/archives/…", "channel": "channel name, or the person for a DM", "author": "display name", "text": "the message text", "isDm": false}]',
    { ...opts('claude-sonnet-5-5'), timeoutMs: 240_000 },
  )
  return parseMentions(result)
}

// Step 2: which of these are still open (I haven't replied after it or reacted ✅).
export async function openOnly(permalinks: string[]): Promise<Set<string>> {
  if (!permalinks.length) return new Set()
  const { result } = await runClaude(
    'Use the Slack connector. For each Slack message below, check whether I (the signed-in user) already answered it: ' +
    'I replied in its thread, or replied in the same DM after it, or added a ✅ / white_check_mark reaction. ' +
    'Respond with ONLY a JSON array of the permalinks that are still unanswered, no prose.\n\n' + permalinks.join('\n'),
    { ...opts('claude-sonnet-5-5'), timeoutMs: 420_000 },
  )
  const start = result.indexOf('['), end = result.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('Could not read which messages are answered')
  const arr = JSON.parse(result.slice(start, end + 1))
  return new Set((Array.isArray(arr) ? arr : []).filter((x: unknown): x is string => typeof x === 'string'))
}

export async function replyInThread(permalink: string, text: string): Promise<void> {
  const { result } = await runClaude(
    `Use the Slack connector to reply in the thread of the Slack message at ${permalink}. ` +
    'Post the reply below exactly as written, as one message. Reply with only "OK" when posted, or "FAILED: <reason>".\n\n<reply>\n' + text + '\n</reply>',
    opts(),
  )
  if (!/^OK\b/i.test(result.trim())) throw new Error(result.trim().replace(/^FAILED:?\s*/i, '') || 'Slack did not confirm the reply')
}

export async function addReaction(permalink: string, emoji: string): Promise<void> {
  await runClaude(`Use the Slack connector to add the :${emoji}: reaction to the Slack message at ${permalink}. Reply with only "OK" or "FAILED: <reason>".`, opts())
}

// Suggested reply, in the user's voice, from the message and its thread.
export async function draftReply(permalink: string): Promise<string> {
  const { result } = await runClaude(
    `Use the Slack connector to read the Slack message at ${permalink} and its whole thread. ` +
    'Write a short, helpful reply that I (the signed-in user, who was tagged) could send. Match the thread\'s language and tone. ' +
    'If you cannot know the answer, write a reply that says what I will check and by when. Respond with ONLY the reply text.',
    opts('claude-sonnet-5-5'),
  )
  return result.trim()
}
