<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Ustawienia — OpenExpert CRM' })

const { crmApiPath } = useOrganizationContext()

const toast = useToast()
const productForm = reactive({
  domain: 'credit',
  name: '',
  code: '',
  description: '',
})
const providerForm = reactive({
  kind: 'bank',
  name: '',
  contact_email: '',
  contact_phone: '',
})
const savingProduct = ref(false)
const savingProvider = ref(false)

const { data: productTypes, refresh: refreshProductTypes } = await useFetch<{ data: Array<Record<string, any>> }>(() => crmApiPath('/product-types'), {
  default: () => ({ data: [] }),
})
const { data: workflows } = await useFetch<{ data: Array<Record<string, any>> }>(() => crmApiPath('/workflows'), {
  default: () => ({ data: [] }),
})
const { data: providers, refresh: refreshProviders } = await useFetch<{ data: Array<Record<string, any>> }>(() => crmApiPath('/providers'), {
  default: () => ({ data: [] }),
})

const domainItems = [
  { label: 'Kredyty', value: 'credit' },
  { label: 'Ubezpieczenia', value: 'insurance' },
  { label: 'Nieruchomości', value: 'real_estate' },
  { label: 'Inne', value: 'other' },
]

const providerKindItems = [
  { label: 'Bank', value: 'bank' },
  { label: 'Ubezpieczyciel', value: 'insurer' },
  { label: 'Agencja', value: 'agency' },
  { label: 'Deweloper', value: 'developer' },
  { label: 'Partner', value: 'broker' },
  { label: 'Inne', value: 'other' },
]

function domainLabel(domain: string) {
  return domainItems.find((item) => item.value === domain)?.label ?? domain
}

async function createProductType() {
  if (!productForm.name.trim()) return
  savingProduct.value = true
  try {
    await $fetch(crmApiPath('/product-types'), {
      method: 'POST',
      body: { ...productForm },
    })
    productForm.name = ''
    productForm.code = ''
    productForm.description = ''
    await refreshProductTypes()
    toast.add({ title: 'Dodano typ produktu', color: 'success' })
  } finally {
    savingProduct.value = false
  }
}

async function createProvider() {
  if (!providerForm.name.trim()) return
  savingProvider.value = true
  try {
    await $fetch(crmApiPath('/providers'), {
      method: 'POST',
      body: { ...providerForm },
    })
    providerForm.name = ''
    providerForm.contact_email = ''
    providerForm.contact_phone = ''
    await refreshProviders()
    toast.add({ title: 'Dodano instytucję', color: 'success' })
  } finally {
    savingProvider.value = false
  }
}
</script>

<template>
  <CrmShell title="Ustawienia" eyebrow="Konfiguracja CRM">
    <div class="settings-grid">
      <div class="stack">
        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Typy produktów</h2>
                <p>Katalog kredytów, ubezpieczeń i usług nieruchomościowych.</p>
              </div>
            </div>
          </template>

          <div class="table">
            <div class="table-row table-row--head">
              <span>Nazwa</span>
              <span>Domena</span>
              <span>Kod</span>
              <span>Źródło</span>
            </div>
            <div v-for="item in productTypes.data" :key="item.id" class="table-row">
              <strong>{{ item.name }}</strong>
              <span>{{ domainLabel(item.domain) }}</span>
              <code>{{ item.code }}</code>
              <UBadge color="neutral" variant="outline">{{ item.is_system ? 'system' : 'własny' }}</UBadge>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Workflow i statusy</h2>
                <p>Statusy są rekordami konfiguracyjnymi, nie enumami w kodzie.</p>
              </div>
            </div>
          </template>

          <div class="workflow-list">
            <div v-for="workflow in workflows.data" :key="workflow.id" class="workflow-card">
              <div>
                <strong>{{ workflow.name }}</strong>
                <span>{{ workflow.scope }} · {{ workflow.domain || 'global' }}</span>
              </div>
              <div class="status-strip">
                <CrmStatusBadge v-for="status in workflow.statuses" :key="status.id" :status="status.code" />
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <div class="stack">
        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Dodaj typ produktu</h2>
                <p>Własny typ kredytu, polisy lub usługi.</p>
              </div>
            </div>
          </template>

          <form class="side-form" @submit.prevent="createProductType">
            <UFormField label="Domena">
              <USelect v-model="productForm.domain" :items="domainItems" />
            </UFormField>
            <UFormField label="Nazwa">
              <UInput v-model="productForm.name" required placeholder="Kredyt ekologiczny" />
            </UFormField>
            <UFormField label="Kod">
              <UInput v-model="productForm.code" placeholder="credit_green" />
            </UFormField>
            <UFormField label="Opis">
              <UTextarea v-model="productForm.description" :rows="3" />
            </UFormField>
            <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="savingProduct">
              Zapisz typ
            </UButton>
          </form>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Instytucje</h2>
                <p>Banki, ubezpieczyciele, agencje i partnerzy.</p>
              </div>
            </div>
          </template>

          <form class="side-form" @submit.prevent="createProvider">
            <UFormField label="Rodzaj">
              <USelect v-model="providerForm.kind" :items="providerKindItems" />
            </UFormField>
            <UFormField label="Nazwa">
              <UInput v-model="providerForm.name" required placeholder="Bank / ubezpieczyciel" />
            </UFormField>
            <UFormField label="Email kontaktowy">
              <UInput v-model="providerForm.contact_email" type="email" />
            </UFormField>
            <UFormField label="Telefon">
              <UInput v-model="providerForm.contact_phone" />
            </UFormField>
            <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="savingProvider">
              Zapisz instytucję
            </UButton>
          </form>

          <div class="provider-list">
            <div v-for="provider in providers.data" :key="provider.id" class="provider-row">
              <strong>{{ provider.name }}</strong>
              <span>{{ provider.kind }}</span>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </CrmShell>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 24px;
}

.stack,
.side-form,
.workflow-list,
.provider-list {
  display: grid;
  gap: 12px;
}

.provider-list {
  margin-top: 18px;
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

.table {
  display: grid;
}

.table-row {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) 150px minmax(140px, 1fr) 90px;
  gap: 16px;
  align-items: center;
  min-height: 42px;
  border-bottom: 1px solid var(--ui-border);
  font-size: 13px;
}

.table-row:last-child {
  border-bottom: 0;
}

.table-row strong,
.workflow-card strong,
.provider-row strong {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.table-row span,
.workflow-card span,
.provider-row span {
  color: var(--ui-text-muted);
}

.table-row--head {
  min-height: 30px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.workflow-card,
.provider-row {
  display: grid;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.workflow-card:last-child,
.provider-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

@media (max-width: 980px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .table-row {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 10px 0;
  }

  .table-row--head {
    display: none;
  }
}
</style>
