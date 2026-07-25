export type DirectoryBookingMode = 'facility' | 'expert' | 'both'

export interface DirectoryCatalogSelectionCandidate {
  widgetKey: string
  facilityKey: string
  bookingMode: DirectoryBookingMode
  fixedExpertId: string | null
  expertIds: string[]
}

export interface DirectoryBookableExpert {
  expertId: string
  serviceKeys: string[]
}

interface SelectedWidget {
  widgetKey: string
  score: number
}

function candidateWins(current: SelectedWidget | undefined, candidate: SelectedWidget): boolean {
  return !current
    || candidate.score > current.score
    || (
      candidate.score === current.score
      && candidate.widgetKey.localeCompare(current.widgetKey) < 0
    )
}

function facilityWidgetScore(catalog: DirectoryCatalogSelectionCandidate): number {
  if (!catalog.fixedExpertId && catalog.bookingMode === 'facility') return 40
  if (!catalog.fixedExpertId && catalog.bookingMode === 'both') return 30
  if (!catalog.fixedExpertId) return 20
  return 10
}

function expertWidgetScore(
  catalog: DirectoryCatalogSelectionCandidate,
  expertId: string,
): number {
  if (catalog.fixedExpertId === expertId) return 40
  if (catalog.bookingMode === 'expert') return 30
  if (catalog.bookingMode === 'both') return 20
  return 0
}

function catalogCanBookExpert(
  catalog: DirectoryCatalogSelectionCandidate,
  expertId: string,
): boolean {
  if (catalog.fixedExpertId) return catalog.fixedExpertId === expertId
  return catalog.bookingMode === 'expert' || catalog.bookingMode === 'both'
}

export function selectBookableCatalogEntries<
  Service extends { key: string },
  Expert extends DirectoryBookableExpert,
>(
  services: Service[],
  experts: Expert[],
  fixedExpertId: string | null,
): { services: Service[], experts: Expert[] } | null {
  const eligibleExperts = (fixedExpertId
    ? experts.filter(expert => expert.expertId === fixedExpertId)
    : experts
  ).filter(expert => expert.serviceKeys.length > 0)
  const bookableServiceKeys = new Set(
    eligibleExperts.flatMap(expert => expert.serviceKeys),
  )
  const bookableServices = services.filter(service => (
    bookableServiceKeys.has(service.key)
  ))

  if (!eligibleExperts.length || !bookableServices.length) return null
  return {
    services: bookableServices,
    experts: eligibleExperts,
  }
}

export function selectDirectorySourceKeys(
  catalogs: DirectoryCatalogSelectionCandidate[],
): {
  facilityWidgetKeys: Map<string, string>
  expertWidgetKeys: Map<string, string>
} {
  const facilities = new Map<string, SelectedWidget>()
  const experts = new Map<string, SelectedWidget>()

  for (const catalog of catalogs) {
    const facilityCandidate = {
      widgetKey: catalog.widgetKey,
      score: facilityWidgetScore(catalog),
    }
    if (candidateWins(facilities.get(catalog.facilityKey), facilityCandidate)) {
      facilities.set(catalog.facilityKey, facilityCandidate)
    }

    for (const expertId of catalog.expertIds) {
      if (!catalogCanBookExpert(catalog, expertId)) continue
      const expertCandidate = {
        widgetKey: catalog.widgetKey,
        score: expertWidgetScore(catalog, expertId),
      }
      if (candidateWins(experts.get(expertId), expertCandidate)) {
        experts.set(expertId, expertCandidate)
      }
    }
  }

  return {
    facilityWidgetKeys: new Map(
      [...facilities].map(([facilityId, selection]) => [
        facilityId,
        selection.widgetKey,
      ]),
    ),
    expertWidgetKeys: new Map(
      [...experts].map(([expertId, selection]) => [
        expertId,
        selection.widgetKey,
      ]),
    ),
  }
}
