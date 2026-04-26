<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const caseId = computed(() => String(route.params.id))
const toast = useToast()

const itemForm = reactive({
  product_type_id: '',
  title: '',
  amount_value: '',
  settlement_expected_amount: '',
})
const submissionForm = reactive({
  case_item_id: '',
  provider_id: '',
  notes: '',
})
const savingItem = ref(false)
const savingSubmission = ref(false)

const { data, pending, refresh } = await useFetch<{ data: Record<string, any> }>(
  () => `/api/crm/cases/${caseId.value}`,
  { default: () => ({ data: { items: [], client: {}, activities: [], tasks: [], documents: [], properties: [] } }) },
)

const { data: productTypes } = await useFetch<{ data: Array<Record<string, any>> }>('/api/crm/product-types', {
  default: () => ({ data: [] }),
})
const { data: providers } = await useFetch<{ data: Array<Record<string, any>> }>('/api/crm/providers', {
  default: () => ({ data: [] }),
})

const productTypeItems = computed(() => productTypes.value.data.map((item) => ({
  label: `${item.name} · ${domainLabel(item.domain)}`,
  value: item.id,
})))

const providerItems = computed(() => providers.value.data.map((item) => ({
  label: `${item.name} · ${providerLabel(item.kind)}`,
  value: item.id,
})))

const itemItems = computed(() => (data.value.data.items ?? []).map((item: Record<string, any>) => ({
  label: item.title,
  value: item.id,
})))

useHead(() => ({ title: `${data.value.data?.title || 'Sprawa'} — OpenExpert CRM` }))

function domainLabel(domain: string) {
  return {
    credit: 'kredyt',
    insurance: 'ubezpieczenie',
    real_estate: 'nieruchomość',
    other: 'inne',
  }[domain] ?? domain
}

function providerLabel(kind: string) {
  return {
    bank: 'bank',
    insurer: 'ubezpieczyciel',
    agency: 'agencja',
    developer: 'deweloper',
    broker: 'partner',
    other: 'inne',
  }[kind] ?? kind
}

async function createItem() {
  if (!itemForm.product_type_id) return
  savingItem.value = true
  try {
    await $fetch(`/api/crm/cases/${caseId.value}/items`, {
      method: 'POST',
      body: {
        product_type_id: itemForm.product_type_id,
        title: itemForm.title || undefined,
        amount_value: itemForm.amount_value || undefined,
        settlement_expected_amount: itemForm.settlement_expected_amount || undefined,
      },
    })
    itemForm.product_type_id = ''
    itemForm.title = ''
    itemForm.amount_value = ''
    itemForm.settlement_expected_amount = ''
    await refresh()
    toast.add({ title: 'Dodano produkt', color: 'success' })
  } finally {
    savingItem.value = false
  }
}

async function createSubmission() {
  if (!submissionForm.case_item_id) return
  savingSubmission.value = true
  try {
    await $fetch(`/api/crm/items/${submissionForm.case_item_id}/submissions`, {
      method: 'POST',
      body: {
        provider_id: submissionForm.provider_id || undefined,
        notes: submissionForm.notes || undefined,
      },
    })
    submissionForm.case_item_id = ''
    submissionForm.provider_id = ''
    submissionForm.notes = ''
    await refresh()
    toast.add({ title: 'Dodano zgłoszenie', color: 'success' })
  } finally {
    savingSubmission.value = false
  }
}

async function updateItemStatus(item: Record<string, any>, status: string) {
  await $fetch(`/api/crm/items/${item.id}/status`, {
    method: 'PATCH',
    body: { status_code: status },
  })
  await refresh()
}

const itemStatusOptions = [
  { label: 'Kwalifikacja', value: 'kwalifikacja' },
  { label: 'Dokumenty', value: 'dokumenty' },
  { label: 'Oferty', value: 'oferty' },
  { label: 'Wnioski wyslane', value: 'wnioski_wyslane' },
  { label: 'Decyzja', value: 'decyzja' },
  { label: 'Umowa', value: 'umowa' },
  { label: 'Uruchomiony', value: 'uruchomiony' },
  { label: 'Analiza potrzeb', value: 'analiza_potrzeb' },
  { label: 'Polisa wystawiona', value: 'polisa_wystawiona' },
  { label: 'Aktywna', value: 'aktywna' },
  { label: 'Utracona', value: 'utracona' },
]
</script>

<template>
  <CrmShell :title="data.data?.title || 'Sprawa'" eyebrow="Karta sprawy">
    <template #actions>
      <UButton :to="data.data?.client?.id ? `/clients/${data.data.client.id}` : '/clients'" icon="i-lucide-user" variant="outline">
        Klient
      </UButton>
      <UButton to="/cases" icon="i-lucide-arrow-left" variant="outline">
        Sprawy
      </UButton>
    </template>

    <div v-if="pending" class="case-detail-grid">
      <USkeleton class="h-96 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <div v-else class="case-detail-grid">
      <div class="stack">
        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Overview</h2>
                <p>{{ data.data?.client?.display_name || 'Brak klienta' }}</p>
              </div>
              <CrmStatusBadge :status="data.data?.status_code" />
            </div>
          </template>

          <div class="info-grid">
            <span>Priorytet</span>
            <strong>{{ data.data?.priority }}</strong>
            <span>Postęp</span>
            <strong>{{ data.data?.progress_percent || 0 }}%</strong>
            <span>Otwarto</span>
            <strong>{{ data.data?.opened_at ? new Date(data.data.opened_at).toLocaleDateString('pl-PL') : '—' }}</strong>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Produkty i wnioski</h2>
                <p>Każdy produkt ma osobny status, zgłoszenia i rozliczenie.</p>
              </div>
            </div>
          </template>

          <div v-if="data.data?.items?.length" class="item-list">
            <div v-for="item in data.data.items" :key="item.id" class="item-card">
              <div class="item-card__top">
                <div>
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.amount_value ? `${Number(item.amount_value).toLocaleString('pl-PL')} ${item.currency}` : 'Brak wartości' }}</span>
                </div>
                <USelect
                  :model-value="item.status_code"
                  :items="itemStatusOptions"
                  class="status-select"
                  @update:model-value="(status) => updateItemStatus(item, String(status))"
                />
              </div>

              <div class="item-card__meta">
                <CrmStatusBadge :status="item.settlement?.status_code || 'szacowane'" />
                <span>Oczekiwane: {{ Number(item.settlement?.expected_amount || 0).toLocaleString('pl-PL') }} PLN</span>
                <span>Zgłoszenia: {{ item.submissions?.length || 0 }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-line">Dodaj pierwszy produkt do sprawy.</div>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Timeline</h2>
                <p>Historia statusów, notatek i zmian.</p>
              </div>
            </div>
          </template>

          <div v-if="data.data?.activities?.length" class="activity-list">
            <div v-for="activity in data.data.activities" :key="activity.id" class="activity-row">
              <span />
              <div>
                <strong>{{ activity.title }}</strong>
                <p>{{ activity.body || activity.activity_type }}</p>
              </div>
            </div>
          </div>
          <div v-else class="empty-line">Brak historii sprawy.</div>
        </UCard>
      </div>

      <div class="stack">
        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Dodaj produkt</h2>
                <p>Kredyt, ubezpieczenie albo nieruchomość.</p>
              </div>
            </div>
          </template>

          <form class="side-form" @submit.prevent="createItem">
            <UFormField label="Typ produktu">
              <USelect v-model="itemForm.product_type_id" :items="productTypeItems" placeholder="Wybierz typ" />
            </UFormField>
            <UFormField label="Tytuł">
              <UInput v-model="itemForm.title" placeholder="Kredyt hipoteczny + polisa" />
            </UFormField>
            <UFormField label="Wartość">
              <UInput v-model="itemForm.amount_value" type="number" min="0" placeholder="820000" />
            </UFormField>
            <UFormField label="Prowizja oczekiwana">
              <UInput v-model="itemForm.settlement_expected_amount" type="number" min="0" placeholder="8200" />
            </UFormField>
            <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="savingItem">
              Dodaj produkt
            </UButton>
          </form>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Dodaj zgłoszenie</h2>
                <p>Osobny status dla banku, ubezpieczyciela lub partnera.</p>
              </div>
            </div>
          </template>

          <form class="side-form" @submit.prevent="createSubmission">
            <UFormField label="Produkt">
              <USelect v-model="submissionForm.case_item_id" :items="itemItems" placeholder="Wybierz produkt" />
            </UFormField>
            <UFormField label="Instytucja">
              <USelect v-model="submissionForm.provider_id" :items="providerItems" placeholder="Opcjonalnie" />
            </UFormField>
            <UFormField label="Notatka">
              <UTextarea v-model="submissionForm.notes" :rows="3" />
            </UFormField>
            <UButton type="submit" icon="i-lucide-send" variant="solid" :loading="savingSubmission">
              Dodaj zgłoszenie
            </UButton>
          </form>
        </UCard>
      </div>
    </div>
  </CrmShell>
</template>

<style scoped>
.case-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 24px;
}

.stack,
.side-form,
.item-list,
.activity-list {
  display: grid;
  gap: 12px;
}

.panel-head,
.item-card__top,
.item-card__meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-head h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.panel-head p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.info-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px 16px;
  font-size: 14px;
}

.info-grid span,
.item-card__top span,
.item-card__meta,
.activity-row p,
.empty-line {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.info-grid strong,
.item-card__top strong,
.activity-row strong {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.item-card {
  display: grid;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.item-card:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.item-card__meta {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.status-select {
  width: 190px;
}

.activity-row {
  display: flex;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.activity-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.activity-row > span {
  width: 8px;
  height: 8px;
  margin-top: 7px;
  border-radius: 999px;
  background: var(--ui-text-muted);
}

@media (max-width: 980px) {
  .case-detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>

