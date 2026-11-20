import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listTasks, addTask, updateTask, removeTask } from '../taskStore'

test('add, link a session, finish and remove a task', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tasks-')), 'tasks.json')
  const t = addTask({ title: '  Fix login  ', details: 'Users get 500', cwd: '/repo', worktree: true, orgId: 'default' }, f)
  expect(t).toMatchObject({ title: 'Fix login', liveId: null, done: false, worktree: true })
  expect(updateTask(t.id, { liveId: 'L1' }, f)?.liveId).toBe('L1')
  expect(updateTask(t.id, { done: true }, f)?.doneAt).toBeGreaterThan(0)
  expect(updateTask(t.id, { done: false }, f)?.doneAt).toBeUndefined()
  removeTask(t.id, f)
  expect(listTasks(f)).toEqual([])
})
