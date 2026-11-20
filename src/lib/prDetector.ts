// Matches PR URLs anywhere in text — used to scan streaming/file content.
const PR_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g

// Anchored form for validating a URL right before it's passed to execFile —
// the URL is substring-extracted from LLM-controlled output, so this is a
// defense-in-depth check against anything that isn't exactly a PR URL.
export const STRICT_PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

// Returns the last match in `text` — a PR opened later in a session
// naturally supersedes an earlier one.
export function extractPrUrl(text: string): string | null {
  const matches = text.match(PR_URL_RE)
  return matches ? matches[matches.length - 1] : null
}
