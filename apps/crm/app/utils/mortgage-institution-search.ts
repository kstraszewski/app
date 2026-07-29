export type InstitutionAliasKind =
  | 'former_name'
  | 'short_name'
  | 'legal_name'
  | 'former_domain'
  | 'search_term'

export type InstitutionSearchAlias = {
  name: string
  kind: InstitutionAliasKind
  validFrom?: string | null
  validTo?: string | null
}

export type InstitutionSearchable = {
  id: string
  name: string
  baseName?: string | null
  slug?: string | null
  websiteUrl?: string | null
  baseWebsiteUrl?: string | null
  aliases?: InstitutionSearchAlias[]
}

export type InstitutionSearchSource =
  | 'name'
  | 'base_name'
  | InstitutionAliasKind
  | 'slug'
  | 'website'

export type InstitutionSearchMatch = {
  source: InstitutionSearchSource
  label: string
}

export type InstitutionSearchHit<T extends InstitutionSearchable> = {
  item: T
  score: number
  matchedOn: InstitutionSearchMatch | null
}

type SearchField = InstitutionSearchMatch & {
  normalized: string
  compact: string
  tokens: string[]
  weight: number
}

type TokenMatch = {
  score: number
  field: SearchField
}

const aliasWeights: Record<InstitutionAliasKind, number> = {
  former_name: 130,
  short_name: 125,
  legal_name: 120,
  former_domain: 112,
  search_term: 105,
}

const polishSearchCollator = new Intl.Collator('pl', {
  sensitivity: 'base',
  numeric: true,
})

export function normalizeInstitutionSearch(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[łŁ]/gu, match => match === 'Ł' ? 'L' : 'l')
    .toLocaleLowerCase('pl-PL')
    .replace(/^https?:\/\//u, '')
    .replace(/^www\./u, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function compact(value: string) {
  return value.replace(/\s+/gu, '')
}

function editDistance(left: string, right: string, maxDistance: number) {
  if (left === right) return 0
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1

  let previousPrevious = Array.from({ length: right.length + 1 }, (_, index) => index)
  let previous = [...previousPrevious]

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    let rowMinimum = current[0]!

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      let distance = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      )

      if (
        leftIndex > 1
        && rightIndex > 1
        && left[leftIndex - 1] === right[rightIndex - 2]
        && left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2]! + 1)
      }

      current[rightIndex] = distance
      rowMinimum = Math.min(rowMinimum, distance)
    }

    if (rowMinimum > maxDistance) return maxDistance + 1
    previousPrevious = previous
    previous = current
  }

  return previous[right.length]!
}

function fuzzyDistanceLimit(token: string) {
  if (token.length >= 8) return 2
  if (token.length >= 4) return 1
  return 0
}

function tokenScore(queryToken: string, candidateToken: string) {
  if (candidateToken === queryToken) return 170
  if (queryToken.length >= 2 && candidateToken.startsWith(queryToken)) {
    return 150 - Math.min(candidateToken.length - queryToken.length, 20)
  }
  if (queryToken.length >= 3 && candidateToken.includes(queryToken)) return 122
  if (candidateToken.length >= 3 && queryToken.includes(candidateToken)) return 104

  const distanceLimit = fuzzyDistanceLimit(queryToken)
  if (!distanceLimit || candidateToken.length < 3) return -1

  const distance = editDistance(queryToken, candidateToken, distanceLimit)
  return distance <= distanceLimit ? 112 - distance * 24 : -1
}

function createField(
  source: InstitutionSearchSource,
  label: unknown,
  weight: number,
): SearchField | null {
  const stringLabel = String(label ?? '').trim()
  const normalized = normalizeInstitutionSearch(stringLabel)
  if (!normalized) return null

  return {
    source,
    label: stringLabel,
    normalized,
    compact: compact(normalized),
    tokens: normalized.split(' '),
    weight,
  }
}

function searchableFields(item: InstitutionSearchable) {
  const fields: Array<SearchField | null> = [
    createField('name', item.name, 160),
    normalizeInstitutionSearch(item.baseName) !== normalizeInstitutionSearch(item.name)
      ? createField('base_name', item.baseName, 140)
      : null,
    ...(item.aliases ?? []).map(alias => createField(alias.kind, alias.name, aliasWeights[alias.kind])),
    createField('slug', item.slug, 112),
    createField('website', item.websiteUrl, 98),
    normalizeInstitutionSearch(item.baseWebsiteUrl) !== normalizeInstitutionSearch(item.websiteUrl)
      ? createField('website', item.baseWebsiteUrl, 94)
      : null,
  ]

  return fields.filter((field): field is SearchField => Boolean(field))
}

function bestDirectMatch(query: string, fields: SearchField[]) {
  const queryCompact = compact(query)
  let best: { score: number, field: SearchField } | null = null

  for (const field of fields) {
    let score = -1
    if (field.normalized === query) score = 1_000 + field.weight
    else if (field.compact === queryCompact) score = 970 + field.weight
    else if (field.normalized.startsWith(query)) score = 900 + field.weight
    else if (query.length >= 3 && field.normalized.includes(query)) score = 820 + field.weight

    if (score >= 0 && (!best || score > best.score)) best = { score, field }
  }

  return best
}

function bestTokenMatch(queryToken: string, fields: SearchField[]) {
  let best: TokenMatch | null = null

  for (const field of fields) {
    for (const candidateToken of field.tokens) {
      const score = tokenScore(queryToken, candidateToken)
      const weightedScore = score < 0 ? -1 : score + field.weight
      if (weightedScore >= 0 && (!best || weightedScore > best.score)) {
        best = { score: weightedScore, field }
      }
    }
  }

  return best
}

export function searchInstitutions<T extends InstitutionSearchable>(
  items: readonly T[],
  rawQuery: unknown,
): InstitutionSearchHit<T>[] {
  const query = normalizeInstitutionSearch(rawQuery)
  if (!query) {
    return items.map(item => ({ item, score: 0, matchedOn: null }))
  }

  const queryTokens = query.split(' ')
  const hits: InstitutionSearchHit<T>[] = []

  for (const item of items) {
    const fields = searchableFields(item)
    const direct = bestDirectMatch(query, fields)
    const tokenMatches = queryTokens.map(token => bestTokenMatch(token, fields))

    if (!direct && tokenMatches.some(match => !match)) continue

    const tokenScoreTotal = tokenMatches.reduce((total, match) => total + (match?.score ?? 0), 0)
    const tokenAverage = tokenScoreTotal / Math.max(tokenMatches.length, 1)
    const tokenResult = tokenMatches.length
      ? {
          score: 480 + tokenAverage,
          field: tokenMatches.reduce(
            (best, match) => !best || (match?.score ?? -1) > best.score ? match : best,
            null as TokenMatch | null,
          )?.field,
        }
      : null
    const winner = direct && (!tokenResult || direct.score >= tokenResult.score)
      ? direct
      : tokenResult?.field
        ? { score: tokenResult.score, field: tokenResult.field }
        : null

    if (!winner) continue
    hits.push({
      item,
      score: winner.score,
      matchedOn: {
        source: winner.field.source,
        label: winner.field.label,
      },
    })
  }

  return hits.sort((left, right) => (
    right.score - left.score
    || polishSearchCollator.compare(left.item.name, right.item.name)
  ))
}
