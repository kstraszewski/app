const INTERNAL_ORIGIN = 'https://openexpert.invalid'

export function reauthenticationRedirect(fullPath: string, resume?: string): string {
  const destination = new URL(fullPath, INTERNAL_ORIGIN)
  if (resume) destination.searchParams.set('resume', resume)
  return `${destination.pathname}${destination.search}${destination.hash}`
}
