import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { DATA_DIR } from './dataDir'
import { join } from 'path'

export interface SkillInfo {
  name: string
  description: string
  source: 'user' | 'plugin'
  plugin?: string       // plugin name, when source === 'plugin'
  path: string          // absolute path to the skill dir
}

// Parse the `name` and `description` from a SKILL.md YAML frontmatter block.
// Handles inline values (`description: text`), quoted values, and YAML block
// scalars (`description: >-` / `|` with the text indented on following lines).
export function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!m) return {}
  const lines = m[1].split('\n')
  const out: { name?: string; description?: string } = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1] as 'name' | 'description'
    let val = kv[2].trim()
    if (val === '>-' || val === '>' || val === '|' || val === '|-') {
      // Block scalar: collect subsequent more-indented lines.
      const collected: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+\S/.test(lines[j]) || lines[j].trim() === '') collected.push(lines[j].trim())
        else break
      }
      val = collected.join(' ').trim()
    } else {
      val = val.replace(/^["']|["']$/g, '')
    }
    out[key] = val
  }
  return out
}

function readSkillDir(dir: string, source: SkillInfo['source'], plugin?: string): SkillInfo | null {
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) return null
  try {
    const fm = parseFrontmatter(readFileSync(file, 'utf-8'))
    const name = fm.name || dir.split('/').at(-1) || 'skill'
    return { name, description: fm.description || '', source, plugin, path: dir }
  } catch {
    return null
  }
}

function skillsUnder(skillsRoot: string, source: SkillInfo['source'], plugin?: string): SkillInfo[] {
  if (!existsSync(skillsRoot)) return []
  const out: SkillInfo[] = []
  for (const entry of readdirSync(skillsRoot)) {
    const dir = join(skillsRoot, entry)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    const skill = readSkillDir(dir, source, plugin)
    if (skill) out.push(skill)
  }
  return out
}

// User skills live in ~/.claude/skills/<name>/SKILL.md. Installed plugin skills
// live under ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/.
// We read both, tag each with its source, and dedupe by name (user wins).
export function listSkills(): SkillInfo[] {
  const home = process.env.HOME!
  const claudeDir = join(home, '.claude')

  const user = skillsUnder(join(claudeDir, 'skills'), 'user')

  const plugin: SkillInfo[] = []
  const cacheRoot = join(claudeDir, 'plugins', 'cache')
  if (existsSync(cacheRoot)) {
    // cache/<marketplace>/<plugin>/<version>/skills/<name>
    for (const marketplace of safeReaddir(cacheRoot)) {
      const mDir = join(cacheRoot, marketplace)
      for (const pluginName of safeReaddir(mDir)) {
        const pDir = join(mDir, pluginName)
        for (const version of safeReaddir(pDir)) {
          const skillsRoot = join(pDir, version, 'skills')
          plugin.push(...skillsUnder(skillsRoot, 'plugin', pluginName))
        }
      }
    }
  }

  // Dedupe by name — user skills take precedence, then first plugin seen.
  const byName = new Map<string, SkillInfo>()
  for (const s of [...user, ...plugin]) {
    if (!byName.has(s.name)) byName.set(s.name, s)
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir).filter(e => { try { return statSync(join(dir, e)).isDirectory() } catch { return false } }) }
  catch { return [] }
}

// ---- Writing user skills (~/.claude/skills/<name>/SKILL.md) ----

const userSkillsRoot = () => join(process.env.HOME!, '.claude', 'skills')
// Claude Code skill names: lowercase letters, digits and hyphens.
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface SkillInput {
  raw?: string // a full SKILL.md (frontmatter + body)
  name?: string
  description?: string
  instructions?: string
}

// Builds the SKILL.md text and validates it. Throws a user-facing message.
export function buildSkill(input: SkillInput): { name: string; content: string } {
  let content: string
  let name: string | undefined
  let description: string | undefined
  if (input.raw?.trim()) {
    content = input.raw.replace(/\r\n/g, '\n').trim() + '\n'
    ;({ name, description } = parseFrontmatter(content))
    if (!name && !description) throw new Error('SKILL.md must start with a --- frontmatter block that has name and description')
  } else {
    name = input.name?.trim()
    description = input.description?.trim().replace(/\s+/g, ' ')
    const body = input.instructions?.trim() ?? ''
    if (!body) throw new Error('Instructions are required')
    // Folded block scalar: any characters (quotes, colons) are kept as-is
    content = `---\nname: ${name ?? ''}\ndescription: >-\n  ${description ?? ''}\n---\n\n${body}\n`
  }
  if (!name || !SKILL_NAME.test(name)) throw new Error('Name must be lowercase letters, digits and hyphens (e.g. release-notes)')
  if (!description) throw new Error('Description is required: it tells Claude when to use the skill')
  if (content.length > 200_000) throw new Error('Skill is too large (max 200 KB)')
  return { name, content }
}

export function readUserSkill(name: string): string | null {
  if (!SKILL_NAME.test(name)) return null
  try { return readFileSync(join(userSkillsRoot(), name, 'SKILL.md'), 'utf-8') } catch { return null }
}

// replaces: the existing skill being edited (null = new skill, must not exist).
export function saveUserSkill(input: SkillInput, replaces: string | null = null): string {
  const { name, content } = buildSkill(input)
  const dir = join(userSkillsRoot(), name)
  if (name !== replaces && existsSync(dir)) throw new Error(`A skill named "${name}" already exists`)
  if (replaces && name !== replaces) trashUserSkill(replaces) // renamed
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), content)
  return name
}

// Moves the skill folder to <data>/trash/skills (never deletes).
export function trashUserSkill(name: string): boolean {
  if (!SKILL_NAME.test(name)) return false
  const dir = join(userSkillsRoot(), name)
  if (!existsSync(dir)) return false
  const dest = join(DATA_DIR, 'trash', 'skills')
  mkdirSync(dest, { recursive: true })
  renameSync(dir, join(dest, `${name}-${Date.now()}`))
  return true
}
