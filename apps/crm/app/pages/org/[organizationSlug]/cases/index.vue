<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Sprawy — OpenExpert CRM' })

const { crmApiPath, orgPath } = useOrganizationContext()

const search = ref('')
const form = reactive({
  client_id: '',
  title: '',
  priority: 'normal',
  description: '',
})
const saving = ref(false)
const toast = useToast()

const { data: cases, pending, refresh } = await useFetch<{ data: Array<Record<string, any>>; count: number }>(() => crmApiPath('/cases'), {
  query: computed(() => ({ q: search.value || undefined })),
  default: () => ({ data: [], count: 0 }),
})

const { data: clients } = await useFetch<{ data: Array<Record<string, any>> }>(() => crmApiPath('/clients'), {
  default: () => ({ data: [] }),
})

const clientItems = computed(() => clients.value.data.map((client) => ({
  label: client.display_name,
  value: client.id,
})))

async function createCase() {
  if (!form.client_id || !form.title.trim()) return
  saving.value = true
  try {
    await $fetch(crmApiPath('/cases'), {
      method: 'POST',
      body: { ...form },
    })
    form.title = ''
    form.description = ''
    form.priority = 'normal'
    await refresh()
    toast.add({ title: 'Dodano sprawę', color: 'success' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CrmShell title="Sprawy" eyebrow="Pipeline">
    <template #actions>
      <UInput v-model="search" icon="i-lucide-search" placeholder="Szukaj sprawy" />
    </template>

    <div class="cases-grid">
      <UCard>
        <template #header>
          <div class="panel-head">
            <div>
              <h2>Aktywne sprawy</h2>
              <p>{{ cases.count }} spraw w widoku</p>
            </div>
          </div>
        </template>

        <div v-if="pending" class="case-list">
          <USkeleton v-for="index in 6" :key="index" class="h-14 w-full" />
        </div>
        <div v-else-if="cases.data.length" class="case-list">
          <NuxtLink v-for="item in cases.data" :key="item.id" :to="orgPath(`/cases/${item.id}`)" class="case-row">
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.client?.display_name || 'Brak klienta' }} · {{ item.items?.length || 0 }} produkty</span>
            </div>
            <div class="case-row__meta">
              <CrmStatusBadge :status="item.status_code" />
              <UBadge color="neutral" variant="outline">{{ item.priority }}</UBadge>
            </div>
          </NuxtLink>
        </div>
        <div v-else class="empty-state">
          <UIcon name="i-lucide-briefcase-business" />
          <h3>Brak spraw</h3>
          <p>Sprawa grupuje proces klienta i wszystkie produkty: kredyt, polisę oraz nieruchomość.</p>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="panel-head">
            <div>
              <h2>Nowa sprawa</h2>
              <p>Najpierw wybierz klienta, potem dodasz produkty.</p>
            </div>
          </div>
        </template>

        <form class="case-form" @submit.prevent="createCase">
          <UFormField label="Klient">
            <USelect v-model="form.client_id" :items="clientItems" placeholder="Wybierz klienta" />
          </UFormField>
          <UFormField label="Tytuł">
            <UInput v-model="form.title" required placeholder="Zakup domu + ubezpieczenie" />
          </UFormField>
          <UFormField label="Priorytet">
            <USelect
              v-model="form.priority"
              :items="[
                { label: 'Niski', value: 'low' },
                { label: 'Normalny', value: 'normal' },
                { label: 'Wysoki', value: 'high' },
                { label: 'Pilny', value: 'urgent' },
              ]"
            />
          </UFormField>
          <UFormField label="Opis">
            <UTextarea v-model="form.description" :rows="3" />
          </UFormField>
          <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="saving">
            Utwórz sprawę
          </UButton>
        </form>
      </UCard>
    </div>
  </CrmShell>
</template>

<style scoped>
.cases-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 24px;
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

.case-list,
.case-form {
  display: grid;
  gap: 12px;
}

.case-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
  text-decoration: none;
}

.case-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.case-row strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.case-row span {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.case-row__meta {
  display: flex;
  gap: 8px;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 44px 20px;
  color: var(--ui-text-muted);
  text-align: center;
}

.empty-state .iconify {
  font-size: 28px;
}

.empty-state h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.empty-state p {
  max-width: 360px;
  margin: 0;
  font-size: 13px;
}

@media (max-width: 980px) {
  .cases-grid {
    grid-template-columns: 1fr;
  }
}
</style>
