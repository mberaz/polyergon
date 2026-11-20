import { join } from 'path'

// Where every server-side store lives. POLYERGON_DATA_DIR lets a second
// instance (e.g. a dev copy on another port) run without touching prod data.
export const DATA_DIR = process.env.POLYERGON_DATA_DIR || join(process.env.HOME!, '.claude-session-manager')
