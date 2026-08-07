function cookieNameWithoutSecurityPrefix(name: string) {
  if (name.startsWith('__Secure-')) return name.slice('__Secure-'.length)
  if (name.startsWith('__Host-')) return name.slice('__Host-'.length)
  return name
}

export function filterAuthCookieHeader(cookieHeader: string, cookiePrefix: string) {
  const prefix = cookiePrefix.trim()
  if (!cookieHeader || !prefix) return ''

  return cookieHeader
    .split(';')
    .map(cookie => cookie.trim())
    .filter((cookie) => {
      const separatorIndex = cookie.indexOf('=')
      if (separatorIndex <= 0) return false
      const name = cookieNameWithoutSecurityPrefix(cookie.slice(0, separatorIndex))
      return name === prefix || name.startsWith(`${prefix}.`)
    })
    .join('; ')
}
