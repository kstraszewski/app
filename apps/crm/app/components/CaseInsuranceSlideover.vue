<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { CaseItem } from '~/types/cases'

type InsuranceType = 'insurance_life' | 'insurance_property'
type StatusColor = 'neutral' | 'info' | 'warning' | 'success' | 'error'

const props = defineProps<{
  open: boolean
  type: InsuranceType
  existingItem: CaseItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

interface InsuranceFormState {
  title: string
  amount_value: number | null
  expected_close_date: string
}

const route = useRoute()
const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const saving = ref(false)

const form = reactive<InsuranceFormState>({
  title: '',
  amount_value: null,
  expected_close_date: '',
})

const caseId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})

const typeLabel = computed(() => props.type === 'insurance_life'
  ? 'Ubezpieczenie na życie'
  : 'Ubezpieczenie nieruchomości')

const typeDescription = computed(() => props.type === 'insurance_life'
  ? 'Rozpocznij analizę potrzeb ochrony życia i zdrowia klienta.'
  : 'Rozpocznij proces doboru ochrony nieruchomości powiązanej ze sprawą.')

const statusDetails = computed<{ label: string, color: StatusColor, next: string }>(() => {
  const status = props.existingItem?.status_code ?? 'analiza_potrzeb'
  const details: Record<string, { label: string, color: StatusColor, next: string }> = {
    analiza_potrzeb: {
      label: 'Analiza potrzeb',
      color: 'neutral',
      next: 'Zbierz potrzeby klienta, zakres ochrony i podstawowe dane do przygotowania ofert.',
    },
    oferty: {
      label: 'Oferty',
      color: 'info',
      next: 'Porównaj rzeczywiste oferty ubezpieczycieli i zapisz rekomendację dla klienta.',
    },
    wybrana_oferta: {
      label: 'Wybrana oferta',
      color: 'warning',
      next: 'Potwierdź parametry wybranej oferty i przygotuj wniosek do ubezpieczyciela.',
    },
    polisa_wystawiona: {
      label: 'Polisa wystawiona',
      color: 'success',
      next: 'Zweryfikuj dokument polisy, okres ochrony, składkę i wymagane cesje.',
    },
    aktywna: {
      label: 'Aktywna',
      color: 'success',
      next: 'Monitoruj terminy ochrony i zaplanuj kontakt przed odnowieniem.',
    },
    odnowienie: {
      label: 'Odnowienie',
      color: 'warning',
      next: 'Skontaktuj się z klientem i potwierdź zakres ochrony na kolejny okres.',
    },
    utracona: {
      label: 'Utracona',
      color: 'error',
      next: 'Proces zakończono bez aktywnej polisy. Powód powinien wynikać z historii sprawy.',
    },
  }

  return details[status] ?? {
    label: status.replaceAll('_', ' '),
    color: 'neutral',
    next: 'Sprawdź historię sprawy i ustal kolejny krok procesu ubezpieczeniowego.',
  }
})

const policyAlert = computed(() => {
  if (props.existingItem?.status_code === 'polisa_wystawiona' || props.existingItem?.status_code === 'aktywna') {
    return {
      title: 'Status procesu wskazuje polisę',
      description: 'Ten ekran nie zastępuje dokumentu polisy. Szczegóły ochrony trzeba potwierdzić w załączonej dokumentacji.',
      color: 'warning' as const,
      icon: 'i-lucide-file-warning',
    }
  }
  return {
    title: 'To jest proces ubezpieczeniowy, nie polisa',
    description: 'Utworzenie wpisu pozwala śledzić analizę i oferty. Nie oznacza zawarcia umowy ubezpieczenia.',
    color: 'neutral' as const,
    icon: 'i-lucide-shield-alert',
  }
})

function resetForm() {
  form.title = typeLabel.value
  form.amount_value = null
  form.expected_close_date = ''
}

watch(
  [() => props.open, () => props.type, () => props.existingItem],
  ([open]) => {
    if (open && !props.existingItem) resetForm()
  },
  { immediate: true },
)

function validateInsurance(state: Partial<InsuranceFormState>): FormError[] {
  const errors: FormError[] = []
  if (!state.title?.trim()) {
    errors.push({ name: 'title', message: 'Podaj nazwę procesu ubezpieczeniowego.' })
  }
  if (state.amount_value != null && state.amount_value < 0) {
    errors.push({ name: 'amount_value', message: 'Suma ochrony nie może być ujemna.' })
  }
  return errors
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function errorMessage(caught: unknown) {
  const error = caught as {
    data?: { statusMessage?: string }
    message?: string
  }
  return error.data?.statusMessage ?? error.message ?? 'Sprawdź dane formularza i spróbuj ponownie.'
}

function closePanel() {
  emit('update:open', false)
}

function formatMoney(value: number | null, currency = 'PLN') {
  if (value == null) return 'Nie określono'
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null) {
  if (!value) return 'Nie ustalono'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(value))
}

async function startInsuranceProcess(_event: FormSubmitEvent<InsuranceFormState>) {
  if (saving.value || props.existingItem || !caseId.value) return

  saving.value = true
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/items`), {
      method: 'POST',
      body: {
        product_type_code: props.type,
        title: form.title.trim(),
        status_code: 'analiza_potrzeb',
        amount_value: finiteNumber(form.amount_value),
        currency: 'PLN',
        expected_close_date: form.expected_close_date || null,
      },
    })

    toast.add({
      title: 'Rozpoczęto proces ubezpieczeniowy',
      description: form.title.trim(),
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    emit('saved')
    emit('update:open', false)
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się rozpocząć procesu',
      description: errorMessage(caught),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <USlideover
    :default-open="open"
    @update:open="emit('update:open', $event)"
    :title="existingItem?.title || typeLabel"
    :description="existingItem ? 'Bieżący stan procesu ubezpieczeniowego w tej sprawie.' : typeDescription"
    :dismissible="!saving"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <div v-if="existingItem" class="insurance-summary">
        <UAlert
          :color="policyAlert.color"
          variant="subtle"
          :icon="policyAlert.icon"
          :title="policyAlert.title"
          :description="policyAlert.description"
        />

        <section aria-labelledby="insurance-process-heading">
          <div class="section-heading">
            <span class="section-icon"><UIcon name="i-lucide-route" /></span>
            <div>
              <h3 id="insurance-process-heading">Proces w sprawie</h3>
              <p>Stan wynika bezpośrednio z zapisanego produktu sprawy.</p>
            </div>
            <UBadge :color="statusDetails.color" variant="subtle">
              {{ statusDetails.label }}
            </UBadge>
          </div>

          <dl class="summary-list">
            <div>
              <dt>Rodzaj ochrony</dt>
              <dd>{{ typeLabel }}</dd>
            </div>
            <div>
              <dt>Planowana suma</dt>
              <dd>{{ formatMoney(existingItem.amount_value, existingItem.currency) }}</dd>
            </div>
            <div>
              <dt>Planowane zakończenie</dt>
              <dd>{{ formatDate(existingItem.expected_close_date) }}</dd>
            </div>
            <div>
              <dt>Opiekun</dt>
              <dd>{{ existingItem.owner?.full_name || existingItem.owner?.email || 'Nie przypisano' }}</dd>
            </div>
            <div>
              <dt>Ostatnia aktualizacja</dt>
              <dd>{{ formatDate(existingItem.updated_at) }}</dd>
            </div>
          </dl>
        </section>

        <section class="next-step" aria-labelledby="insurance-next-step-heading">
          <span><UIcon name="i-lucide-arrow-right" /></span>
          <div>
            <h3 id="insurance-next-step-heading">Sugerowany kolejny krok</h3>
            <p>{{ statusDetails.next }}</p>
          </div>
        </section>
      </div>

      <UForm
        v-else
        id="case-insurance-form"
        :state="form"
        :validate="validateInsurance"
        :validate-on="['blur', 'change']"
        class="insurance-form"
        @submit="startInsuranceProcess"
      >
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-shield-plus"
          title="Rozpoczynasz analizę, nie zawierasz polisy"
          description="Wpis utworzy obszar pracy w sprawie. Oferty, decyzja klienta i dokument polisy pojawią się dopiero na kolejnych etapach."
        />

        <UFormField name="title" label="Nazwa procesu" required>
          <UInput
            v-model="form.title"
            class="w-full"
            :maxlength="200"
            placeholder="Np. Ochrona życia do kredytu hipotecznego"
          />
        </UFormField>

        <UFormField
          name="amount_value"
          label="Planowana suma ochrony"
          hint="Opcjonalnie"
          description="Kwota robocza do analizy potrzeb; nie jest potwierdzoną sumą z polisy."
        >
          <UInputNumber
            v-model="form.amount_value"
            class="w-full"
            :min="0"
            :step="1000"
            :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
          />
        </UFormField>

        <UFormField
          name="expected_close_date"
          label="Planowane zakończenie"
          hint="Opcjonalnie"
        >
          <UInput v-model="form.expected_close_date" class="w-full" type="date" />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="slideover-footer">
        <p v-if="!existingItem">
          <UIcon name="i-lucide-workflow" />
          Startowy status: Analiza potrzeb
        </p>
        <span v-else />
        <div class="footer-actions">
          <UButton color="neutral" variant="ghost" :disabled="saving" @click="closePanel">
            {{ existingItem ? 'Zamknij' : 'Anuluj' }}
          </UButton>
          <UButton
            v-if="!existingItem"
            type="submit"
            form="case-insurance-form"
            icon="i-lucide-play"
            :loading="saving"
          >
            Rozpocznij analizę
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.insurance-form,
.insurance-summary {
  display: grid;
  gap: 24px;
}

.insurance-summary section {
  display: grid;
  gap: 18px;
}

.section-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 12px;
}

.section-icon,
.next-step > span {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.section-icon :deep(svg),
.next-step > span :deep(svg) {
  width: 18px;
  height: 18px;
}

.section-heading h3,
.section-heading p,
.next-step h3,
.next-step p,
.slideover-footer p {
  margin: 0;
}

.section-heading h3,
.next-step h3 {
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
}

.section-heading p,
.next-step p,
.slideover-footer p {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.summary-list {
  margin: 0;
  border-block: 1px solid var(--ui-border);
}

.summary-list > div {
  display: grid;
  grid-template-columns: minmax(130px, 0.8fr) minmax(0, 1.2fr);
  gap: 16px;
  padding: 13px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.summary-list > div:last-child {
  border-bottom: 0;
}

.summary-list dt {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.summary-list dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 550;
  text-align: right;
}

.next-step {
  display: flex !important;
  align-items: flex-start;
  gap: 12px !important;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.next-step p {
  margin-top: 4px;
}

.slideover-footer {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.slideover-footer p,
.footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.slideover-footer p :deep(svg) {
  width: 15px;
  height: 15px;
}

@media (max-width: 639px) {
  .section-heading {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .section-heading > :last-child {
    grid-column: 2;
    justify-self: start;
  }

  .summary-list > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .summary-list dd {
    text-align: left;
  }

  .slideover-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .footer-actions {
    justify-content: flex-end;
  }
}
</style>
