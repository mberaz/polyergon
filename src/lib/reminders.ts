import type { Note } from './notesStore'

// Client-safe (no fs import — notesStore.ts is server-only and can't be
// bundled into components). First note whose reminder is due and not yet
// fired; shared by the Sidebar's 30s tick and the test.
export function findDueReminder(notes: Note[], now = Date.now()): Note | null {
  return notes.find(n => n.remindAt !== undefined && n.remindAt <= now && !n.reminderDone) ?? null
}
