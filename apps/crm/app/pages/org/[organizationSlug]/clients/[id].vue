<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { crmApiPath, orgPath } = useOrganizationContext()
const clientId = computed(() => String(route.params.id))
const toast = useToast()
const caseForm = reactive({
  title: '',
  description: '',
  priority: 'normal',
})
const savingCase = ref(false)

const { data, pending, refresh } = await useFetch<{ data: Record<string, any>; people: any[]; cases: any[]; activities: any[] }>(
  () => crmApiPath(`/clients/${clientId.value}`),
  { default: () => ({ data: {}, people: [], cases: [], activities: [] }) },
)

useHead(() => ({ title: `${data.value.data?.display_name || 'Klient'} — OpenExpert CRM` }))

async function createCase() {
  if (!caseForm.title.trim()) return
  savingCase.value = true
  try {
    await $fetch(crmApiPath('/cases'), {
      method: 'POST',
      body: {
        client_id: clientId.value,
        title: caseForm.title,
        description: caseForm.description || undefined,
        priority: caseForm.priority,
      },
    })
    caseForm.title = ''
    caseForm.description = ''
    caseForm.priority = 'normal'
    await refresh()
    toast.add({ title: 'Dodano sprawę', color: 'success' })
  } finally {
    savingCase.value = false
  }
}
</script>

<template>
  <CrmShell :title="data.data?.display_name || 'Klient'" eyebrow="Karta klienta">
    <template #actions>
      <UButton :to="orgPath('/clients')" icon="i-lucide-arrow-left" variant="outline">
        Klienci
      </UButton>
    </template>

    <div v-if="pending" class="detail-grid">
      <USkeleton class="h-80 w-full" />
      <USkeleton class="h-80 w-full" />
    </div>

    <div v-else class="detail-grid">
      <div class="stack">
        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Dane klienta</h2>
                <p>{{ data.data?.primary_email || data.data?.primary_phone || 'Brak danych kontaktowych' }}</p>
              </div>
              <CrmStatusBadge :status="data.data?.status_code" />
            </div>
          </template>

          <div class="info-grid">
            <span>Źródło</span>
            <strong>{{ data.data?.lead_source || '—' }}</strong>
            <span>Email</span>
            <strong>{{ data.data?.primary_email || '—' }}</strong>
            <span>Telefon</span>
            <strong>{{ data.data?.primary_phone || '—' }}</strong>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Osoby powiązane</h2>
                <p>Role: klient główny, współkredytobiorca, ubezpieczony.</p>
              </div>
            </div>
          </template>

          <div v-if="data.people.length" class="people-list">
            <div v-for="person in data.people" :key="person.id" class="person-row">
              <UIcon name="i-lucide-user" />
              <div>
                <strong>{{ person.display_name }}</strong>
                <span>{{ person.role }} · {{ person.email || person.phone || 'brak kontaktu' }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-line">Brak osobnych ról klienta.</div>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Sprawy klienta</h2>
                <p>Jedna sprawa może zawierać wiele produktów.</p>
              </div>
            </div>
          </template>

          <div v-if="data.cases.length" class="case-list">
            <NuxtLink v-for="item in data.cases" :key="item.id" :to="orgPath(`/cases/${item.id}`)" class="case-row">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.priority }} · {{ new Date(item.updated_at).toLocaleDateString('pl-PL') }}</span>
              </div>
              <CrmStatusBadge :status="item.status_code" />
            </NuxtLink>
          </div>
          <div v-else class="empty-line">Ten klient nie ma jeszcze spraw.</div>
        </UCard>
      </div>

      <div class="stack">
        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Nowa sprawa</h2>
                <p>Kontener dla kredytu, ubezpieczenia i nieruchomości.</p>
              </div>
            </div>
          </template>

          <form class="case-form" @submit.prevent="createCase">
            <UFormField label="Tytuł">
              <UInput v-model="caseForm.title" required placeholder="Zakup mieszkania Warszawa" />
            </UFormField>
            <UFormField label="Opis">
              <UTextarea v-model="caseForm.description" :rows="3" placeholder="Cel klienta, terminy, kontekst" />
            </UFormField>
            <UFormField label="Priorytet">
              <USelect
                v-model="caseForm.priority"
                :items="[
                  { label: 'Niski', value: 'low' },
                  { label: 'Normalny', value: 'normal' },
                  { label: 'Wysoki', value: 'high' },
                  { label: 'Pilny', value: 'urgent' },
                ]"
              />
            </UFormField>
            <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="savingCase">
              Zapisz sprawę
            </UButton>
          </form>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Timeline</h2>
                <p>Notatki, statusy i działania systemowe.</p>
              </div>
            </div>
          </template>

          <div v-if="data.activities.length" class="activity-list">
            <div v-for="activity in data.activities" :key="activity.id" class="activity-row">
              <span />
              <div>
                <strong>{{ activity.title }}</strong>
                <p>{{ activity.body || activity.activity_type }}</p>
              </div>
            </div>
          </div>
          <div v-else class="empty-line">Timeline uzupełni się po pierwszych działaniach.</div>
        </UCard>
      </div>
    </div>
  </CrmShell>
</template>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 24px;
}

.stack,
.case-form,
.people-list,
.case-list,
.activity-list {
  display: grid;
  gap: 12px;
}

.panel-head {
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

.info-grid span {
  color: var(--ui-text-muted);
}

.info-grid strong {
  color: var(--ui-text-highlighted);
  font-weight: 550;
}

.person-row,
.case-row,
.activity-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
  text-decoration: none;
}

.case-row {
  justify-content: space-between;
}

.person-row:last-child,
.case-row:last-child,
.activity-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.person-row strong,
.case-row strong,
.activity-row strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.person-row span,
.case-row span,
.activity-row p,
.empty-line {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.activity-row > span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--ui-text-muted);
}

@media (max-width: 980px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
