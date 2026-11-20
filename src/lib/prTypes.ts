export type PrCheckStatus = 'passing' | 'failing' | 'pending' | 'none'

export interface PrStatus {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  reviewDecision: string | null // 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  checks: PrCheckStatus
  updatedAt: number | null // PR's own GitHub last-updated time (epoch ms), from gh
  fetchedAt: number
}

export interface PrSessionEntry {
  source: 'live' | 'history'
  liveId: string | null // LiveSession.id, when source === 'live'
  sessionId: string | null // claudeSessionId / history sessionId
  orgId: string
  cwd: string | null
  gitRoot: string | null
  prUrl: string
  status: PrStatus | null // null until a refresh has fetched it
  // Fallback "when is this relevant" date (epoch ms) when status.updatedAt
  // isn't known yet (no refresh done) — the session's own creation/activity
  // time, so every entry always has *some* date to sort/display by.
  sessionDate: number
}
