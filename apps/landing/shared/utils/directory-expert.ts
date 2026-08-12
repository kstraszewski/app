export interface DirectoryExpertRouteSource {
  expertId: string
  name: string
}

const MAX_EXPERT_SLUG_LENGTH = 160
const MAX_EXPERT_SLUG_BASE_LENGTH = 96
const expertSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function compactExpertId(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '')
}

export function directoryExpertSlug(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('pl-PL')
    .replaceAll('ł', 'l')
    .replaceAll('ø', 'o')
    .replaceAll('đ', 'd')
    .replaceAll('ß', 'ss')
    .replaceAll('æ', 'ae')
    .replaceAll('œ', 'oe')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_EXPERT_SLUG_BASE_LENGTH)
    .replace(/-+$/g, '')
    || 'ekspert'
}

/**
 * Produces readable public slugs and adds an ID suffix only when two listed
 * experts have the same normalized name. The server remains the owner of the
 * canonical value; cards only consume the resulting `slug` field.
 */
export function directoryExpertSlugMap(
  experts: readonly DirectoryExpertRouteSource[],
): Map<string, string> {
  const groups = new Map<string, DirectoryExpertRouteSource[]>()

  for (const expert of experts) {
    const base = directoryExpertSlug(expert.name)
    const current = groups.get(base) ?? []
    if (!current.some(candidate => candidate.expertId === expert.expertId)) {
      current.push(expert)
    }
    groups.set(base, current)
  }

  const slugs = new Map<string, string>()
  for (const [base, candidates] of groups) {
    if (candidates.length === 1) {
      slugs.set(candidates[0]!.expertId, base)
      continue
    }

    const ordered = candidates.toSorted((left, right) => (
      left.expertId.localeCompare(right.expertId)
    ))
    const identifiers = ordered.map(expert => (
      compactExpertId(expert.expertId) || 'profil'
    ))
    let suffixLength = Math.min(8, Math.max(...identifiers.map(id => id.length)))
    while (
      new Set(identifiers.map(id => id.slice(0, suffixLength))).size < identifiers.length
      && suffixLength < Math.max(...identifiers.map(id => id.length))
    ) {
      suffixLength += 4
    }

    ordered.forEach((expert, index) => {
      const suffix = identifiers[index]!.slice(0, suffixLength)
      slugs.set(expert.expertId, `${base}-${suffix}`)
    })
  }

  return slugs
}

export function directoryExpertRouteSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim()
  return slug.length > 0
    && slug.length <= MAX_EXPERT_SLUG_LENGTH
    && expertSlugPattern.test(slug)
    ? slug
    : null
}

export function directoryExpertPath(slug: string): string {
  const routeSlug = directoryExpertRouteSlug(slug)
  return routeSlug ? `/eksperci/${routeSlug}` : '/eksperci'
}
