<script setup lang="ts">
import {
  DEFAULT_MORTGAGE_CAPACITY_POLICY,
  MORTGAGE_CAPACITY_REGULATORY_RULES,
  validateMortgageCapacityPolicy,
  type MortgageCapacityPolicy,
} from '@openexpert/mortgage'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/capacity',
  alias: ['mortgages/capacity/admin'],
})
useHead({ title: 'Zdolność — ustawienia administracyjne — OpenExpert' })

type ConfigPayload = {
  settings: MortgageCapacityPolicy
  defaults?: MortgageCapacityPolicy
  notes: string | null
  isCustomized: boolean
  revision: number
  updatedAt: string | null
  role: 'admin' | 'expert'
}

function clonePolicy(policy: MortgageCapacityPolicy): MortgageCapacityPolicy {
  return {
    ...policy,
    minimumSocialMonthly: [...policy.minimumSocialMonthly],
  }
}

const route = useRoute()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const toast = useToast()
const saving = ref(false)
const resetting = ref(false)
const resetOpen = ref(false)
const formError = ref<string | null>(null)
const { data, error, status } = await useFetch<ConfigPayload>(
  () => `/api/org/${organizationSlug.value}/mortgages/capacity/config`,
  {
    key: computed(() => `mortgage-capacity-admin-${organizationSlug.value}`),
    default: () => ({
      settings: clonePolicy(DEFAULT_MORTGAGE_CAPACITY_POLICY),
      defaults: clonePolicy(DEFAULT_MORTGAGE_CAPACITY_POLICY),
      notes: null,
      isCustomized: false,
      revision: 0,
      updatedAt: null,
      role: 'expert' as const,
    }),
  },
)

const form = reactive<MortgageCapacityPolicy>(clonePolicy(data.value.settings))
const notes = ref(data.value.notes ?? '')
const interestTypeItems = [
  { label: 'Okresowo stała', value: 'periodically_fixed' },
  { label: 'Zmienna', value: 'variable' },
  { label: 'Stała do końca', value: 'fixed_for_term' },
]
const volatilityBufferItems = [
  { label: '0 p.p. — warunek nie jest spełniony', value: 0 },
  { label: '1,5 p.p. — warunek jest spełniony', value: 1.5 },
]
const date = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })
const updatedLabel = computed(() => data.value.updatedAt ? date.format(new Date(data.value.updatedAt)) : 'wartości domyślne')

function syncForm(payload: ConfigPayload) {
  Object.assign(form, clonePolicy(payload.settings))
  notes.value = payload.notes ?? ''
}

watch(data, payload => syncForm(payload))

function applyPayload(payload: ConfigPayload) {
  syncForm(payload)
  data.value = { ...data.value, ...payload }
}

async function saveSettings() {
  formError.value = null
  try {
    validateMortgageCapacityPolicy(form)
  } catch (caught) {
    formError.value = caught instanceof Error ? caught.message : 'Sprawdź wartości formularza.'
    return
  }

  saving.value = true
  try {
    const payload = await $fetch<ConfigPayload>(
      `/api/org/${organizationSlug.value}/mortgages/capacity/config`,
      {
        method: 'PATCH',
        body: {
          settings: clonePolicy(form),
          notes: notes.value,
          expectedRevision: data.value.revision,
        },
      },
    )
    applyPayload(payload)
    toast.add({
      title: 'Założenia zapisane',
      description: `Aktywna rewizja: ${payload.revision}.`,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (caught: any) {
    formError.value = caught?.data?.statusMessage ?? caught?.message ?? 'Nie udało się zapisać ustawień.'
  } finally {
    saving.value = false
  }
}

async function resetSettings() {
  resetting.value = true
  formError.value = null
  try {
    const payload = await $fetch<ConfigPayload>(
      `/api/org/${organizationSlug.value}/mortgages/capacity/config`,
      {
        method: 'DELETE',
        body: { expectedRevision: data.value.revision },
      },
    )
    applyPayload(payload)
    resetOpen.value = false
    toast.add({
      title: 'Przywrócono wartości domyślne',
      description: 'Zmiana została zapisana w historii audytowej.',
      color: 'success',
      icon: 'i-lucide-rotate-ccw',
    })
  } catch (caught: any) {
    formError.value = caught?.data?.statusMessage ?? caught?.message ?? 'Nie udało się przywrócić ustawień.'
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <CrmShell
    title="Założenia kalkulatora zdolności"
    eyebrow="Ustawienia administracyjne"
    description="Polityka modelu, parametry obliczeń i historia zmian."
    :back-to="`/org/${organizationSlug}/mortgages/capacity`"
    back-label="Wróć do kalkulatora"
  >

    <UAlert
      v-if="error"
      class="admin-alert"
      color="error"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać ustawień"
      description="Sprawdź połączenie z bazą i zastosowanie migracji."
    />

    <UAlert
      v-if="data.role !== 'admin' && status === 'success'"
      color="warning"
      icon="i-lucide-lock-keyhole"
      title="Dostęp tylko dla administratora organizacji"
      description="Eksperci mogą korzystać z kalkulatora, ale nie mogą zmieniać jego założeń."
    />

    <template v-else-if="data.role === 'admin' && status === 'success'">
      <section class="admin-intro">
        <div>
          <UBadge :color="data.isCustomized ? 'info' : 'neutral'" variant="subtle">
            {{ data.isCustomized ? `Rewizja ${data.revision}` : 'Wartości domyślne' }}
          </UBadge>
          <p>Ostatnia zmiana: {{ updatedLabel }}. Każdy zapis i reset trafia do historii audytowej wraz z użytkownikiem i czasem zmiany.</p>
        </div>
        <div class="intro-actions">
          <UModal
            v-if="data.isCustomized"
            v-model:open="resetOpen"
            title="Przywrócić wartości domyślne?"
            description="Bieżąca konfiguracja organizacji zostanie usunięta. Operacja pozostanie w historii audytowej."
            :ui="{ footer: 'justify-end' }"
          >
            <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="outline">
              Przywróć domyślne
            </UButton>
            <template #footer="{ close }">
              <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
              <UButton color="error" variant="solid" :loading="resetting" @click="resetSettings">
                Przywróć
              </UButton>
            </template>
          </UModal>
          <UButton icon="i-lucide-save" variant="solid" :loading="saving" @click="saveSettings">
            Zapisz założenia
          </UButton>
        </div>
      </section>

      <UAlert
        v-if="formError"
        class="admin-alert"
        color="error"
        icon="i-lucide-circle-alert"
        title="Nie udało się zapisać"
        :description="formError"
      />

      <form class="settings-form" @submit.prevent="saveSettings">
        <section class="settings-section">
          <header>
            <span>01</span>
            <div>
              <h2>Polityka oceny</h2>
              <p>Te wartości są założeniami organizacji, a nie twardymi limitami narzuconymi przez KNF.</p>
            </div>
          </header>
          <div class="settings-grid">
            <UFormField
              name="dstiLimitPct"
              label="Modelowy próg DStI (%)"
              description="40% to konserwatywny próg szczególnej uwagi; KNF nie ustanawia nim automatycznej odmowy."
            >
              <UInputNumber v-model="form.dstiLimitPct" :min="1" :max="100" :step="1" />
            </UFormField>
            <UFormField
              name="incomeBufferPct"
              label="Spadek dochodu w teście (%)"
              description="Rekomendacja wymaga bufora dochodowego, ale nie podaje jego wysokości."
            >
              <UInputNumber v-model="form.incomeBufferPct" :min="0" :max="50" :step="1" />
            </UFormField>
            <UFormField
              name="creditLimitMonthlyChargePct"
              label="Obciążenie od limitów kart (%)"
              description="Miesięczna część pełnego przyznanego limitu."
            >
              <UInputNumber v-model="form.creditLimitMonthlyChargePct" :min="0" :max="100" :step="0.5" />
            </UFormField>
            <UFormField
              name="maxLtvPct"
              label="Maksymalne LTV (%)"
              description="MVP nie modeluje dodatkowego zabezpieczenia, dlatego nie pozwala przekroczyć 80%."
            >
              <UInputNumber v-model="form.maxLtvPct" :min="1" :max="80" :step="1" />
            </UFormField>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>02</span>
            <div>
              <h2>Domyślny scenariusz stopy</h2>
              <p>Użytkownik może zmienić stopę na ekranie kalkulatora; NBP i składnik zmienności sterują wzorem dla stopy zmiennej.</p>
            </div>
          </header>
          <div class="settings-grid">
            <UFormField name="defaultInterestRatePct" label="Domyślna stopa nominalna (%)">
              <UInputNumber v-model="form.defaultInterestRatePct" :min="0" :max="50" :step="0.1" />
            </UFormField>
            <UFormField name="defaultInterestType" label="Domyślny rodzaj stopy">
              <USelect
                v-model="form.defaultInterestType"
                :items="interestTypeItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField name="defaultFixedRatePeriodMonths" label="Domyślny okres stały (mies.)">
              <UInputNumber v-model="form.defaultFixedRatePeriodMonths" :min="60" :max="420" :step="12" />
            </UFormField>
            <UFormField name="nbpReferenceRatePct" label="Stopa referencyjna NBP (%)">
              <UInputNumber v-model="form.nbpReferenceRatePct" :min="0" :max="30" :step="0.25" />
            </UFormField>
            <UFormField
              name="variableRateVolatilityBufferPct"
              label="Składnik zmienności σ (p.p.)"
              description="0 albo 1,5 p.p. zgodnie z testem 100 dni roboczych w Rekomendacji S."
            >
              <USelect v-model="form.variableRateVolatilityBufferPct" :items="volatilityBufferItems" />
            </UFormField>
            <UFormField name="nbpReferenceRateAsOf" label="Stopa NBP aktualna na">
              <UInput v-model="form.nbpReferenceRateAsOf" type="date" />
            </UFormField>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>03</span>
            <div>
              <h2>Minimum socjalne IPiSS</h2>
              <p>Kwoty dotyczą całego gospodarstwa i uwzględniają korzyści skali; nie są prostą stawką „na osobę”.</p>
            </div>
          </header>
          <div class="settings-grid minimum-grid">
            <UFormField name="minimumSocial1" label="1 osoba">
              <UInputNumber v-model="form.minimumSocialMonthly[0]" :min="0" :max="100000" :step="10" :format-options="{ style: 'currency', currency: 'PLN' }" />
            </UFormField>
            <UFormField name="minimumSocial2" label="2 osoby">
              <UInputNumber v-model="form.minimumSocialMonthly[1]" :min="0" :max="100000" :step="10" :format-options="{ style: 'currency', currency: 'PLN' }" />
            </UFormField>
            <UFormField name="minimumSocial3" label="3 osoby">
              <UInputNumber v-model="form.minimumSocialMonthly[2]" :min="0" :max="100000" :step="10" :format-options="{ style: 'currency', currency: 'PLN' }" />
            </UFormField>
            <UFormField name="minimumSocial4" label="4 osoby">
              <UInputNumber v-model="form.minimumSocialMonthly[3]" :min="0" :max="100000" :step="10" :format-options="{ style: 'currency', currency: 'PLN' }" />
            </UFormField>
            <UFormField name="minimumSocial5" label="5 osób">
              <UInputNumber v-model="form.minimumSocialMonthly[4]" :min="0" :max="100000" :step="10" :format-options="{ style: 'currency', currency: 'PLN' }" />
            </UFormField>
            <UFormField name="minimumSocialAdditionalPerson" label="Każda kolejna osoba">
              <UInputNumber v-model="form.minimumSocialAdditionalPerson" :min="0" :max="100000" :step="10" :format-options="{ style: 'currency', currency: 'PLN' }" />
            </UFormField>
            <UFormField name="minimumSocialAsOf" label="Tabela aktualna na">
              <UInput v-model="form.minimumSocialAsOf" type="date" />
            </UFormField>
            <UFormField name="policyAsOf" label="Cała polityka zweryfikowana na">
              <UInput v-model="form.policyAsOf" type="date" />
            </UFormField>
          </div>
        </section>

        <section class="settings-section locked-section">
          <header>
            <span>04</span>
            <div>
              <h2>Reguły regulacyjne — zablokowane</h2>
              <p>Zmiana tych wartości wymaga aktualizacji i testów silnika, a nie zwykłej decyzji administratora.</p>
            </div>
          </header>
          <div class="locked-grid">
            <article><UIcon name="i-lucide-calendar-range" /><span>Okres oceny</span><strong>{{ MORTGAGE_CAPACITY_REGULATORY_RULES.maxAssessmentTermMonths / 12 }} lat</strong></article>
            <article><UIcon name="i-lucide-calendar-x" /><span>Maks. okres umowy</span><strong>{{ MORTGAGE_CAPACITY_REGULATORY_RULES.maxContractTermMonths / 12 }} lat</strong></article>
            <article><UIcon name="i-lucide-shield-check" /><span>Minimalny bufor</span><strong>{{ MORTGAGE_CAPACITY_REGULATORY_RULES.minimumRateBufferPct }} p.p.</strong></article>
            <article><UIcon name="i-lucide-clock-5" /><span>Min. stała stopa</span><strong>{{ MORTGAGE_CAPACITY_REGULATORY_RULES.periodicallyFixedMinimumMonths / 12 }} lat</strong></article>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>05</span>
            <div>
              <h2>Notatka do rewizji</h2>
              <p>Zapisz podstawę aktualizacji albo nazwę przyjętej polityki organizacji.</p>
            </div>
          </header>
          <UFormField name="notes" label="Notatka" hint="Maks. 4000 znaków">
            <UTextarea v-model="notes" class="w-full" :rows="4" autoresize :maxrows="8" placeholder="Np. aktualizacja tabeli IPiSS i stopy NBP..." />
          </UFormField>
        </section>

        <footer class="sticky-actions">
          <div>
            <strong>Rewizja {{ data.revision || 'domyślna' }}</strong>
            <span>Wartości obowiązują po zapisaniu.</span>
          </div>
          <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="saving">
            Zapisz założenia
          </UButton>
        </footer>
      </form>

      <section class="admin-sources">
        <h2>Źródła modelu</h2>
        <a href="https://www.knf.gov.pl/knf/pl/komponenty/img/Rekomendacja_S_nowelizacja_czerwiec_2023_82872.pdf" target="_blank" rel="noreferrer">Rekomendacja S KNF <UIcon name="i-lucide-external-link" /></a>
        <a href="https://www.ipiss.com.pl/wp-content/uploads/2026/04/MS-4Q2025.pdf" target="_blank" rel="noreferrer">Minimum socjalne IPiSS, IV kw. 2025 <UIcon name="i-lucide-external-link" /></a>
        <a href="https://nbp.pl/rpp-08-07-2026/" target="_blank" rel="noreferrer">Decyzja RPP z 8 lipca 2026 <UIcon name="i-lucide-external-link" /></a>
      </section>
    </template>
  </CrmShell>
</template>

<style scoped>
.admin-alert { margin-bottom: 16px; }
.admin-intro { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 18px; padding: 16px 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.admin-intro p { margin: 7px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.intro-actions { display: flex; gap: 8px; flex: none; }
.settings-form { display: grid; gap: 16px; }
.settings-section { padding: 22px; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * 1.5); background: var(--ui-bg); }
.settings-section > header { display: flex; gap: 14px; margin-bottom: 22px; }
.settings-section > header > span { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border: 1px solid var(--ui-border); border-radius: 50%; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 11px; }
.settings-section h2, .admin-sources h2 { margin: 0; color: var(--ui-text-highlighted); font-size: 19px; font-weight: 600; }
.settings-section header p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.minimum-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.settings-grid :deep([data-slot='root']) { width: 100%; }
.locked-section { background: var(--ui-bg-muted); }
.locked-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.locked-grid article { display: grid; gap: 6px; padding: 14px; border: 1px solid var(--ui-border-muted); background: var(--ui-bg); }
.locked-grid article > :first-child { width: 18px; height: 18px; color: var(--ui-text-muted); }
.locked-grid span { color: var(--ui-text-muted); font-size: 11px; }
.locked-grid strong { color: var(--ui-text-highlighted); font-size: 16px; }
.sticky-actions { position: sticky; bottom: 16px; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: color-mix(in srgb, var(--ui-bg) 92%, transparent); box-shadow: 0 12px 36px color-mix(in srgb, var(--ui-bg-inverted) 12%, transparent); backdrop-filter: blur(12px); }
.sticky-actions > div { display: grid; }
.sticky-actions strong { color: var(--ui-text-highlighted); font-size: 12px; }
.sticky-actions span { color: var(--ui-text-muted); font-size: 11px; }
.admin-sources { display: flex; align-items: center; gap: 20px; margin-top: 20px; padding: 18px 0; border-top: 1px solid var(--ui-border); }
.admin-sources h2 { margin-right: auto; font-size: 14px; }
.admin-sources a { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-text-muted); font-size: 11px; text-decoration: none; }
.admin-sources a:hover { color: var(--ui-text-highlighted); }
@media (max-width: 1050px) { .settings-grid, .minimum-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .locked-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .admin-sources { align-items: flex-start; flex-direction: column; } .admin-sources h2 { margin-right: 0; } }
@media (max-width: 680px) { .admin-intro, .sticky-actions { align-items: stretch; flex-direction: column; } .intro-actions { flex-wrap: wrap; } .settings-grid, .minimum-grid, .locked-grid { grid-template-columns: 1fr; } .settings-section { padding: 18px; } }
</style>
