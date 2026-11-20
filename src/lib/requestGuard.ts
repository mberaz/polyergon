// Polyergon drives shells with permission checks off, so only the app's own
// pages may talk to it. Blocks other websites (cross-site WebSocket / CSRF via
// the Origin header) and DNS rebinding (via the Host header).
const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'polyergon']

export function allowedHosts(): string[] {
  const extra = (process.env.POLYERGON_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean)
  return [...DEFAULT_HOSTS, ...extra]
}

function hostname(hostHeader: string): string {
  return hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0]
}

export function isAllowedRequest(headers: { host?: string; origin?: string }, hosts = allowedHosts()): boolean {
  if (!headers.host || !hosts.includes(hostname(headers.host).toLowerCase())) return false
  if (!headers.origin) return true // same-origin GETs and non-browser clients send none
  try {
    return hosts.includes(hostname(new URL(headers.origin).host).toLowerCase())
  } catch { return false }
}
