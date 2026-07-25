export function firstAvailableImageSource(
  candidates: readonly (string | null | undefined)[],
  failedSources: ReadonlySet<string>,
): string | null {
  return candidates.find((source): source is string => Boolean(
    source && !failedSources.has(source),
  )) ?? null
}

export function withFailedImageSource(
  failedSources: ReadonlySet<string>,
  source: string | null | undefined,
): Set<string> {
  return source
    ? new Set([...failedSources, source])
    : new Set(failedSources)
}
