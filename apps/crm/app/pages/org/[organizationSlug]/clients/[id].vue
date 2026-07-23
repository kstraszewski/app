<script setup lang="ts">
import type { ClientAppointmentSummary, ClientAppointmentsPageInfo } from '~/types/clients'

definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { crmApiPath, orgPath } = useOrganizationContext()
const clientId = computed(() => String(route.params.id))
const toast = useToast()
const caseForm = reactive({
  title: '',
})
const savingCase = ref(false)

const { data, pending, error, refresh } = await useFetch<{
  data: Record<string, any>
  owner: Record<string, any> | null
  people: any[]
  cases: any[]
  activities: any[]
  consents: any[]
  consent_history: any[]
  consent_history_count: number
  appointments: ClientAppointmentSummary[]
  appointment_count: number
  appointments_page_info: ClientAppointmentsPageInfo
}>(
  () => crmApiPath(`/clients/${clientId.value}`),
  {
    default: () => ({
      data: {},
      owner: null,
      people: [],
      cases: [],
      activities: [],
      consents: [],
      consent_history: [],
      consent_history_count: 0,
      appointments: [],
      appointment_count: 0,
      appointments_page_info: { offset: 0, limit: 20, has_more: false },
    }),
  },
)

useHead(() => ({ title: `${data.value.data?.display_name || 'Klient'} — OpenExpert CRM` }))

function consentDecisionLabel(decision: string) {
  return ({
    granted: 'udzielona',
    declined: 'nieudzielona',
    withdrawn: 'wycofana',
  })[decision] ?? decision
}

function consentChannelLabel(channel: string) {
  return ({
    email: 'e-mail',
    sms: 'SMS/MMS',
    phone: 'telefon',
    messaging: 'komunikator',
    other: 'inny kanał',
  })[channel] ?? channel
}

function consentSourceLabel(source: string) {
  return ({
    client_creation: 'dodanie klienta',
    client_card: 'karta klienta',
    import: 'import',
    api: 'API',
    booking_widget: 'widget rezerwacji',
  })[source] ?? source
}

function formatConsentDate(value: string) {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatAppointmentDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Nieznany termin'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

const appointmentStatuses = {
  hold: { label: 'Wstępnie zarezerwowana', color: 'warning' },
  confirmed: { label: 'Potwierdzona', color: 'success' },
  cancelled: { label: 'Anulowana', color: 'error' },
} as const

function appointmentStatusMeta(status: string) {
  return appointmentStatuses[status as keyof typeof appointmentStatuses]
    ?? { label: status || 'Nieznany', color: 'neutral' as const }
}

async function createCase() {
  if (!caseForm.title.trim()) return
  savingCase.value = true
  try {
    await $fetch(crmApiPath('/cases'), {
      method: 'POST',
      body: {
        client_ids: [clientId.value],
        title: caseForm.title,
      },
    })
    caseForm.title = ''
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

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Nie udało się pobrać karty klienta"
      description="Sprawdź połączenie i spróbuj ponownie."
      :actions="[{ label: 'Spróbuj ponownie', onClick: () => refresh() }]"
    />

    <div v-else class="detail-grid">
      <div class="stack">
        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Dane klienta</h2>
                <p>{{ data.data?.primary_email || data.data?.primary_phone || 'Brak danych kontaktowych' }}</p>
              </div>
            </div>
          </template>

          <div class="info-grid">
            <span>Opiekun</span>
            <strong>{{ data.owner?.full_name || data.owner?.email || '—' }}</strong>
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
                <h2>Zgody klienta</h2>
                <p>Najnowsza decyzja dla każdej wersjonowanej definicji.</p>
              </div>
              <UBadge color="neutral" variant="outline">{{ data.consents.length }}</UBadge>
            </div>
          </template>

          <div v-if="data.consents.length" class="consent-history">
            <article v-for="consent in data.consents" :key="consent.id" class="consent-record">
              <div class="consent-record__heading">
                <div>
                  <strong>{{ consent.version?.display_title || 'Zgoda' }}</strong>
                  <span>
                    {{ consentChannelLabel(consent.version?.channel) }} · wersja {{ consent.version?.version || '—' }}
                  </span>
                </div>
                <div class="consent-record__badges">
                  <UBadge
                    :color="consent.decision === 'granted' ? 'success' : consent.decision === 'withdrawn' ? 'warning' : 'neutral'"
                    variant="subtle"
                  >
                    {{ consentDecisionLabel(consent.decision) }}
                  </UBadge>
                  <UBadge :color="consent.version?.is_required ? 'error' : 'neutral'" variant="outline">
                    {{ consent.version?.is_required ? 'Wymagana' : 'Dobrowolna' }}
                  </UBadge>
                </div>
              </div>
              <p>{{ consent.version?.content }}</p>
              <small>
                {{ formatConsentDate(consent.occurred_at) }} · {{ consentSourceLabel(consent.source) }}
                <template v-if="consent.contact_value"> · {{ consent.contact_value }}</template>
              </small>
            </article>
          </div>
          <div v-else class="empty-line">Nie zapisano jeszcze żadnych decyzji dotyczących zgód.</div>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Historia zgód</h2>
                <p>Pełny ślad wersji i decyzji zapisanych dla klienta.</p>
              </div>
              <UBadge color="neutral" variant="outline">{{ data.consent_history_count }}</UBadge>
            </div>
          </template>

          <div v-if="data.consent_history.length" class="consent-history">
            <article
              v-for="consent in data.consent_history"
              :key="consent.id"
              class="consent-record"
            >
              <div class="consent-record__heading">
                <div>
                  <strong>{{ consent.version?.display_title || 'Zgoda' }}</strong>
                  <span>
                    {{ consentChannelLabel(consent.version?.channel) }} · wersja {{ consent.version?.version || '—' }}
                  </span>
                </div>
                <UBadge
                  :color="consent.decision === 'granted' ? 'success' : consent.decision === 'withdrawn' ? 'warning' : 'neutral'"
                  variant="subtle"
                >
                  {{ consentDecisionLabel(consent.decision) }}
                </UBadge>
              </div>
              <p>{{ consent.version?.content }}</p>
              <small>
                {{ formatConsentDate(consent.occurred_at) }} · {{ consentSourceLabel(consent.source) }}
                <template v-if="consent.contact_value"> · {{ consent.contact_value }}</template>
              </small>
            </article>
          </div>
          <div v-else class="empty-line">Brak historii decyzji dotyczących zgód.</div>
          <p v-if="data.consent_history_count > data.consent_history.length" class="appointment-limit-note">
            Wyświetlamy {{ data.consent_history.length }} najnowszych z {{ data.consent_history_count }} zdarzeń.
          </p>
        </UCard>

        <UCard>
          <template #header>
            <div class="panel-head">
              <div>
                <h2>Wizyty</h2>
                <p>Spotkania klienta w placówkach i z przypisanymi ekspertami.</p>
              </div>
              <UBadge color="neutral" variant="outline">{{ data.appointment_count }}</UBadge>
            </div>
          </template>

          <div v-if="data.appointments.length" class="appointment-list">
            <article v-for="appointment in data.appointments" :key="appointment.id" class="appointment-row">
              <span class="appointment-row__date">
                <UIcon name="i-lucide-calendar-clock" />
                {{ formatAppointmentDate(appointment.starts_at) }}
              </span>
              <div class="appointment-row__body">
                <div>
                  <strong>{{ appointment.serviceName }}</strong>
                  <span>{{ appointment.facilityName }}</span>
                </div>
                <UBadge :color="appointmentStatusMeta(appointment.status).color" variant="subtle">
                  {{ appointmentStatusMeta(appointment.status).label }}
                </UBadge>
              </div>
              <small>
                <UIcon name="i-lucide-user-round" />
                {{ appointment.expertName || 'Ekspert nieprzypisany' }}
              </small>
            </article>
          </div>
          <div v-else class="empty-line">Ten klient nie ma jeszcze żadnych wizyt.</div>
          <p v-if="data.appointments_page_info.has_more" class="appointment-limit-note">
            Wyświetlamy {{ data.appointments.length }} najnowszych z {{ data.appointment_count }} wizyt.
          </p>
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
                <p>Sprawy, w których uczestniczy ten klient.</p>
              </div>
            </div>
          </template>

          <div v-if="data.cases.length" class="case-list">
            <NuxtLink v-for="item in data.cases" :key="item.id" :to="orgPath(`/cases/${item.id}`)" class="case-row">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.offer_count || 0 }} zapisanych ofert · {{ new Date(item.updated_at).toLocaleDateString('pl-PL') }}</span>
              </div>
              <UIcon name="i-lucide-chevron-right" />
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
                <p>Nazwij sprawę; tego klienta przypiszemy automatycznie.</p>
              </div>
            </div>
          </template>

          <form class="case-form" @submit.prevent="createCase">
            <UFormField label="Tytuł">
              <UInput v-model="caseForm.title" required placeholder="Zakup mieszkania Warszawa" />
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
.activity-list,
.consent-history,
.appointment-list {
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

.consent-record {
  display: grid;
  gap: 9px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.consent-record:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.consent-record__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.consent-record__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.consent-record strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.consent-record span,
.consent-record p,
.consent-record small {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.consent-record p {
  margin: 0;
  line-height: 1.55;
}

.appointment-row {
  display: grid;
  gap: 8px;
  padding: 13px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
}

.appointment-row__date,
.appointment-row small {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.appointment-row__date {
  color: var(--ui-primary);
  font-weight: 650;
}

.appointment-row__body {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.appointment-row__body > div {
  display: grid;
  gap: 2px;
}

.appointment-row__body strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.appointment-row__body span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.appointment-limit-note {
  margin: 12px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 980px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
