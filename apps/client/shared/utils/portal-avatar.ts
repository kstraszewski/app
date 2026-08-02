const bundledExpertAvatarPattern = /^\/avatars\/experts\/[a-z0-9][a-z0-9-]*\.webp$/iu

export function resolvePortalAvatarUrl(
  value: unknown,
  publicAssetBaseUrl: string,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return null

  try {
    const absoluteUrl = new URL(normalized)
    return absoluteUrl.protocol === 'https:' ? absoluteUrl.toString() : null
  }
  catch {
    if (!bundledExpertAvatarPattern.test(normalized)) return null

    try {
      const assetUrl = new URL(normalized, publicAssetBaseUrl)
      return assetUrl.protocol === 'https:' ? assetUrl.toString() : null
    }
    catch {
      return null
    }
  }
}
