export const CRM_CALCULATOR_PATHS = {
  capacity: '/calculator/capacity',
  mortgages: '/calculator/mortgages',
} as const

export interface CrmNavigationTarget {
  to: string
  activePaths?: string[]
  exact?: boolean
}

export function isCrmNavigationPathActive(currentPath: string, item: CrmNavigationTarget) {
  const paths = item.activePaths ?? [item.to]

  return paths.some(path => (
    currentPath === path
    || currentPath === `${path}/`
    || (!item.exact && currentPath.startsWith(`${path}/`))
  ))
}
