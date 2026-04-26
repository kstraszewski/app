<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Klienci — OpenExpert CRM' })

const search = ref('')
const form = reactive({
  display_name: '',
  primary_email: '',
  primary_phone: '',
  lead_source: '',
})
const saving = ref(false)
const toast = useToast()

const { data, pending, refresh } = await useFetch<{ data: Array<Record<string, any>>; count: number }>('/api/crm/clients', {
  query: computed(() => ({ q: search.value || undefined })),
  default: () => ({ data: [], count: 0 }),
})

async function createClient() {
  if (!form.display_name.trim()) return
  saving.value = true
  try {
    await $fetch('/api/crm/clients', {
      method: 'POST',
      body: {
        display_name: form.display_name,
        primary_email: form.primary_email || undefined,
        primary_phone: form.primary_phone || undefined,
        lead_source: form.lead_source || undefined,
      },
    })
    form.display_name = ''
    form.primary_email = ''
    form.primary_phone = ''
    form.lead_source = ''
    await refresh()
    toast.add({ title: 'Dodano klienta', color: 'success' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CrmShell title="Klienci" eyebrow="Baza relacji">
    <template #actions>
      <UInput v-model="search" icon="i-lucide-search" placeholder="Szukaj klienta" />
    </template>

    <div class="clients-grid">
      <UCard>
        <template #header>
          <div class="panel-head">
            <div>
              <h2>Lista klientów</h2>
              <p>{{ data.count }} rekordów w organizacji</p>
            </div>
          </div>
        </template>

        <div v-if="pending" class="client-list">
          <USkeleton v-for="index in 6" :key="index" class="h-12 w-full" />
        </div>
        <div v-else-if="data.data.length" class="client-list">
          <NuxtLink v-for="client in data.data" :key="client.id" :to="`/clients/${client.id}`" class="client-row">
            <div>
              <strong>{{ client.display_name }}</strong>
              <span>{{ client.primary_email || client.primary_phone || 'Brak kontaktu' }}</span>
            </div>
            <CrmStatusBadge :status="client.status_code" />
          </NuxtLink>
        </div>
        <div v-else class="empty-state">
          <UIcon name="i-lucide-users" />
          <h3>Brak klientów</h3>
          <p>Dodaj pierwszego klienta, a potem utwórz dla niego sprawę z produktami.</p>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="panel-head">
            <div>
              <h2>Nowy klient</h2>
              <p>Karta klienta może później zawierać kilka osób i ról.</p>
            </div>
          </div>
        </template>

        <form class="client-form" @submit.prevent="createClient">
          <UFormField label="Nazwa / imię i nazwisko">
            <UInput v-model="form.display_name" required placeholder="Anna Kowalska" />
          </UFormField>
          <UFormField label="Email">
            <UInput v-model="form.primary_email" type="email" placeholder="anna@example.com" />
          </UFormField>
          <UFormField label="Telefon">
            <UInput v-model="form.primary_phone" placeholder="+48 600 000 000" />
          </UFormField>
          <UFormField label="Źródło leada">
            <UInput v-model="form.lead_source" placeholder="Polecenie, www, partner" />
          </UFormField>
          <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="saving">
            Zapisz klienta
          </UButton>
        </form>
      </UCard>
    </div>
  </CrmShell>
</template>

<style scoped>
.clients-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
}

.panel-head {
  display: flex;
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

.client-list,
.client-form {
  display: grid;
  gap: 12px;
}

.client-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 54px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
  text-decoration: none;
}

.client-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.client-row strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.client-row span {
  color: var(--ui-text-muted);
  font-size: 13px;
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
  max-width: 320px;
  margin: 0;
  font-size: 13px;
}

@media (max-width: 980px) {
  .clients-grid {
    grid-template-columns: 1fr;
  }
}
</style>

