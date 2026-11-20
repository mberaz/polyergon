import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const home = mkdtempSync(join(tmpdir(), 'skills-home-'))
process.env.HOME = home
process.env.POLYERGON_DATA_DIR = join(home, 'data')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { saveUserSkill, readUserSkill, trashUserSkill, listSkills, buildSkill } = require('../skillsReader')

afterAll(() => rmSync(home, { recursive: true, force: true }))

test('creates a skill from fields; listSkills sees it', () => {
  saveUserSkill({ name: 'release-notes', description: 'Use when writing "release notes"', instructions: '# Steps\n1. Read git log' })
  const raw = readUserSkill('release-notes')
  expect(raw).toContain('name: release-notes')
  expect(raw).toContain('description: >-\n  Use when writing "release notes"')
  expect(listSkills().find((s: { name: string }) => s.name === 'release-notes')).toMatchObject({ source: 'user', description: 'Use when writing "release notes"' })
})

test('pasted SKILL.md, duplicate refused, rename trashes the old one', () => {
  saveUserSkill({ raw: '---\nname: pr-review\ndescription: Use when reviewing PRs\n---\n\nCheck tests.' })
  expect(() => saveUserSkill({ raw: '---\nname: pr-review\ndescription: x\n---\nbody' })).toThrow('already exists')
  saveUserSkill({ raw: '---\nname: pr-check\ndescription: Use when reviewing PRs\n---\nCheck tests.' }, 'pr-review')
  expect(readUserSkill('pr-review')).toBeNull()
  expect(readUserSkill('pr-check')).toContain('Check tests.')
  expect(trashUserSkill('pr-check')).toBe(true)
  expect(existsSync(join(home, '.claude', 'skills', 'pr-check'))).toBe(false)
})

test('rejects bad names, missing description, path tricks', () => {
  expect(() => buildSkill({ name: '../evil', description: 'd', instructions: 'x' })).toThrow('lowercase')
  expect(() => buildSkill({ name: 'ok', description: '', instructions: 'x' })).toThrow('Description')
  expect(() => buildSkill({ raw: 'no frontmatter' })).toThrow('frontmatter')
  expect(readUserSkill('../../etc')).toBeNull()
  expect(trashUserSkill('../x')).toBe(false)
})
