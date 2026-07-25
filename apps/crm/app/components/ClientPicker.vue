<script setup lang="ts">
import type { ClientListItem } from '~/types/clients'

const props = withDefaults(defineProps<{
  modelValue: ClientListItem | null
  placeholder?: string
  disabled?: boolean
  autofocus?: boolean
  limit?: number
  id?: string
  required?: boolean
}>(), {
  placeholder: 'Imię, nazwisko, telefon, e-mail lub PESEL',
  disabled: false,
  autofocus: false,
  limit: 12,
  id: undefined,
  required: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: ClientListItem | null]
  'error': [message: string]
}>()

const { crmApiPath } = useOrganizationContext()
const results = ref<ClientListItem[]>([])
const searchTerm = ref('')
const pending = ref(false)
const errorMessage = ref('')
const mounted = ref(false)
let requestId = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined
const generatedId = useId()
const inputId = computed(() => props.id || `client-picker-${generatedId}`)
const hintId = computed(() => `${inputId.value}-hint`)
const errorId = computed(() => `${inputId.value}-error`)

const items = computed(() => {
  const byId = new Map<string, ClientListItem>()
  if (props.modelValue) byId.set(props.modelValue.id, props.modelValue)
  for (const client of results.value) byId.set(client.id, client)
  return [...byId.values()]
})

const selectedId = computed<string | null>({
  get: () => props.modelValue?.id ?? null,
  set: (value) => {
    const client = value
      ? items.value.find(item => item.id === value) ?? null
      : null
    emit('update:modelValue', client)
  },
})

function contactLabel(client: ClientListItem) {
  const person = client.matchedPerson ?? client.primaryPerson
  const values = [
    client.primary_email || person?.email,
    client.primary_phone || person?.phone,
  ].filter(Boolean)
  return values.join(' · ') || 'Brak danych kontaktowych'
}

function identityLabel(client: ClientListItem) {
  const person = client.matchedPerson ?? client.primaryPerson
  if (!person) return ''

  const values: string[] = []
  if (person.display_name && person.display_name !== client.display_name) {
    values.push(person.display_name)
  }
  if (person.pesel_last4) values.push(`PESEL •••••••${person.pesel_last4}`)
  return values.join(' · ')
}

async function runSearch(query: string, currentRequestId: number) {
  try {
    const payload = await $fetch<{ data: ClientListItem[] }>(crmApiPath('/clients'), {
      query: {
        q: query || undefined,
        sort: query ? 'relevance' : 'updated_desc',
        limit: Math.min(Math.max(props.limit, 1), 50),
      },
    })
    if (currentRequestId !== requestId) return
    results.value = payload.data ?? []
  } catch (error: unknown) {
    if (currentRequestId !== requestId) return
    results.value = []
    errorMessage.value = apiErrorMessage(error)
    emit('error', errorMessage.value)
  } finally {
    if (currentRequestId === requestId) pending.value = false
  }
}

function scheduleSearch(immediate = false) {
  if (!mounted.value) return
  if (debounceTimer) clearTimeout(debounceTimer)
  const currentRequestId = ++requestId
  const query = searchTerm.value.trim()
  pending.value = true
  errorMessage.value = ''
  if (immediate) {
    void runSearch(query, currentRequestId)
    return
  }
  debounceTimer = setTimeout(() => {
    void runSearch(query, currentRequestId)
  }, 250)
}

watch(searchTerm, () => scheduleSearch())

function refresh() {
  scheduleSearch(true)
}

onMounted(() => {
  mounted.value = true
  scheduleSearch(true)
})

onBeforeUnmount(() => {
  mounted.value = false
  requestId += 1
  if (debounceTimer) clearTimeout(debounceTimer)
})

defineExpose({ refresh })
</script>

<template>
  <div class="client-picker">
    <UInputMenu
      :id="inputId"
      v-model="selectedId"
      v-model:search-term="searchTerm"
      class="w-full"
      :items="items"
      value-key="id"
      label-key="display_name"
      by="id"
      icon="i-lucide-user-search"
      trailing-icon="i-lucide-chevrons-up-down"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :autofocus="autofocus"
      :loading="pending"
      :ignore-filter="true"
      :clear="true"
      :open-on-focus="true"
      :open-on-click="true"
      :reset-search-term-on-blur="true"
      :reset-search-term-on-select="true"
      :content="{ sideOffset: 6 }"
      :ui="{ content: 'min-w-[min(520px,calc(100vw-32px))]' }"
      :aria-describedby="`${hintId}${errorMessage ? ` ${errorId}` : ''}`"
      :aria-invalid="errorMessage ? 'true' : undefined"
    >
      <template #item="{ item }">
        <div class="client-picker__item">
          <div class="client-picker__identity">
            <strong>{{ item.display_name }}</strong>
            <small>{{ contactLabel(item) }}</small>
            <small v-if="identityLabel(item)" class="client-picker__person">
              {{ identityLabel(item) }}
            </small>
          </div>
          <CrmStatusBadge :status="item.status_code" />
        </div>
      </template>

      <template #empty>
        <div class="client-picker__empty">
          <UIcon
            :name="pending
              ? 'i-lucide-loader-circle'
              : errorMessage
                ? 'i-lucide-wifi-off'
                : 'i-lucide-user-x'"
            :class="{ 'animate-spin': pending }"
          />
          <span>
            {{
              pending
                ? 'Wyszukuję klientów…'
                : errorMessage
                  ? 'Wyszukiwanie jest chwilowo niedostępne'
                  : 'Nie znaleziono klienta'
            }}
          </span>
        </div>
      </template>
    </UInputMenu>

    <p :id="hintId" class="client-picker__hint">
      Szukaj po nazwie, osobie kontaktowej, telefonie, e-mailu, PESEL-u, NIP-ie, REGON-ie lub KRS-ie.
    </p>

    <UAlert
      v-if="errorMessage"
      :id="errorId"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się wyszukać klientów"
      :description="errorMessage"
      :actions="[{ label: 'Spróbuj ponownie', onClick: refresh }]"
    />
  </div>
</template>

<style scoped>
.client-picker {
  display: grid;
  gap: 7px;
  width: 100%;
}

.client-picker__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  min-width: 0;
}

.client-picker__identity {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.client-picker__identity strong,
.client-picker__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-picker__identity strong {
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.client-picker__identity small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-picker__identity .client-picker__person {
  color: var(--ui-text-dimmed);
}

.client-picker__hint {
  margin: 0;
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.client-picker__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 4px;
  color: var(--ui-text-muted);
}
</style>
