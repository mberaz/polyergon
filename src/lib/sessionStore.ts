import fs from 'fs'
import path from 'path'
import { createInterface } from 'readline'
import { getGitRoot } from './gitUtils'
import { orgRegistry } from './orgRegistry'

// ---------------------------------------------------------------------------
// Session metadata types (previously in sessionParser.ts)
// ---------------------------------------------------------------------------

interface ContentPart {
  type: string
  text?: string
}

export interface SessionMetadata {
  sessionId: string
  cwd: string | null
  messageCount: number
  lastTimestamp: string | null
  firstUserMessage: string | null
  // Started by `claude -p` (Polyergon's meeting assistant, Slack lookups…), not a person
  headless?: boolean
}

/**
 * Decode the encoded project directory name back to a path.
 * NOTE: This replacement is ambiguous — it cannot distinguish between
 * path separators and dashes that are part of directory/project names.
 */
export function decodeProjectPath(encoded: string): string {
  return encoded.replace(/-/g, '/')
}

// Only scan the first 20 lines — fast enough to get cwd + firstUserMessage
function extractSessionMetadata(content: string, sessionId: string, mtime: Date): SessionMetadata {
  let cwd: string | null = null
  let firstUserMessage: string | null = null
  let messageCount = 0
  let headless = false

  const lines = content.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.entrypoint === 'sdk-cli') headless = true
      if (entry.type === 'user' && entry.message?.role === 'user') {
        if (cwd === null && entry.cwd) cwd = entry.cwd
        const text: string = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content?.[0]?.text ?? ''
        if (firstUserMessage === null && text) firstUserMessage = text.slice(0, 100)
        messageCount++
      } else if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
        messageCount++
      }
    } catch { /* skip malformed lines */ }
  }

  return { sessionId, cwd, messageCount, lastTimestamp: mtime.toISOString(), firstUserMessage, headless }
}

// ---------------------------------------------------------------------------
// SessionSummary — the public type used by the UI
// ---------------------------------------------------------------------------

/**
 * projectPath is a best-effort decode of the encoded directory name.
 * It may be inaccurate for projects with hyphens in their path components.
 * Use `cwd` for the authoritative working directory.
 */
export interface SessionSummary extends SessionMetadata {
  projectPath: string
  projectEncoded: string
  filePath: string
  gitRoot: string | null
  orgId: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string | null
}

// Streams the transcript line by line and keeps only the last `keepLast`
// messages. Transcripts reach hundreds of MB (a 209 MB one exists); reading
// the whole file into a string OOM-killed the server even at an 8 GB heap.
export async function getSessionMessages(filePath: string, keepLast = 30): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = []
  const rl = createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'user' && entry.message?.role === 'user') {
        const text: string = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content?.[0]?.text ?? ''
        if (text) messages.push({ role: 'user', content: text, timestamp: entry.timestamp ?? null })
      } else if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
        const parts: ContentPart[] = entry.message.content ?? []
        const text = parts.filter(p => p.type === 'text').map(p => p.text).join('')
        if (text) messages.push({ role: 'assistant', content: text, timestamp: entry.timestamp ?? null })
      }
      if (messages.length > keepLast) messages.shift()
    } catch { /* skip malformed */ }
  }
  return messages
}

// Cheap title for a transcript: first user message from its first 64KB.
export function firstUserMessageSync(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, 65536, 0)
    fs.closeSync(fd)
    const head = buf.subarray(0, n).toString('utf-8')
    return extractSessionMetadata(head.slice(0, head.lastIndexOf('\n') + 1), '', new Date(0)).firstUserMessage
  } catch { return null }
}

export async function listAllSessions(): Promise<SessionSummary[]> {
  // Collect all .jsonl files with their mtime first (cheap stat), across
  // every registered org's projects root.
  const files: { filePath: string; projectDir: string; sessionId: string; mtime: Date; orgId: string }[] = []

  for (const { orgId, root } of orgRegistry.projectRoots()) {
    let projectDirs: string[]
    try { projectDirs = await fs.promises.readdir(root) } catch { continue }

    for (const projectDir of projectDirs) {
      const projectFullPath = path.join(root, projectDir)
      let dirStat: fs.Stats
      try { dirStat = await fs.promises.stat(projectFullPath) } catch { continue }
      if (!dirStat.isDirectory()) continue

      for (const file of await fs.promises.readdir(projectFullPath)) {
        if (!file.endsWith('.jsonl')) continue
        const filePath = path.join(projectFullPath, file)
        try {
          const s = await fs.promises.stat(filePath)
          files.push({ filePath, projectDir, sessionId: file.replace('.jsonl', ''), mtime: s.mtime, orgId })
        } catch { /* skip */ }
      }
    }
  }

  // Parse metadata from the first 64 KB of each file (covers large preambles)
  const READ_SIZE = 65536
  const summaries: SessionSummary[] = []
  await Promise.all(files.map(async ({ filePath, projectDir, sessionId, mtime, orgId }) => {
    try {
      const fd = await fs.promises.open(filePath, 'r')
      const buf = Buffer.alloc(READ_SIZE)
      const { bytesRead } = await fd.read(buf, 0, READ_SIZE, 0)
      await fd.close()
      const head = buf.subarray(0, bytesRead).toString('utf-8')
      // Trim last (possibly incomplete) line
      const content = head.slice(0, head.lastIndexOf('\n') + 1)
      const metadata = extractSessionMetadata(content, sessionId, mtime)
      const gitRoot = metadata.cwd ? getGitRoot(metadata.cwd) : null
      summaries.push({ ...metadata, projectPath: decodeProjectPath(projectDir), projectEncoded: projectDir, filePath, gitRoot, orgId })
    } catch { /* skip unreadable */ }
  }))

  return summaries.sort((a, b) => {
    const ta = a.lastTimestamp ?? ''
    const tb = b.lastTimestamp ?? ''
    return tb > ta ? 1 : tb < ta ? -1 : 0
  })
}
