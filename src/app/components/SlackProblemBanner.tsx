'use client'
import type { SlackProblem } from '@/lib/slackBridge'

// Event the page listens for: opens a new session in the org running /mcp
export const CONNECT_SLACK_EVENT = 'polyergon:connect-slack'
export const connectSlack = () => window.dispatchEvent(new Event(CONNECT_SLACK_EVENT))

const COPY: Record<SlackProblem, { title: (org: string) => string; why: string; fix: string }> = {
  auth: {
    title: org => `Slack isn't signed in for ${org}`,
    why: "Polyergon's background checks use this org's \"claude.ai Slack\" connector, and it isn't signed in. (A Slack plugin working in your sessions doesn't cover background runs.)",
    fix: 'Click Connect Slack: a new session opens in this org with /mcp. Choose "claude.ai Slack" and sign in, then come back and Retry.',
  },
  missing: {
    title: org => `Slack isn't set up for ${org}`,
    why: "This org's Claude setup has no Slack connector, so Polyergon can't read or post to Slack for it.",
    fix: 'Add the Slack connector to this org (claude.ai → Settings → Connectors, or /mcp in a session of this org), then Retry.',
  },
  other: {
    title: () => "Couldn't reach Slack",
    why: 'Slack or the connector returned an error.',
    fix: 'Retry in a minute. If it keeps failing, open a session in this org and run /mcp to check the Slack connector.',
  },
}

export function SlackProblemBanner({ problem, detail, org, onRetry, compact = false }: { problem: SlackProblem; detail?: string | null; org: string; onRetry: () => void; compact?: boolean }) {
  const c = COPY[problem] ?? COPY.other
  return (
    <div className={`rounded-lg border border-amber-800/60 bg-amber-950/30 ${compact ? 'px-2.5 py-2 mt-1' : 'px-4 py-3'} text-xs`}>
      <p className={`font-medium text-amber-200 ${compact ? '' : 'text-sm'}`}>{c.title(org)}</p>
      {!compact && <p className="text-gray-300 mt-1">{c.why}</p>}
      <p className="text-gray-400 mt-1">{c.fix}</p>
      {detail && !compact && <p className="text-gray-500 mt-1 italic line-clamp-2">Claude said: {detail}</p>}
      <div className="flex gap-2 mt-2">
        {problem !== 'other' && <button onClick={connectSlack} className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white">Connect Slack</button>}
        <button onClick={onRetry} className="px-2.5 py-1 rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800">Retry</button>
      </div>
    </div>
  )
}
