<script setup lang="ts">
import type {
  CeidgCompanyData,
  CeidgCompanyLookupResponse,
} from '#shared/types/ceidg-company'
import type { MultiformFieldValue } from '~/types/multiform'

const props = withDefaults(defineProps<{
  applyLabel?: string
  description?: string
  fieldName?: string
  lookupUrl: string
  modelValue?: MultiformFieldValue
  required?: boolean
  invalid?: boolean
  resultHint?: string
  title?: string
}>(), {
  applyLabel: 'Uzupełnij puste pola',
  description: 'Wpisz NIP, sprawdź wynik i uzupełnij dostępne puste pola.',
  fieldName: 'businessNip',
  modelValue: '',
  required: false,
  invalid: false,
  resultHint: 'dane nie zastąpią ręcznie wpisanych wartości',
  title: 'Pobierz dane firmy z CEIDG',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:pending': [value: boolean]
  apply: [company: CeidgCompanyData, source: CeidgCompanyLookupResponse['source']]
}>()

const pending = ref(false)
const errorMessage = ref('')
const result = ref<CeidgCompanyData | null>(null)
const resultSource = ref<CeidgCompanyLookupResponse['source'] | null>(null)
const titleId = useId()

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
  if (result.value && normalizedNip.value !== result.value.nip) {
    result.value = null
    resultSource.value = null
  }
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
  if (typeof message !== 'string' || !message.trim()) {
    return 'Nie udało się pobrać danych z CEIDG.'
  }
  const knownMessages: Record<string, string> = {
    'nip checksum is invalid': 'NIP ma nieprawidłową sumę kontrolną.',
    'nip must contain 10 digits': 'NIP powinien zawierać dokładnie 10 cyfr.',
    'CEIDG API token is not configured': 'Integracja CEIDG nie została skonfigurowana.',
    'CEIDG API credentials were rejected': 'Dostęp do CEIDG wymaga ponownej konfiguracji.',
    'CEIDG API rate limit was exceeded': 'Limit zapytań do CEIDG został wyczerpany. Spróbuj później.',
    'CEIDG API is unavailable': 'CEIDG jest chwilowo niedostępne. Spróbuj ponownie.',
    'CEIDG API request failed': 'CEIDG nie obsłużyło zapytania. Spróbuj ponownie.',
    'CEIDG API returned an invalid company record': 'CEIDG zwróciło niepełne dane firmy. Spróbuj ponownie później.',
  }
  return knownMessages[message.trim()] ?? message.trim()
}

async function lookupCompany() {
  if (!canLookup.value) return
  const requestedNip = normalizedNip.value
  pending.value = true
  emit('update:pending', true)
  errorMessage.value = ''
  result.value = null
  resultSource.value = null
  emit('update:modelValue', requestedNip)
  try {
    const response = await $fetch<CeidgCompanyLookupResponse>(props.lookupUrl, {
      query: { nip: requestedNip },
    })
    if (normalizedNip.value !== requestedNip) return
    result.value = response.company
    resultSource.value = response.source
  }
  catch (error) {
    if (normalizedNip.value !== requestedNip) return
    errorMessage.value = readableLookupError(error)
  }
  finally {
    pending.value = false
    emit('update:pending', false)
  }
}

onBeforeUnmount(() => emit('update:pending', false))
</script>

<template>
  <section class="case-company-lookup" :aria-labelledby="titleId">
    <div class="case-company-lookup__heading">
      <span class="case-company-lookup__icon"><UIcon name="i-lucide-building-2" /></span>
      <div>
        <strong :id="titleId">{{ title }}</strong>
        <small>{{ description }}</small>
      </div>
    </div>

    <div class="case-company-lookup__controls">
      <UFormField
        :name="fieldName"
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
        type="button"
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
          · {{ resultHint }}
        </span>
        <UButton
          type="button"
          color="primary"
          variant="soft"
          icon="i-lucide-wand-sparkles"
          :disabled="!resultSource"
          @click="resultSource && emit('apply', result, resultSource)"
        >
          {{ applyLabel }}
        </UButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.case-company-lookup {
  grid-column: 1 / -1;
  display: grid;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
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
  min-width: 0;
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
  min-width: 0;
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
  min-width: 0;
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
  min-width: 0;
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
  overflow-wrap: anywhere;
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
