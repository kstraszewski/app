<script setup lang="ts">
import type { SalesPayload, SalesRangeKey, SalesRecentWin } from '~/types/sales'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Moja sprzedaż — OpenExpert CRM' })

const route = useRoute()
const router = useRouter()
const { crmApiPath, orgPath } = useOrganizationContext()

const selectedRange = computed<SalesRangeKey>(() => {
  const value = Array.isArray(route.query.range) ? route.query.range[0] : route.query.range
  return value === '30d' || value === '12m' ? value : '90d'
})

const requestedCurrency = computed(() => {
  const value = Array.isArray(route.query.currency) ? route.query.currency[0] : route.query.currency
  return typeof value === 'string' && /^[a-z]{3}$/i.test(value)
    ? value.toUpperCase()
    : undefined
})

const {
  data: salesPayload,
  status,
  error,
  refresh,
} = await useFetch<SalesPayload>(() => crmApiPath('/sales'), {
  query: {
    range: selectedRange,
    currency: requestedCurrency,
  },
  lazy: true,
})

function updateQuery(patch: Record<string, string | undefined>) {
  const query = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) delete query[key]
  }
  return router.replace({ query })
}

function selectRange(range: SalesRangeKey) {
  void updateQuery({ range: range === '90d' ? undefined : range })
}

function selectCurrency(currency: string) {
  void updateQuery({ currency })
}

function caseLink(item: SalesRecentWin) {
  return orgPath(`/cases/${item.caseId}`)
}
</script>

<template>
  <CrmShell
    title="Moja sprzedaż"
    eyebrow="Wyniki eksperta"
    description="Skuteczność, pipeline i prowizje produktów aktualnie przypisanych do Ciebie."
  >
    <SalesDashboard
      :data="salesPayload?.data"
      :status="status"
      :error="error"
      :range="selectedRange"
      context-label="Twój portfel"
      context-description="Wyniki produktów, za które odpowiadasz jako ekspert."
      commissions-title="Twoje prowizje"
      :cases-to="orgPath('/cases')"
      :case-to="caseLink"
      @update:range="selectRange"
      @update:currency="selectCurrency"
      @refresh="refresh"
    />
  </CrmShell>
</template>
