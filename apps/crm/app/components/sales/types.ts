import type { RouteLocationRaw } from 'vue-router'
import type {
  SalesPayload,
  SalesRangeKey,
  SalesRecentWin,
} from '~/types/sales'

export type SalesData = SalesPayload['data']

export type SalesDashboardStatus = 'idle' | 'pending' | 'success' | 'error'

export type SalesCaseLinkBuilder = (
  item: SalesRecentWin,
) => RouteLocationRaw | undefined

export interface SalesRangeOption {
  label: string
  value: SalesRangeKey
}

export const salesRangeOptions: SalesRangeOption[] = [
  { label: '30 dni', value: '30d' },
  { label: '90 dni', value: '90d' },
  { label: '12 mies.', value: '12m' },
]

export const emptySalesData: SalesData = {
  currentUserId: '',
  generatedAt: '',
  range: {
    key: '90d',
    label: 'Ostatnie 90 dni',
    from: '',
    to: '',
    previousFrom: '',
    previousTo: '',
  },
  currency: 'PLN',
  availableCurrencies: ['PLN'],
  summary: {
    wonCount: { current: 0, previous: 0, changeValue: null, changeKind: 'percent' },
    lostCount: { current: 0, previous: 0, changeValue: null, changeKind: 'percent' },
    conversionRate: { current: 0, previous: 0, changeValue: null, changeKind: 'points' },
    pipelineCount: 0,
  },
  commissions: {
    expected: 0,
    due: 0,
    paid: 0,
    outstanding: 0,
  },
  trend: [],
  categories: [],
  pipeline: [],
  recentWins: [],
}
