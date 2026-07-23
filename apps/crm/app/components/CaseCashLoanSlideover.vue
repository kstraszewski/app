<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { CaseItem } from '~/types/cases'

type StatusColor = 'neutral' | 'info' | 'warning' | 'success' | 'error'

const props = defineProps<{
  open: boolean
  existingItem: CaseItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

interface RenovationFormState {
  title: string
  amount_value: number | null
  expected_close_date: string
}

const route = useRoute()
const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const saving = ref(false)

const form = reactive<RenovationFormState>({
  title: 'Remont',
  amount_value: null,
  expected_close_date: '',
})

const caseId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})

const statusDetails = computed<{ label: string, color: StatusColor, next: string }>(() => {
  const status = props.existingItem?.status_code ?? 'kwalifikacja'
  const details: Record<string, { label: string, color: StatusColor, next: string }> = {
    kwalifikacja: {
      label: 'Kwalifikacja',
      color: 'neutral',
      next: 'Ustal potrzebną kwotę, okres spłaty oraz podstawowe dane dochodowe klienta.',
    },
    dokumenty: {
      label: 'Dokumenty',
      color: 'warning',
      next: 'Skompletuj dokumenty dochodowe i potwierdź bieżące zobowiązania klienta.',
    },
    oferty: {
      label: 'Oferty',
      color: 'info',
      next: 'Porównaj oferty kredytu gotówkowego i przedstaw klientowi całkowity koszt finansowania.',
    },
    wnioski_wyslane: {
      label: 'Wnioski wysłane',
      color: 'info',
      next: 'Monitoruj odpowiedzi banków i uzupełnij ewentualne braki.',
    },
    decyzja: {
      label: 'Decyzja',
      color: 'warning',
      next: 'Zweryfikuj decyzję banku, kwotę, oprocentowanie i warunki uruchomienia.',
    },
    umowa: {
      label: 'Umowa',
      color: 'success',
      next: 'Potwierdź z klientem warunki umowy przed jej podpisaniem.',
    },
    uruchomiony: {
      label: 'Uruchomiony',
      color: 'success',
      next: 'Potwierdź wypłatę środków i zamknij działania związane z finansowaniem remontu.',
    },
    utracony: {
      label: 'Utracony',
      color: 'error',
      next: 'Proces zakończono bez uruchomienia kredytu. Powód powinien wynikać z historii sprawy.',
    },
  }

  return details[status] ?? {
    label: status.replaceAll('_', ' '),
    color: 'neutral',
    next: 'Sprawdź historię sprawy i ustal kolejny krok procesu kredytowego.',
  }
})

function resetForm() {
  form.title = 'Remont'
  form.amount_value = null
  form.expected_close_date = ''
}

watch(
  [() => props.open, () => props.existingItem],
  ([open]) => {
    if (open && !props.existingItem) resetForm()
  },
  { immediate: true },
)

function validateRenovation(state: Partial<RenovationFormState>): FormError[] {
  const errors: FormError[] = []
  if (!state.title?.trim()) {
    errors.push({ name: 'title', message: 'Podaj nazwę procesu.' })
  }
  if (state.amount_value != null && state.amount_value <= 0) {
    errors.push({ name: 'amount_value', message: 'Kwota kredytu musi być większa od zera.' })
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

async function startRenovationProcess(_event: FormSubmitEvent<RenovationFormState>) {
  if (saving.value || props.existingItem || !caseId.value) return

  saving.value = true
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/items`), {
      method: 'POST',
      body: {
        product_type_code: 'credit_cash',
        title: form.title.trim(),
        status_code: 'kwalifikacja',
        amount_value: finiteNumber(form.amount_value),
        currency: 'PLN',
        expected_close_date: form.expected_close_date || null,
        metadata: { purpose: 'renovation' },
      },
    })

    toast.add({
      title: 'Dodano finansowanie remontu',
      description: 'Utworzono proces kredytu gotówkowego.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    emit('saved')
    emit('update:open', false)
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się dodać finansowania remontu',
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
    :title="existingItem?.title || 'Remont'"
    :description="existingItem ? 'Bieżący stan kredytu gotówkowego na remont.' : 'Dodaj do sprawy finansowanie remontu kredytem gotówkowym.'"
    :dismissible="!saving"
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div v-if="existingItem" class="renovation-summary">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-badge-dollar-sign"
          title="Kredyt gotówkowy na remont"
          description="Ten proces jest prowadzony niezależnie od kredytu hipotecznego i nie wymaga zabezpieczenia na nieruchomości."
        />

        <section aria-labelledby="renovation-process-heading">
          <div class="section-heading">
            <span class="section-icon"><UIcon name="i-lucide-route" /></span>
            <div>
              <h3 id="renovation-process-heading">Proces w sprawie</h3>
              <p>Stan wynika bezpośrednio z zapisanego produktu sprawy.</p>
            </div>
            <UBadge :color="statusDetails.color" variant="subtle">
              {{ statusDetails.label }}
            </UBadge>
          </div>

          <dl class="summary-list">
            <div>
              <dt>Produkt</dt>
              <dd>Kredyt gotówkowy</dd>
            </div>
            <div>
              <dt>Cel</dt>
              <dd>Remont</dd>
            </div>
            <div>
              <dt>Wnioskowana kwota</dt>
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

        <section class="next-step" aria-labelledby="renovation-next-step-heading">
          <span><UIcon name="i-lucide-arrow-right" /></span>
          <div>
            <h3 id="renovation-next-step-heading">Sugerowany kolejny krok</h3>
            <p>{{ statusDetails.next }}</p>
          </div>
        </section>
      </div>

      <UForm
        v-else
        id="case-renovation-form"
        :state="form"
        :validate="validateRenovation"
        :validate-on="['blur', 'change']"
        class="renovation-form"
        @submit="startRenovationProcess"
      >
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-paint-roller"
          title="Osobny proces kredytu gotówkowego"
          description="Wpis utworzy w sprawie finansowanie celu remontowego, niezależne od kredytu hipotecznego."
        />

        <UFormField name="title" label="Nazwa procesu" required>
          <UInput
            v-model="form.title"
            class="w-full"
            :maxlength="200"
            placeholder="Remont"
          />
        </UFormField>

        <UFormField
          name="amount_value"
          label="Wnioskowana kwota kredytu"
          hint="Opcjonalnie"
          description="Robocza kwota potrzebna na realizację remontu."
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
          Startowy status: Kwalifikacja
        </p>
        <span v-else />
        <div class="footer-actions">
          <UButton color="neutral" variant="ghost" :disabled="saving" @click="closePanel">
            {{ existingItem ? 'Zamknij' : 'Anuluj' }}
          </UButton>
          <UButton
            v-if="!existingItem"
            type="submit"
            form="case-renovation-form"
            icon="i-lucide-play"
            :loading="saving"
          >
            Dodaj do sprawy
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.renovation-form,
.renovation-summary {
  display: grid;
  gap: 24px;
}

.renovation-summary section {
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

.section-heading h3,
.next-step h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.section-heading p,
.next-step p {
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.summary-list {
  display: grid;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
}

.summary-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  padding: 13px 15px;
}

.summary-list > div + div {
  border-top: 1px solid var(--ui-border);
}

.summary-list dt {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.summary-list dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

.next-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.slideover-footer,
.slideover-footer p,
.footer-actions {
  display: flex;
  align-items: center;
}

.slideover-footer {
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}

.slideover-footer p {
  gap: 7px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.footer-actions {
  gap: 8px;
}

@media (max-width: 480px) {
  .section-heading {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .section-heading > :last-child {
    grid-column: 2;
    justify-self: start;
  }

  .summary-list > div {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .summary-list dd {
    text-align: left;
  }

  .slideover-footer {
    align-items: flex-end;
  }

  .slideover-footer p {
    display: none;
  }
}
</style>
