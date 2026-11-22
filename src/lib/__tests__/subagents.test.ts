import { mkdtempSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listSubagents, subagentFile } from '../subagents'

describe('subagents', () => {
  it('lists newest first with meta and running state, rejects bad ids', () => {
    const d = mkdtempSync(join(tmpdir(), 'sub-'))
    writeFileSync(join(d, 'agent-a1.jsonl'), '{}\n'); writeFileSync(join(d, 'agent-a1.meta.json'), '{"agentType":"Explore","description":"Find X"}')
    writeFileSync(join(d, 'agent-b2.jsonl'), '{}\n'); utimesSync(join(d, 'agent-b2.jsonl'), 1, 1)
    writeFileSync(join(d, 'notes.txt'), '')
    const l = listSubagents(d)
    expect(l.map(a => a.id)).toEqual(['a1', 'b2'])
    expect(l[0]).toMatchObject({ type: 'Explore', description: 'Find X', running: true })
    expect(l[1]).toMatchObject({ type: 'agent', running: false })
    expect(listSubagents(join(d, 'missing'))).toEqual([])
    expect(subagentFile(d, '../x')).toBeNull()
  })
})
