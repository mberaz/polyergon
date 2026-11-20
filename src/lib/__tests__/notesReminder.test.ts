import type { Note } from '../notesStore'
import { findDueReminder } from '../reminders'

const n = (id: string, remindAt?: number, reminderDone?: boolean): Note =>
  ({ id, text: id, createdAt: 0, remindAt, reminderDone })

test('returns the due, unfired reminder and skips future/fired/unset ones', () => {
  const now = 1_000_000
  const notes = [n('unset'), n('future', now + 1), n('fired', now - 1, true), n('due', now - 1), n('due2', now)]
  expect(findDueReminder(notes, now)?.id).toBe('due')
  expect(findDueReminder([n('future', now + 1)], now)).toBeNull()
  expect(findDueReminder([n('exact', now)], now)?.id).toBe('exact')
})
