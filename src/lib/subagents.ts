import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'

export interface SubagentInfo { id: string; type: string; description: string; running: boolean; updatedAt: number }

// Claude Code keeps each subagent's conversation next to the session's transcript:
// <project>/<sessionId>/subagents/agent-<id>.jsonl (+ .meta.json with type and description)
export const subagentsDir = (transcript: string, sessionId: string) => join(dirname(transcript), sessionId, 'subagents')

// ponytail: "running" = written to in the last 30s; a subagent waiting on a slow tool can look done
export function listSubagents(dir: string, now = Date.now()): SubagentInfo[] {
  let files: string[]
  try { files = readdirSync(dir) } catch { return [] }
  return files.filter(f => /^agent-[\w-]+\.jsonl$/.test(f)).map(f => {
    const id = f.slice(6, -6)
    let meta: { agentType?: string; description?: string } = {}
    try { meta = JSON.parse(readFileSync(join(dir, `agent-${id}.meta.json`), 'utf-8')) } catch { /* older agents have no meta */ }
    const updatedAt = statSync(join(dir, f)).mtimeMs
    return { id, type: meta.agentType ?? 'agent', description: meta.description ?? id, running: now - updatedAt < 30_000, updatedAt }
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
}

export const subagentFile = (dir: string, id: string) => /^[\w-]+$/.test(id) ? join(dir, `agent-${id}.jsonl`) : null
