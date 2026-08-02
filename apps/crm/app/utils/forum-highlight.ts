export interface ForumTextSegment {
  text: string
  highlighted: boolean
}

export function forumHighlightedSegments(value: string, query: string): ForumTextSegment[] {
  const tokens = [...new Set(
    query
      .trim()
      .split(/\s+/u)
      .map(token => token.replace(/[^\p{L}\p{N}-]/gu, ''))
      .filter(token => token.length >= 3),
  )]
  if (!tokens.length) return [{ text: value, highlighted: false }]

  const pattern = tokens
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|')
  if (!pattern) return [{ text: value, highlighted: false }]

  const expression = new RegExp(`(${pattern})`, 'giu')
  return value
    .split(expression)
    .map((text, index) => ({
      text,
      highlighted: index % 2 === 1,
    }))
    .filter(segment => segment.text.length > 0)
}
