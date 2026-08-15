<script setup lang="ts">
import type { ClientListItem } from '~/types/clients'
import {
  isValidMailRecipient,
  mailRecipientInitials,
  serializeMailRecipients,
  splitMailRecipients,
  uniqueMailRecipients,
} from '~/utils/mail-recipients'

interface RecipientOption {
  email: string
  label: string
  description: string
  clientId?: string
  clientLabel?: string
  source: 'crm' | 'manual'
}

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
  autofocus?: boolean
}>(), {
  placeholder: 'Wpisz nazwę lub adres e-mail',
  disabled: false,
  autofocus: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { crmApiPath } = useOrganizationContext()
const searchTerm = ref('')
const results = ref<RecipientOption[]>([])
const knownOptions = shallowRef(new Map<string, RecipientOption>())
const pending = ref(false)
const searchError = ref('')
const mounted = ref(false)
let requestId = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined

const selectedEmails = computed<string[]>({
  get: () => uniqueMailRecipients(props.modelValue),
  set: value => emit('update:modelValue', serializeMailRecipients(value)),
})

const items = computed<RecipientOption[]>(() => {
  const options = new Map<string, RecipientOption>()
  for (const option of results.value) options.set(recipientKey(option.email), option)
  for (const email of selectedEmails.value) {
    const key = recipientKey(email)
    if (!options.has(key)) options.set(key, optionForEmail(email))
  }
  return [...options.values()]
})

const statusMessage = computed(() => {
  if (pending.value) return 'Wyszukuję klientów w CRM.'
  if (searchError.value) return 'Wyszukiwanie klientów jest chwilowo niedostępne. Nadal możesz wpisać adres ręcznie.'
  if (searchTerm.value.trim()) {
    return results.value.length
      ? `Znaleziono ${results.value.length} podpowiedzi.`
      : 'Nie znaleziono kontaktu w CRM. Możesz dodać adres ręcznie.'
  }
  return ''
})

function recipientKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function optionForEmail(email: string): RecipientOption {
  return knownOptions.value.get(recipientKey(email)) || {
    email,
    label: email,
    description: email,
    source: 'manual',
  }
}

function itemEmail(item: unknown): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object' && 'email' in item && typeof item.email === 'string') {
    return item.email
  }
  return String(item || '')
}

function itemOption(item: unknown): RecipientOption {
  return optionForEmail(itemEmail(item))
}

function itemLabel(item: unknown): string {
  const option = itemOption(item)
  return option.label || option.email
}

function itemInitials(item: unknown): string {
  const option = itemOption(item)
  return mailRecipientInitials(option.label === option.email ? null : option.label, option.email)
}

function itemIsValid(item: unknown): boolean {
  return isValidMailRecipient(itemEmail(item))
}

function rememberOptions(options: RecipientOption[]): void {
  const next = new Map(knownOptions.value)
  for (const option of options) next.set(recipientKey(option.email), option)
  knownOptions.value = next
}

function clientOptions(client: ClientListItem): RecipientOption[] {
  const candidates = [
    client.matchedPerson?.email
      ? { email: client.matchedPerson.email, name: client.matchedPerson.display_name }
      : null,
    client.primaryPerson?.email
      ? { email: client.primaryPerson.email, name: client.primaryPerson.display_name }
      : null,
    client.primary_email
      ? { email: client.primary_email, name: client.display_name }
      : null,
  ].filter((candidate): candidate is { email: string, name: string } => Boolean(candidate?.email))

  const options = new Map<string, RecipientOption>()
  for (const candidate of candidates) {
    const email = candidate.email.trim()
    const key = recipientKey(email)
    if (!email || options.has(key)) continue
    options.set(key, {
      email,
      label: candidate.name?.trim() || email,
      description: email,
      clientId: client.id,
      clientLabel: candidate.name !== client.display_name ? client.display_name : undefined,
      source: 'crm',
    })
  }
  return [...options.values()]
}

async function runSearch(query: string, currentRequestId: number): Promise<void> {
  try {
    const payload = await $fetch<{ data: ClientListItem[] }>(crmApiPath('/clients'), {
      query: {
        q: query || undefined,
        has_email: true,
        sort: query ? 'relevance' : 'updated_desc',
        limit: 8,
      },
    })
    if (currentRequestId !== requestId) return
    const options = (payload.data || []).flatMap(clientOptions)
    results.value = options
    rememberOptions(options)
  }
  catch (error: unknown) {
    if (currentRequestId !== requestId) return
    results.value = []
    searchError.value = apiErrorMessage(error)
  }
  finally {
    if (currentRequestId === requestId) pending.value = false
  }
}

function scheduleSearch(immediate = false): void {
  if (!mounted.value) return
  if (debounceTimer) clearTimeout(debounceTimer)
  const currentRequestId = ++requestId
  const query = searchTerm.value.trim()
  pending.value = true
  searchError.value = ''

  if (immediate) {
    void runSearch(query, currentRequestId)
    return
  }
  debounceTimer = setTimeout(() => void runSearch(query, currentRequestId), 250)
}

function addRecipients(value: string): void {
  const additions = splitMailRecipients(value)
  if (!additions.length) return
  selectedEmails.value = uniqueMailRecipients([...selectedEmails.value, ...additions])
  searchTerm.value = ''
}

function commitDraft(): void {
  const draft = searchTerm.value.trim()
  if (draft) addRecipients(draft)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing || ![',', ';'].includes(event.key) || !searchTerm.value.trim()) return
  event.preventDefault()
  addRecipients(searchTerm.value)
}

function handlePaste(event: ClipboardEvent): void {
  const value = event.clipboardData?.getData('text') || ''
  if (!/[;,\n]/u.test(value)) return
  event.preventDefault()
  addRecipients(value)
}

function createLabel(value: string): string {
  const recipients = splitMailRecipients(value)
  if (recipients.length > 1) return `Dodaj ${recipients.length} adresy`
  return isValidMailRecipient(value)
    ? `Dodaj ${value.trim()}`
    : `Dodaj i popraw przed wysłaniem: ${value.trim()}`
}

watch(searchTerm, () => scheduleSearch())

onMounted(() => {
  mounted.value = true
  scheduleSearch(true)
})

onBeforeUnmount(() => {
  mounted.value = false
  requestId += 1
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<template>
  <div class="mail-recipient-input">
    <UInputMenu
      v-model="selectedEmails"
      v-model:search-term="searchTerm"
      class="w-full"
      multiple
      create-item="always"
      value-key="email"
      label-key="label"
      description-key="description"
      by="email"
      :items="items"
      :placeholder="placeholder"
      :disabled="disabled"
      :autofocus="autofocus"
      :loading="pending"
      :ignore-filter="true"
      :open-on-focus="true"
      :open-on-click="true"
      :reset-search-term-on-blur="false"
      :reset-search-term-on-select="true"
      :content="{ sideOffset: 6 }"
      :ui="{
        base: 'min-h-11 items-center',
        content: 'min-w-[min(520px,calc(100vw-32px))]',
        tagsItem: 'max-w-full rounded-full py-0.5 ps-1 pe-1.5',
        tagsItemText: 'min-w-0',
      }"
      @create="addRecipients"
      @blur="commitDraft"
      @keydown="handleKeydown"
      @paste="handlePaste"
    >
      <template #tags-item-text="{ item }">
        <span class="mail-recipient-input__tag" :class="{ 'is-invalid': !itemIsValid(item) }">
          <UAvatar size="3xs" :text="itemInitials(item)" alt="" aria-hidden="true" />
          <span :title="itemEmail(item)">{{ itemLabel(item) }}</span>
          <UIcon v-if="!itemIsValid(item)" name="i-lucide-circle-alert" aria-hidden="true" />
        </span>
      </template>

      <template #item="{ item }">
        <div class="mail-recipient-input__option">
          <UAvatar
            size="2xs"
            :text="mailRecipientInitials(item.label === item.email ? null : item.label, item.email)"
            alt=""
            aria-hidden="true"
          />
          <span class="mail-recipient-input__identity">
            <strong>{{ item.label }}</strong>
            <small>{{ item.email }}</small>
            <small v-if="item.clientLabel">Klient: {{ item.clientLabel }}</small>
          </span>
          <UBadge v-if="item.source === 'crm'" color="neutral" variant="soft" size="xs">
            CRM
          </UBadge>
        </div>
      </template>

      <template #create-item-label="{ item }">
        <span class="mail-recipient-input__create" :class="{ 'is-invalid': !splitMailRecipients(item).every(isValidMailRecipient) }">
          <UIcon :name="splitMailRecipients(item).every(isValidMailRecipient) ? 'i-lucide-plus' : 'i-lucide-circle-alert'" aria-hidden="true" />
          {{ createLabel(item) }}
        </span>
      </template>

      <template #empty>
        <div class="mail-recipient-input__empty">
          <UIcon
            :name="pending
              ? 'i-lucide-loader-circle'
              : searchError
                ? 'i-lucide-wifi-off'
                : 'i-lucide-user-round-plus'"
            :class="{ 'animate-spin': pending }"
            aria-hidden="true"
          />
          <span>
            {{
              pending
                ? 'Wyszukuję klientów…'
                : searchError
                  ? 'Nie udało się pobrać podpowiedzi. Wpisz adres ręcznie.'
                  : 'Brak kontaktu w CRM. Wpisz pełny adres i naciśnij Enter.'
            }}
          </span>
        </div>
      </template>
    </UInputMenu>

    <p class="sr-only" role="status" aria-live="polite">{{ statusMessage }}</p>
  </div>
</template>

<style scoped>
.mail-recipient-input,
.mail-recipient-input__option,
.mail-recipient-input__identity {
  min-width: 0;
}

.mail-recipient-input {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.mail-recipient-input__tag {
  display: inline-flex;
  max-width: min(260px, 52vw);
  align-items: center;
  gap: 5px;
}

.mail-recipient-input__tag > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-recipient-input__tag > :deep(svg) {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}

.mail-recipient-input__tag.is-invalid,
.mail-recipient-input__create.is-invalid {
  color: var(--ui-error);
}

.mail-recipient-input__option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
}

.mail-recipient-input__identity {
  display: grid;
  flex: 1;
  gap: 1px;
}

.mail-recipient-input__identity strong,
.mail-recipient-input__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-recipient-input__identity strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.mail-recipient-input__identity small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.mail-recipient-input__create,
.mail-recipient-input__empty {
  display: flex;
  align-items: center;
  gap: 7px;
}

.mail-recipient-input__create :deep(svg),
.mail-recipient-input__empty :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.mail-recipient-input__empty {
  justify-content: center;
  padding: 8px 4px;
  color: var(--ui-text-muted);
}

@media (max-width: 640px) {
  .mail-recipient-input__tag {
    max-width: min(230px, 66vw);
  }
}
</style>
