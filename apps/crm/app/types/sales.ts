export type SalesRangeKey = '30d' | '90d' | '12m'

export interface SalesComparisonMetric {
  current: number
  previous: number
  changeValue: number | null
  changeKind: 'percent' | 'points'
}

export interface SalesTrendPoint {
  date: string
  periodEnd: string
  wonCount: number
}

export interface SalesCategorySummary {
  domain: string
  label: string
  wonCount: number
  wonVolume: number
  pipelineCount: number
  pipelineVolume: number
}

export interface SalesPipelineStage {
  statusCode: string
  count: number
  share: number
}

export interface SalesRecentWin {
  id: string
  caseId: string
  caseTitle: string
  clientName: string
  productName: string
  title: string
  statusCode: string
  amountValue: number
  currency: string
  paidCommission: number
  wonAt: string
}

export interface SalesScope {
  type: 'user' | 'team'
  id: string
  label: string
  memberCount: number
}

export interface SalesPayload {
  data: {
    currentUserId: string
    scope?: SalesScope
    generatedAt: string
    range: {
      key: SalesRangeKey
      label: string
      from: string
      to: string
      previousFrom: string
      previousTo: string
    }
    currency: string
    availableCurrencies: string[]
    summary: {
      wonCount: SalesComparisonMetric
      lostCount: SalesComparisonMetric
      conversionRate: SalesComparisonMetric
      pipelineCount: number
    }
    commissions: {
      expected: number
      due: number
      paid: number
      outstanding: number
    }
    trend: SalesTrendPoint[]
    categories: SalesCategorySummary[]
    pipeline: SalesPipelineStage[]
    recentWins: SalesRecentWin[]
  }
}
