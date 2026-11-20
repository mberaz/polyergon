// Browser-side: the org selected in the switcher, so Slack/skills calls run
// against that org's Claude setup. 'all' → Default.
let current = 'default'
export function setActiveOrg(id: string) { current = id === 'all' ? 'default' : id }
export function withOrg(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}org=${encodeURIComponent(current)}`
}
