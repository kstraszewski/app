<script setup lang="ts">
import type {
  CeidgCompanyData,
  CeidgCompanyLookupResponse,
} from '#shared/types/ceidg-company'
import type { MultiformFieldValue } from '~/types/multiform'

const props = withDefaults(defineProps<{
  lookupUrl: string
  modelValue?: MultiformFieldValue
  required?: boolean
  invalid?: boolean
}>(), {
  modelValue: '',
  required: false,
  invalid: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  apply: [company: CeidgCompanyData]
}>()

const pending = ref(false)
const errorMessage = ref('')
const result = ref<CeidgCompanyData | null>(null)

const normalizedNip = computed(() => String(props.modelValue ?? '').replaceAll(/\D/gu, ''))
const canLookup = computed(() => normalizedNip.value.length === 10 && !pending.value)
const fieldError = computed(() => {
  if (!props.invalid) return undefined
  if (!String(props.modelValue ?? '').trim() && props.required) return 'To pole jest wymagane.'
  return 'NIP powinien zawierać 10 cyfr i mieć prawidłową sumę kontrolną.'
})
const statusColor = computed(() => {
  const status = result.value?.status.toLocaleUpperCase('pl-PL') ?? ''
  if (status.includes('AKTYWN')) return 'success'
  if (status.includes('ZAWIESZ')) return 'warning'
  return 'neutral'
})

watch(() => props.modelValue, () => {
  errorMessage.value = ''
  if (result.value && normalizedNip.value !== result.value.nip) result.value = null
})

function readableLookupError(error: unknown) {
  if (!error || typeof error !== 'object') return 'Nie udało się pobrać danych z CEIDG.'
  const candidate = error as {
    data?: { message?: unknown, statusMessage?: unknown }
    message?: unknown
    statusMessage?: unknown
  }
  const message = candidate.data?.statusMessage
    ?? candidate.data?.message
    ?? candidate.statusMessage
    ?? candidate.message
  return typeof message === 'string' && message.trim()
    ? message
    : 'Nie udało się pobrać danych z CEIDG.'
}

async function lookupCompany() {
  if (!canLookup.value) return
  pending.value = true
  errorMessage.value = ''
  result.value = null
  emit('update:modelValue', normalizedNip.value)
  try {
    const response = await $fetch<CeidgCompanyLookupResponse>(props.lookupUrl, {
      query: { nip: normalizedNip.value },
    })
    result.value = response.company
  }
  catch (error) {
    errorMessage.value = readableLookupError(error)
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="case-company-lookup" aria-labelledby="case-company-lookup-title">
    <div class="case-company-lookup__heading">
      <span class="case-company-lookup__icon"><UIcon name="i-lucide-building-2" /></span>
      <div>
        <strong id="case-company-lookup-title">Pobierz dane firmy z CEIDG</strong>
        <small>Wpisz NIP, sprawdź wynik i uzupełnij dostępne puste pola.</small>
      </div>
    </div>

    <div class="case-company-lookup__controls">
      <UFormField
        name="businessNip"
        label="NIP firmy"
        :required="required"
        :error="fieldError"
        class="case-company-lookup__nip"
      >
        <UInput
          :model-value="String(modelValue ?? '')"
          inputmode="numeric"
          maxlength="13"
          placeholder="0000000000"
          icon="i-lucide-hash"
          class="w-full"
          @update:model-value="emit('update:modelValue', String($event ?? ''))"
          @keydown.enter.prevent="lookupCompany"
        />
      </UFormField>
      <UButton
        color="neutral"
        variant="solid"
        icon="i-lucide-search"
        :loading="pending"
        :disabled="!canLookup"
        @click="lookupCompany"
      >
        Pobierz z CEIDG
      </UButton>
    </div>

    <p v-if="errorMessage" class="case-company-lookup__error" role="alert">
      <UIcon name="i-lucide-circle-alert" />
      {{ errorMessage }}
    </p>

    <div v-if="result" class="case-company-lookup__result">
      <div class="case-company-lookup__result-heading">
        <div>
          <span>Firma znaleziona</span>
          <strong>{{ result.name }}</strong>
        </div>
        <UBadge :color="statusColor" variant="subtle">
          {{ result.status || 'Brak statusu' }}
        </UBadge>
      </div>
      <dl>
        <div>
          <dt>NIP</dt>
          <dd>{{ result.nip }}</dd>
        </div>
        <div>
          <dt>REGON</dt>
          <dd>{{ result.regon || '—' }}</dd>
        </div>
        <div class="case-company-lookup__wide">
          <dt>Adres działalności</dt>
          <dd>{{ result.businessAddress || 'Brak opublikowanego adresu' }}</dd>
        </div>
        <div class="case-company-lookup__wide">
          <dt>Główne PKD</dt>
          <dd>
            {{ result.mainPkd
              ? [result.mainPkd.code, result.mainPkd.name].filter(Boolean).join(' — ')
              : 'Brak opublikowanego kodu' }}
          </dd>
        </div>
      </dl>
      <div class="case-company-lookup__result-actions">
        <span>
          {{ result.pkd.length }} {{ result.pkd.length === 1 ? 'kod PKD' : 'kodów PKD' }}
          · dane nie zastąpią ręcznie wpisanych wartości
        </span>
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-wand-sparkles"
          @click="emit('apply', result)"
        >
          Uzupełnij puste pola
        </UButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.case-company-lookup {
  grid-column: 1 / -1;
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, var(--ui-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-bg));
}

.case-company-lookup__heading,
.case-company-lookup__controls,
.case-company-lookup__result-heading,
.case-company-lookup__result-actions {
  display: flex;
  align-items: center;
  gap: .75rem;
}

.case-company-lookup__heading > div,
.case-company-lookup__result-heading > div {
  display: grid;
  gap: .15rem;
  min-width: 0;
}

.case-company-lookup__heading small,
.case-company-lookup__result-heading span,
.case-company-lookup__result-actions span {
  color: var(--ui-text-muted);
  font-size: .78rem;
}

.case-company-lookup__icon {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 auto;
  border-radius: .75rem;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
}

.case-company-lookup__controls {
  align-items: flex-end;
}

.case-company-lookup__nip {
  width: min(100%, 22rem);
}

.case-company-lookup__error {
  display: flex;
  align-items: center;
  gap: .45rem;
  margin: 0;
  color: var(--ui-error);
  font-size: .82rem;
}

.case-company-lookup__result {
  display: grid;
  gap: .85rem;
  padding: .9rem;
  border: 1px solid var(--ui-border);
  border-radius: .8rem;
  background: var(--ui-bg);
}

.case-company-lookup__result-heading,
.case-company-lookup__result-actions {
  justify-content: space-between;
}

.case-company-lookup__result-heading strong {
  overflow-wrap: anywhere;
}

.case-company-lookup dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem 1rem;
  margin: 0;
}

.case-company-lookup dl > div {
  display: grid;
  gap: .12rem;
}

.case-company-lookup dt {
  color: var(--ui-text-muted);
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.case-company-lookup dd {
  margin: 0;
  font-size: .82rem;
}

.case-company-lookup__wide {
  grid-column: 1 / -1;
}

@media (max-width: 680px) {
  .case-company-lookup__controls,
  .case-company-lookup__result-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .case-company-lookup__nip {
    width: 100%;
  }

  .case-company-lookup dl {
    grid-template-columns: 1fr;
  }

  .case-company-lookup__wide {
    grid-column: auto;
  }
}
</style>
