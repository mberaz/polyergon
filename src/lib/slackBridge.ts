import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { DATA_DIR } from './dataDir'
import { runClaude } from './meetingAssistant'
import { orgRegistry, DEFAULT_ORG_ID } from './orgRegistry'


// Slack goes through the Slack connector in the user's Claude setup (no Slack
// token in Polyergon). Each call is a short headless `claude -p` run.

export interface SlackChannel { id: string; name: string }

// Why a Slack call failed, from Claude's reply, so the UI can say what to do.
export type SlackProblem = 'auth' | 'missing' | 'other'
export function classifySlackFailure(text: string): SlackProblem {
  if (/sign(ed)? ?in|log(ged)? ?in|re-?auth|authenticat|authori[sz]|reconnect|refused the connection|expired|token/i.test(text)) return 'auth'
  if (/no slack|not (available|configured|connected|installed)|don'?t have (access to )?(a |the )?slack|no .*slack (tool|connector)/i.test(text)) return 'missing'
  return 'other'
}
export class SlackError extends Error {
  constructor(message: string, public problem: SlackProblem) { super(message) }
}

// Per-org cache file; Default keeps the original name
export const orgFile = (base: string, orgId: string = DEFAULT_ORG_ID) =>
  join(DATA_DIR, orgId === DEFAULT_ORG_ID ? `${base}.json` : `${base}.${orgId.replace(/[^\w-]/g, '')}.json`)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Slack runs under the ORG's Claude config, so each org uses its own Slack connector/workspace.
function opts(model = 'claude-haiku-5-5', orgId: string = DEFAULT_ORG_ID) {
  const org = orgRegistry.get(orgId) ?? orgRegistry.get(DEFAULT_ORG_ID)
  mkdirSync(DATA_DIR, { recursive: true })
  return { cwd: DATA_DIR, configDir: org?.configDir ?? null, model, extraEnv: slackEnv(org?.configDir ?? null) }
}

// In -p, Claude dedups the Slack plugin against the "claude.ai Slack" connector; when that
// connector isn't signed in, BOTH get dropped. Orgs with their own config use the plugin, so
// turn the claude.ai connectors off there. Default keeps its signed-in claude.ai Slack.
const slackEnv = (configDir: string | null) => configDir ? { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } : undefined

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

export async function listSlackChannels(refresh = false, orgId: string = DEFAULT_ORG_ID): Promise<{ channels: SlackChannel[]; fetchedAt: number }> {
  if (!refresh) {
    try {
      const cached = JSON.parse(readFileSync(orgFile('slack-channels', orgId), 'utf-8'))
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.channels?.length) return cached
    } catch { /* no cache */ }
  }
  const { result } = await runClaude(
    'Use the Slack connector to list every Slack channel I am a member of (public and private, not DMs). ' +
    'Page through all results. Respond with ONLY a JSON array, no prose: [{"id": "C123", "name": "channel-name"}, ...]',
    opts(undefined, orgId),
  )
  const channels = parseChannels(result)
  if (!channels.length) throw new SlackError(result.trim().slice(0, 300) || 'No channels came back', classifySlackFailure(result))
  const data = { channels, fetchedAt: Date.now() }
  writeFileSync(orgFile('slack-channels', orgId), JSON.stringify(data))
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
export async function postToSlack(channel: SlackChannel, text: string, orgId: string = DEFAULT_ORG_ID): Promise<{ permalink: string | null }> {
  const target = channel.id ? `${channel.id} (#${channel.name})` : `#${channel.name}`
  const { result } = await runClaude(
    `Use the Slack connector to post the message below to the Slack channel ${target}. ` +
    'Post it exactly as written, as one message, without changes or additions. ' +
    'Reply with only "OK <the posted message permalink>" when posted, or "FAILED: <reason>".\n\n<message>\n' + text + '\n</message>',
    opts(undefined, orgId),
  )
  const reply = result.trim()
  if (!/^OK\b/i.test(reply)) throw new Error(reply.replace(/^FAILED:?\s*/i, '') || 'Slack did not confirm the post')
  return { permalink: reply.match(/https:\/\/\S+slack\.com\/archives\/\S+/)?.[0] ?? null }
}

// Sends a direct message to one person, found by name or @handle. Refuses
// (does not guess) when the name matches nobody or more than one person.
export async function dmOnSlack(person: string, text: string, orgId: string = DEFAULT_ORG_ID): Promise<{ permalink: string | null }> {
  if (!/^@?[\p{L}\p{N} ._'-]{1,60}$/u.test(person)) throw new Error(`Not a Slack name: ${person}`)
  const { result } = await runClaude(
    `Use the Slack connector to find the Slack user "${person.replace(/^@/, '')}" (match display name, real name or handle). ` +
    'If no one or more than one person matches, do not send anything. Otherwise send them the message below as a direct message, exactly as written, as one message. ' +
    'Reply with only "OK <the message permalink>" when sent, or "FAILED: <reason>".\n\n<message>\n' + text + '\n</message>',
    opts(undefined, orgId),
  )
  const reply = result.trim()
  if (!/^OK\b/i.test(reply)) throw new Error(reply.replace(/^FAILED:?\s*/i, '') || 'Slack did not confirm the DM')
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
export async function readSlackThread(permalink: string, orgId: string = DEFAULT_ORG_ID): Promise<SlackThreadView | null> {
  const { result } = await runClaude(
    `Use the Slack connector to read the Slack message at ${permalink}: its reactions and all thread replies. ` +
    'Respond with ONLY a JSON object, no prose: {"reviewers": [display names of people who said they will review, are reviewing, or reacted with eyes], ' +
    '"reactions": [{"emoji": "eyes", "users": ["Name"]}], "replies": [{"user": "Name", "text": "..."}]}',
    opts(undefined, orgId),
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
export async function fetchMentions(days = 7, orgId: string = DEFAULT_ORG_ID): Promise<SlackMention[]> {
  const { result } = await runClaude(
    `Use the Slack connector. Find messages from the last ${days} days that @-mention me (the signed-in Slack user), and direct messages sent to me. ` +
    'Skip bot and automated messages. At most 40, newest first. ' +
    'Respond with ONLY a JSON array, no prose: [{"permalink": "https://…slack.com/archives/…", "channel": "channel name, or the person for a DM", "author": "display name", "text": "the message text", "isDm": false}]',
    { ...opts('claude-sonnet-5-5', orgId), timeoutMs: 240_000 },
  )
  const found = parseMentions(result)
  if (!found.length && !/^\s*\[\s*\]\s*$/.test(result.replace(/```(json)?/g, ''))) throw new SlackError(result.trim().slice(0, 300), classifySlackFailure(result))
  return found
}

// Who "me" is in Slack, looked up once and cached (the checks below need it).
export async function slackMe(orgId: string = DEFAULT_ORG_ID): Promise<{ id: string; name: string }> {
  try { return JSON.parse(readFileSync(orgFile('slack-me', orgId), 'utf-8')) } catch { /* look it up */ }
  const { result } = await runClaude(
    'Use the Slack connector to look up the profile of the signed-in Slack user (me). Respond with ONLY JSON: {"id": "U…", "name": "display name"}',
    opts(undefined, orgId),
  )
  const m = result.match(/\{[\s\S]*\}/)
  const me = m ? JSON.parse(m[0]) : null
  if (!me?.id) throw new SlackError(result.trim().slice(0, 300) || 'Could not find your Slack user', classifySlackFailure(result))
  writeFileSync(orgFile('slack-me', orgId), JSON.stringify(me))
  return me
}

export function parseAnswered(raw: string): { answered: boolean; evidence: string | null } {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Unreadable answer check')
  const j = JSON.parse(m[0])
  const evidence = typeof j.evidence === 'string' && j.evidence.trim() ? j.evidence.trim() : null
  // Only trust "answered" when it comes with the actual reply as proof
  return { answered: j.answered === true && (!!evidence || j.reacted === true), evidence }
}

// Step 2, one message at a time: did I answer it? Requires proof (my reply text).
export async function isAnswered(m: SlackMention, me: { id: string; name: string }, orgId: string = DEFAULT_ORG_ID): Promise<boolean> {
  const where = m.isDm
    ? 'This is a direct message: read the messages in that same DM conversation that come AFTER it (not just thread replies).'
    : 'Read its thread replies, and also the next messages in the channel in case I answered there.'
  const { result } = await runClaude(
    `Use the Slack connector. I am Slack user ${me.id} (${me.name}). Look at the Slack message at ${m.permalink}. ${where} ` +
    `Decide whether I (${me.id}) already answered it after it was posted, or reacted to it with ✅ / white_check_mark. ` +
    'Respond with ONLY JSON: {"answered": true or false, "reacted": true or false, "evidence": "the exact text of my reply, or empty"}',
    { ...opts(undefined, orgId), timeoutMs: 120_000 },
  )
  return parseAnswered(result).answered
}

export async function replyInThread(permalink: string, text: string, orgId: string = DEFAULT_ORG_ID): Promise<void> {
  const { result } = await runClaude(
    `Use the Slack connector to reply in the thread of the Slack message at ${permalink}. ` +
    'Post the reply below exactly as written, as one message. Reply with only "OK" when posted, or "FAILED: <reason>".\n\n<reply>\n' + text + '\n</reply>',
    opts(undefined, orgId),
  )
  if (!/^OK\b/i.test(result.trim())) throw new Error(result.trim().replace(/^FAILED:?\s*/i, '') || 'Slack did not confirm the reply')
}

export async function addReaction(permalink: string, emoji: string, orgId: string = DEFAULT_ORG_ID): Promise<void> {
  await runClaude(`Use the Slack connector to add the :${emoji}: reaction to the Slack message at ${permalink}. Reply with only "OK" or "FAILED: <reason>".`, opts(undefined, orgId))
}

// Suggested reply, in the user's voice, from the message and its thread.
// ctx: a related session. Drafts from a FORKED copy of it (knows the work; live session untouched).
export async function draftReply(permalink: string, orgId: string = DEFAULT_ORG_ID, ctx: { resumeId: string; cwd: string } | null = null): Promise<string> {
  const prompt =
    `Use the Slack connector to read the Slack message at ${permalink} and its whole thread. ` +
    'Write a short, helpful reply that I (the signed-in user, who was tagged) could send. Match the thread\'s language and tone. ' +
    (ctx ? 'Use what you know from this conversation and the code here. ' : '') +
    'If you cannot know the answer, write a reply that says what I will check and by when. Respond with ONLY the reply text.'
  const base = opts('claude-sonnet-5-5', orgId)
  const { result } = ctx
    ? await runClaude(prompt, { ...base, cwd: ctx.cwd, model: null, resumeId: ctx.resumeId, forkSession: true, timeoutMs: 300_000 })
    : await runClaude(prompt, base)
  return result.trim()
}

// ---- Slack channel watcher ----

export interface ChannelRequest { permalink: string; author: string; text: string; time: string }

export function parseRequests(raw: string): ChannelRequest[] {
  return parseMentions(raw).map(m => ({ permalink: m.permalink, author: m.author, text: m.text, time: m.time }))
}

// New questions/requests in a channel since a time that nobody has answered yet.
export async function newChannelRequests(channel: SlackChannel, sinceIso: string, orgId: string = DEFAULT_ORG_ID): Promise<ChannelRequest[]> {
  const target = channel.id ? `${channel.id} (#${channel.name})` : `#${channel.name}`
  const { result } = await runClaude(
    `Use the Slack connector to read the Slack channel ${target}: messages posted after ${sinceIso}. ` +
    'Channel history shows only top-level posts, so ALSO open every thread whose latest reply is after that time (even if the thread started earlier) and read its replies. ' +
    'Pick the messages (top-level or thread replies) that ask a question or request something and that nobody but the asker has answered since. ' +
    'Several follow-ups from the same person in one thread count as one request: return only their latest message, with the request summarized in "text". ' +
    'Skip bots, my own messages, and chatter that needs no answer. ' +
    'Respond with ONLY a JSON array, no prose: [{"permalink": "https://…slack.com/archives/…", "author": "display name", "text": "the message text"}]',
    { ...opts('claude-sonnet-5-5', orgId), timeoutMs: 240_000 },
  )
  return parseRequests(result)
}

// Marks a draft that only the owner can answer (no auto-post).
export const NEEDS_OWNER = 'NEEDS_OWNER:'

// Draft a reply. With ctx, Claude answers from a forked copy of that session
// (its knowledge and repo), never touching the live session.
export async function draftChannelReply(r: ChannelRequest, channel: string, ctx: { resumeId: string; cwd: string; configDir: string | null } | null, orgId: string = DEFAULT_ORG_ID, extra: { knowledge?: string; instructions?: string } = {}): Promise<string> {
  const prompt =
    `Someone asked in Slack #${channel} (${r.permalink}). ${r.author} wrote:\n"""\n${r.text}\n"""\n` +
    'Read the thread with the Slack connector if you need more context. Draft a short, accurate reply I could post in the thread. ' +
    (extra.knowledge?.trim() ? `Knowledge sources to check first (web links, files/folders on this Mac, Slack channels, notes):\n${extra.knowledge.trim()}\n` : '') +
    (extra.instructions?.trim() ? `How to answer (follow this):\n${extra.instructions.trim()}\n` : '') +
    'Use what you know from this conversation and the code here. If you are not sure, say what you would check instead of guessing. ' +
    'Never promise work for later ("I\'ll check", "I\'ll post the results"): nobody will do it. ' +
    `If you can't give a real answer now, start the reply with ${NEEDS_OWNER} so I write it myself. ` +
    `If they ask for something to be done (deploy, rollout, fix, restart) and it is not done yet, do not reply with a plan or a command for them to run: start with ${NEEDS_OWNER} so the work gets done first. ` +
    'Respond with ONLY the reply text.'
  const { result } = ctx
    ? await runClaude(prompt, { cwd: ctx.cwd, configDir: ctx.configDir, model: null, extraEnv: slackEnv(ctx.configDir), resumeId: ctx.resumeId, forkSession: true, timeoutMs: 300_000 })
    : await runClaude(prompt, { ...opts('claude-sonnet-5-5', orgId), timeoutMs: 240_000 })
  return result.trim()
}

// Cheap check (no Claude call): Slack plugin enabled, a Slack MCP server configured,
// or Slack already worked for this org. claude.ai connectors aren't visible on disk,
// so the last check covers those after the first successful run.
export function slackConfigured(orgId: string = DEFAULT_ORG_ID): boolean {
  if (existsSync(orgFile('slack-me', orgId)) || existsSync(orgFile('slack-channels', orgId))) return true
  const dir = orgRegistry.get(orgId)?.configDir ?? null
  const read = (f: string) => { try { return JSON.parse(readFileSync(f, 'utf-8')) } catch { return {} } }
  const plugins = read(join(dir ?? join(homedir(), '.claude'), 'settings.json')).enabledPlugins ?? {}
  const servers = read(dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')).mcpServers ?? {}
  return Object.entries(plugins).some(([k, on]) => on && /^slack@/.test(k)) || Object.keys(servers).some(k => /slack/i.test(k))
}
