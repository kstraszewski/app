<script setup lang="ts">
import type { CeidgCompanyData } from '#shared/types/ceidg-company'
import type { ClientMultiformFormResponse } from '~/types/client-multiform'
import type { MultiformFieldValue, MultiformFormField } from '~/types/multiform'
import { mergeCeidgCompanyIntoEmptyFields } from '~/utils/ceidg-company-prefill'

definePageMeta({ middleware: 'client-auth', layout: false })

const route = useRoute()
const toast = useToast()
const caseId = computed(() => String(route.params.caseId))
const authenticatedUser = useAuthUser()
const accountCacheScope = String(authenticatedUser.value?.sub ?? 'anonymous')
const values = ref<Record<string, MultiformFieldValue>>({})
const saving = ref<'draft' | 'complete' | null>(null)
const saveError = ref('')
const validationVisible = ref(false)
const dirty = ref(false)

const emptyResponse = (): ClientMultiformFormResponse => ({
  data: {
    case: { id: caseId.value, title: '', organization: { name: '', slug: '' } },
    applicant: { clientId: '', index: 0, label: '' },
    selectionFingerprint: '',
    revision: 0,
    fields: [],
    values: {},
    updatedAt: null,
    completedAt: null,
  },
})

const {
  data: formResponse,
  status,
  error,
  refresh,
} = await useFetch<ClientMultiformFormResponse>(
  () => `/api/client/multiform/${encodeURIComponent(caseId.value)}`,
  {
    key: `client-multiform:${accountCacheScope}:${caseId.value}`,
    default: emptyResponse,
    watch: [caseId],
  },
)

watch(formResponse, (response) => {
  values.value = { ...response.data.values }
  dirty.value = false
}, { immediate: true })

useHead(() => ({
  title: `${formResponse.value.data.case.title || 'Multiwniosek'} — OpenExpert`,
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
}))

function conditionMatches(condition?: MultiformFormField['visibleWhen']) {
  if (!condition) return true
  const value = values.value[condition.canonicalKey]
  if (value === undefined || value === null || value === '') return false
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  return expected.includes(String(value))
}

function fieldIsVisible(field: MultiformFormField) {
  return conditionMatches(field.visibleWhen)
    && (
      !field.applicableWhenAny?.length
      || field.applicableWhenAny.some(conditionMatches)
    )
}

function fieldIsRequired(field: MultiformFormField) {
  return fieldIsVisible(field)
    && (field.required || Boolean(field.requiredWhen && conditionMatches(field.requiredWhen)))
}

function valueIsMissing(field: MultiformFormField) {
  const value = values.value[field.key]
  if (field.type === 'checkbox') return value !== true
  return value === undefined || value === null || String(value).trim() === ''
}

function fieldIsInvalid(field: MultiformFormField) {
  if (!fieldIsVisible(field)) return false
  if (fieldIsRequired(field) && valueIsMissing(field)) return true
  if (valueIsMissing(field)) return false

  const rawValue = String(values.value[field.key]).trim()
  if (field.validation?.maxLength !== undefined && rawValue.length > field.validation.maxLength) return true
  if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(rawValue)) return true
  if (['number', 'currency', 'integer', 'decimal'].includes(field.type)) {
    const numeric = Number(rawValue.replace(',', '.'))
    if (!Number.isFinite(numeric)) return true
    if (field.validation?.min !== undefined && numeric < field.validation.min) return true
    if (field.validation?.max !== undefined && numeric > field.validation.max) return true
    if (field.validation?.integer && !Number.isInteger(numeric)) return true
  }
  return false
}

const visibleFields = computed(() => formResponse.value.data.fields.filter(fieldIsVisible))
const requiredFields = computed(() => visibleFields.value.filter(fieldIsRequired))
const invalidFields = computed(() => visibleFields.value.filter(fieldIsInvalid))
const completedRequiredCount = computed(() => (
  requiredFields.value.filter(field => !valueIsMissing(field)).length
))
const progress = computed(() => requiredFields.value.length
  ? Math.round((completedRequiredCount.value / requiredFields.value.length) * 100)
  : 100)
const companyNipField = computed(() => visibleFields.value.find(field => (
  field.collection?.relativeKey === 'businessNip'
)))
const companyLookupUrl = computed(() => (
  `/api/client/multiform/${encodeURIComponent(caseId.value)}/company`
))
const loadErrorMessage = computed(() => {
  const caught = error.value as any
  return caught?.data?.statusMessage
    ?? caught?.statusMessage
    ?? 'Dostęp mógł zostać cofnięty albo zakres wniosku się zmienił.'
})

const fieldGroups = computed(() => {
  const groups = new Map<string, MultiformFormField[]>()
  for (const field of visibleFields.value) {
    if (field.key === companyNipField.value?.key) continue
    const section = field.section || 'Pozostałe informacje'
    groups.set(section, [...(groups.get(section) ?? []), field])
  }
  return Array.from(groups, ([section, fields]) => ({ section, fields }))
})

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : ''
}

function updateValue(key: string, value: MultiformFieldValue) {
  values.value[key] = value
  dirty.value = true
  saveError.value = ''
}

function applyCeidgCompany(company: CeidgCompanyData) {
  const merge = mergeCeidgCompanyIntoEmptyFields(
    values.value,
    new Set(formResponse.value.data.fields.map(field => field.key)),
    formResponse.value.data.applicant.index,
    company,
  )
  values.value = merge.values
  dirty.value = true
  toast.add({
    title: merge.filledCount ? 'Dane firmy uzupełnione' : 'Dane firmy były już wpisane',
    description: `Uzupełniono ${merge.filledCount} pól na podstawie CEIDG.`,
    color: merge.filledCount ? 'success' : 'neutral',
  })
}

function readableError(caught: any) {
  return caught?.data?.statusMessage
    ?? caught?.statusMessage
    ?? caught?.message
    ?? 'Nie udało się zapisać formularza.'
}

async function save(completed: boolean) {
  if (saving.value) return
  validationVisible.value = completed
  if (completed && invalidFields.value.length) {
    saveError.value = `Uzupełnij lub popraw oznaczone pola (${invalidFields.value.length}).`
    await nextTick()
    document.querySelector<HTMLElement>('[data-client-multiform-invalid="true"]')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
    return
  }

  saving.value = completed ? 'complete' : 'draft'
  saveError.value = ''
  try {
    const response = await $fetch<ClientMultiformFormResponse>(
      `/api/client/multiform/${encodeURIComponent(caseId.value)}`,
      {
        method: 'PUT',
        body: {
          selectionFingerprint: formResponse.value.data.selectionFingerprint,
          revision: formResponse.value.data.revision,
          values: values.value,
          completed,
        },
      },
    )
    formResponse.value = response
    values.value = { ...response.data.values }
    dirty.value = false
    toast.add({
      title: completed ? 'Formularz przekazany ekspertowi' : 'Szkic zapisany',
      description: completed
        ? 'Ekspert zobaczy Twoje dane w tej samej sprawie.'
        : 'Możesz bezpiecznie wrócić do formularza później.',
      color: 'success',
      icon: completed ? 'i-lucide-send' : 'i-lucide-cloud-check',
    })
  }
  catch (caught) {
    saveError.value = readableError(caught)
  }
  finally {
    saving.value = null
  }
}
</script>

<template>
  <ClientPortalShell
    eyebrow="Multiwniosek"
    :title="formResponse.data.case.title || 'Twoje dane do wniosku'"
    :description="formResponse.data.case.organization.name
      ? `Formularz udostępniony przez ${formResponse.data.case.organization.name}. Uzupełniasz wyłącznie własną część wniosku.`
      : 'Uzupełniasz wyłącznie własną część wniosku.'"
  >
    <div class="client-multiform__back">
      <UButton to="/client" color="neutral" variant="ghost" icon="i-lucide-arrow-left">
        Wróć do panelu
      </UButton>
    </div>

    <div v-if="status === 'pending'" class="client-multiform__loading" aria-label="Ładowanie formularza">
      <USkeleton class="h-28 w-full" />
      <USkeleton class="h-80 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-file-lock-2"
      title="Nie udało się otworzyć formularza"
      :description="loadErrorMessage"
    >
      <template #actions>
        <UButton color="error" variant="soft" @click="refresh()">Spróbuj ponownie</UButton>
      </template>
    </UAlert>

    <template v-else>
      <UAlert
        v-if="formResponse.data.completedAt && !dirty"
        class="mb-5"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check-big"
        title="Formularz został przekazany ekspertowi"
        :description="`Ostatnie przekazanie: ${formatDate(formResponse.data.completedAt)}. Nadal możesz poprawić dane i wysłać je ponownie.`"
      />

      <UCard class="client-multiform__status-card">
        <div class="client-multiform__status-copy">
          <span><UIcon name="i-lucide-user-round-check" /></span>
          <div>
            <small>Twoja część formularza</small>
            <strong>{{ formResponse.data.applicant.label }}</strong>
            <p>Ekspert i pozostali wnioskodawcy nie są edytowani z tego widoku.</p>
          </div>
        </div>
        <div class="client-multiform__progress">
          <span>{{ completedRequiredCount }}/{{ requiredFields.length }} wymaganych</span>
          <strong>{{ progress }}%</strong>
          <UProgress :model-value="progress" color="primary" />
        </div>
      </UCard>

      <UCard v-if="companyNipField" class="client-multiform__company-card">
        <template #header>
          <div>
            <small>Działalność gospodarcza</small>
            <h2>Pobierz dane firmy po NIP</h2>
            <p>Nazwa, REGON, adresy, status i kody PKD uzupełnią puste pola formularza.</p>
          </div>
        </template>
        <CaseMultiformCompanyLookup
          :lookup-url="companyLookupUrl"
          :model-value="values[companyNipField.key]"
          @update:model-value="updateValue(companyNipField.key, $event)"
          @apply="applyCeidgCompany"
        />
      </UCard>

      <form class="client-multiform__form" @submit.prevent="save(true)">
        <fieldset
          v-for="group in fieldGroups"
          :key="group.section"
          class="client-multiform__section"
        >
          <legend>{{ group.section }}</legend>
          <div class="client-multiform__grid">
            <div
              v-for="field in group.fields"
              :key="field.key"
              :data-client-multiform-invalid="validationVisible && fieldIsInvalid(field) ? 'true' : undefined"
            >
              <CaseMultiformField
                :field="field"
                :model-value="values[field.key]"
                :required="fieldIsRequired(field)"
                :invalid="validationVisible && fieldIsInvalid(field)"
                @update:model-value="updateValue(field.key, $event)"
              />
            </div>
          </div>
        </fieldset>

        <UAlert
          v-if="saveError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się zapisać"
          :description="saveError"
        />

        <footer class="client-multiform__actions">
          <div>
            <UIcon name="i-lucide-shield-check" />
            <span>Dane trafiają bezpośrednio do sprawy prowadzonej przez eksperta.</span>
          </div>
          <div>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-save"
              :loading="saving === 'draft'"
              :disabled="Boolean(saving)"
              @click="save(false)"
            >
              Zapisz szkic
            </UButton>
            <UButton
              type="submit"
              icon="i-lucide-send"
              :loading="saving === 'complete'"
              :disabled="Boolean(saving)"
            >
              Zapisz i przekaż ekspertowi
            </UButton>
          </div>
        </footer>
      </form>
    </template>
  </ClientPortalShell>
</template>

<style scoped>
.client-multiform__back {
  margin: -18px 0 20px;
}

.client-multiform__loading,
.client-multiform__form {
  display: grid;
  gap: 20px;
}

.client-multiform__status-card :deep(.divide-y),
.client-multiform__status-card :deep(.p-6) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
}

.client-multiform__status-copy,
.client-multiform__status-copy > span,
.client-multiform__actions,
.client-multiform__actions > div {
  display: flex;
  align-items: center;
}

.client-multiform__status-copy {
  gap: 14px;
}

.client-multiform__status-copy > span {
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  justify-content: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 22px;
}

.client-multiform__status-copy div {
  display: grid;
  gap: 2px;
}

.client-multiform__status-copy small,
.client-multiform__company-card small {
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.client-multiform__status-copy strong {
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.client-multiform__status-copy p,
.client-multiform__company-card p {
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 13px;
}

.client-multiform__progress {
  display: grid;
  width: min(230px, 34vw);
  grid-template-columns: 1fr auto;
  gap: 7px 12px;
}

.client-multiform__progress span {
  color: var(--ui-text-toned);
  font-size: 12px;
}

.client-multiform__progress strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.client-multiform__progress :deep([role="progressbar"]) {
  grid-column: 1 / -1;
}

.client-multiform__company-card h2,
.client-multiform__company-card p {
  margin: 0;
}

.client-multiform__company-card h2 {
  margin-top: 4px;
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.client-multiform__company-card p {
  margin-top: 5px;
}

.client-multiform__section {
  display: grid;
  gap: 18px;
  margin: 0;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  padding: 22px;
  background: var(--ui-bg);
}

.client-multiform__section legend {
  padding: 0 8px;
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 750;
}

.client-multiform__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.client-multiform__grid > div:has(textarea),
.client-multiform__grid > div:has([role="checkbox"]) {
  grid-column: 1 / -1;
}

.client-multiform__actions {
  position: sticky;
  z-index: 5;
  bottom: 14px;
  justify-content: space-between;
  gap: 20px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  padding: 14px;
  background: color-mix(in srgb, var(--ui-bg) 92%, transparent);
  box-shadow: 0 18px 45px color-mix(in srgb, var(--ui-text) 10%, transparent);
  backdrop-filter: blur(16px);
}

.client-multiform__actions > div {
  gap: 9px;
}

.client-multiform__actions > div:first-child {
  color: var(--ui-text-toned);
  font-size: 12px;
}

@media (max-width: 760px) {
  .client-multiform__status-card :deep(.divide-y),
  .client-multiform__status-card :deep(.p-6),
  .client-multiform__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .client-multiform__progress {
    width: 100%;
  }

  .client-multiform__grid {
    grid-template-columns: 1fr;
  }

  .client-multiform__grid > div {
    grid-column: auto;
  }

  .client-multiform__actions {
    position: static;
  }

  .client-multiform__actions > div:last-child {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
