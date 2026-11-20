import type { Org } from './orgRegistry'

// Which Claude org does a GitHub repo (owner/name) belong to?
// - 'all' matches everything.
// - An org with githubOrgs matches owners on its list.
// - An org with no githubOrgs owns every owner no other org has claimed.
export function repoInOrg(repo: string, activeOrgId: string, orgs: Org[]): boolean {
  if (activeOrgId === 'all') return true
  const owner = (repo.split('/')[0] ?? '').toLowerCase()
  const active = orgs.find(o => o.id === activeOrgId)
  const activeOwners = (active?.githubOrgs ?? []).map(s => s.toLowerCase())
  if (activeOwners.length > 0) return activeOwners.includes(owner)
  const claimed = new Set(
    orgs.filter(o => o.id !== activeOrgId).flatMap(o => o.githubOrgs ?? []).map(s => s.toLowerCase())
  )
  return !claimed.has(owner)
}
