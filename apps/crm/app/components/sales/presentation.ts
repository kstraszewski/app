import type { SalesComparisonMetric } from '~/types/sales'

export type SalesMetricTone = 'neutral' | 'positive' | 'negative'

const categoryIcons: Record<string, string> = {
  credit: 'i-lucide-landmark',
  insurance: 'i-lucide-shield-check',
  real_estate: 'i-lucide-house',
  other: 'i-lucide-package',
}

const statusLabels: Record<string, string> = {
  kwalifikacja: 'Kwalifikacja',
  dokumenty: 'Dokumenty',
  oferty: 'Oferty',
  wybrana_oferta: 'Wybrana oferta',
  wnioski_wyslane: 'Wnioski wysłane',
  decyzja: 'Decyzja',
  umowa: 'Umowa',
  analiza_potrzeb: 'Analiza potrzeb',
  polisa_wystawiona: 'Polisa wystawiona',
  odnowienie: 'Odnowienie',
  przyjecie: 'Przyjęcie',
  poszukiwanie_lub_listing: 'Poszukiwanie lub listing',
  prezentacje: 'Prezentacje',
  negocjacje: 'Negocjacje',
  bez_statusu: 'Bez statusu',
}

export function formatSalesNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits }).format(value)
}

export function formatSalesCurrency(value: number, currency: string) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatSalesDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date).replace('.', '')
}

export function salesComparisonLabel(metric: SalesComparisonMetric) {
  if (metric.changeValue === null) return 'Brak okresu porównawczego'

  const sign = metric.changeValue > 0 ? '+' : ''
  const suffix = metric.changeKind === 'points' ? ' pp' : '%'
  return `${sign}${formatSalesNumber(metric.changeValue, 1)}${suffix} vs poprzedni okres`
}

export function salesComparisonTone(metric: SalesComparisonMetric): SalesMetricTone {
  if (metric.changeValue === null || metric.changeValue === 0) return 'neutral'
  return metric.changeValue > 0 ? 'positive' : 'negative'
}

export function salesCategoryIcon(domain: string) {
  return categoryIcons[domain] ?? categoryIcons.other
}

export function salesStatusLabel(status: string) {
  if (statusLabels[status]) return statusLabels[status]

  return status
    .split('_')
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Bez statusu'
}

export function salesPipelineStatusColor(status: string): 'neutral' | 'info' | 'warning' {
  if (['dokumenty', 'decyzja', 'negocjacje', 'wybrana_oferta'].includes(status)) return 'warning'
  if (['oferty', 'prezentacje', 'poszukiwanie_lub_listing'].includes(status)) return 'info'
  return 'neutral'
}
