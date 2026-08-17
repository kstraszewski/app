<script setup lang="ts">
import type { MailRecipientSearchPayload } from '#shared/types/mail'
import type { ClientListItem } from '~/types/clients'
import type {
  MailProviderRecipientSuggestion,
  MailRecipientSelection,
  MailRecipientSelectionSource,
} from '~/utils/mail-recipients'
import {
  isValidMailRecipient,
  isValidMailRecipientList,
  mailRecipientInitials,
  mailRecipientKey,
  mailRecipientMatchesSearch,
  mailRecipientSelectionKey,
  orderMailRecipientSuggestions,
  resolveUnambiguousMailRecipientSelection,
  serializeMailRecipients,
  splitMailRecipients,
  uniqueMailRecipientSuggestions,
  uniqueMailRecipients,
} from '~/utils/mail-recipients'

interface RecipientOption extends MailRecipientSelection {
  selectionKey: string
  description: string
}

interface RecipientGroupLabel extends RecipientOption {
  type: 'label'
}

type RecipientMenuItem = RecipientOption | RecipientGroupLabel

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
  autofocus?: boolean
  selections?: readonly MailRecipientSelection[]
  providerSuggestions?: readonly MailProviderRecipientSuggestion[]
  connectionId?: string
  providerLabel?: string
  lookupDisabled?: boolean
}>(), {
  placeholder: 'Wpisz nazwę lub adres e-mail',
  disabled: false,
  autofocus: false,
  providerSuggestions: () => [],
  connectionId: '',
  providerLabel: '',
  lookupDisabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selections': [value: MailRecipientSelection[]]
}>()

const { crmApiPath, orgApiPath } = useOrganizationContext()
const searchTerm = ref('')
const results = ref<RecipientOption[]>([])
const remoteProviderResults = ref<MailProviderRecipientSuggestion[]>([])
const knownOptions = shallowRef(new Map<string, RecipientOption>())
const selectedIdentities = shallowRef(new Map<string, MailRecipientSelection>())
const pending = ref(false)
const searchError = ref('')
const mounted = ref(false)
let requestId = 0
let prefillRequestId = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined

const selectedEmails = computed(() => uniqueMailRecipients(props.modelValue))
const crmOptions = computed(() => results.value
  .filter(suggestion => mailRecipientMatchesSearch(suggestion, searchTerm.value)))
const providerOptions = computed(() => {
  return uniqueMailRecipientSuggestions([
    ...props.providerSuggestions,
    ...remoteProviderResults.value,
  ])
    .filter(suggestion => mailRecipientMatchesSearch(suggestion, searchTerm.value))
    .map(toRecipientOption)
})
const suggestionOptions = computed<RecipientOption[]>(() => orderMailRecipientSuggestions([
  ...crmOptions.value,
  ...providerOptions.value,
]))
const mailboxGroupLabel = computed(() => {
  const providerLabel = props.providerLabel.trim()
  return providerLabel ? `Kontakty ${providerLabel}` : 'Kontakty z poczty'
})
const items = computed<RecipientMenuItem[][]>(() => {
  const crmSuggestions = suggestionOptions.value.filter(option => option.source === 'crm')
  const mailboxOptions = suggestionOptions.value.filter(option => option.source === 'provider')
  const groups: RecipientMenuItem[][] = []

  if (crmSuggestions.length) {
    groups.push([
      recipientGroupLabel('crm', 'Klienci CRM'),
      ...crmSuggestions,
    ])
  }
  if (mailboxOptions.length) {
    groups.push([
      recipientGroupLabel('mailbox', mailboxGroupLabel.value),
      ...mailboxOptions,
    ])
  }
  return groups
})
const canCreateDraft = computed(() => isValidMailRecipientList(searchTerm.value))
const optionsBySelectionKey = computed(() => {
  const options = new Map<string, RecipientOption>(knownOptions.value)
  for (const option of providerOptions.value) options.set(option.selectionKey, option)
  for (const selection of selectedIdentities.value.values()) {
    const option = toRecipientOption(selection)
    options.set(option.selectionKey, option)
  }
  return options
})

const selectedOptionKeys = computed<string[]>({
  get: () => selectedEmails.value.map((email) => (
    mailRecipientSelectionKey(selectionForEmail(email))
  )),
  set: (keys) => {
    const selections = keys
      .map(key => selectionForKey(key))
      .filter((selection): selection is MailRecipientSelection => Boolean(selection))
    updateSelectedRecipients(selections)
  },
})

const statusMessage = computed(() => {
  const suggestionCount = suggestionOptions.value.length
  if (pending.value) return providerOptions.value.length
    ? 'Pokazuję kontakty z poczty i wyszukuję pozostałych odbiorców.'
    : 'Wyszukuję klientów w CRM i kontakty z poczty.'
  if (searchError.value) return searchError.value
  if (searchTerm.value.trim()) {
    return suggestionCount
      ? `Znaleziono ${suggestionCount} podpowiedzi.`
      : 'Nie znaleziono kontaktu. Możesz dodać adres ręcznie.'
  }
  return ''
})

function manualSelection(email: string): MailRecipientSelection {
  return { email, label: email, source: 'manual' }
}

function recipientGroupLabel(key: string, label: string): RecipientGroupLabel {
  return {
    type: 'label',
    label,
    email: '',
    description: '',
    source: 'manual',
    selectionKey: `group:${key}`,
  }
}

function toRecipientOption(selection: MailRecipientSelection): RecipientOption {
  const email = selection.email.trim()
  const normalized = {
    ...selection,
    email,
    label: selection.label.trim() || email,
  }
  return {
    ...normalized,
    selectionKey: mailRecipientSelectionKey(normalized),
    description: email,
  }
}

function toRecipientSelection(selection: MailRecipientSelection): MailRecipientSelection {
  const option = selection as MailRecipientSelection & Partial<Pick<RecipientOption, 'selectionKey' | 'description'>>
  const { selectionKey: _selectionKey, description: _description, ...recipient } = option
  return recipient
}

function selectionForEmail(email: string): MailRecipientSelection {
  return selectedIdentities.value.get(mailRecipientKey(email)) || manualSelection(email)
}

function selectionForKey(key: string): MailRecipientSelection | undefined {
  const option = optionsBySelectionKey.value.get(key)
  return option ? toRecipientSelection(option) : undefined
}

function itemOption(item: unknown): RecipientOption {
  if (typeof item === 'string') {
    return optionsBySelectionKey.value.get(item) || toRecipientOption(manualSelection(item))
  }
  if (item && typeof item === 'object' && 'email' in item && typeof item.email === 'string') {
    return toRecipientOption(item as MailRecipientSelection)
  }
  const fallback = String(item || '')
  return toRecipientOption(manualSelection(fallback))
}

function itemEmail(item: unknown): string {
  return itemOption(item).email
}

function itemLabel(item: unknown): string {
  const option = itemOption(item)
  return option.label || option.email
}

function itemInitials(item: unknown): string {
  const option = itemOption(item)
  return mailRecipientInitials(option.label === option.email ? null : option.label, option.email)
}

function itemSource(item: unknown): MailRecipientSelectionSource {
  return itemOption(item).source
}

function itemIsValid(item: unknown): boolean {
  return isValidMailRecipient(itemEmail(item))
}

function uniqueSelectionsByEmailLast(
  selections: readonly MailRecipientSelection[],
): MailRecipientSelection[] {
  const unique: MailRecipientSelection[] = []
  const indexes = new Map<string, number>()
  for (const selection of selections) {
    const email = selection.email.trim()
    if (!email) continue
    const normalized = { ...selection, email, label: selection.label.trim() || email }
    const key = mailRecipientKey(email)
    const existingIndex = indexes.get(key)
    if (existingIndex === undefined) {
      indexes.set(key, unique.length)
      unique.push(normalized)
    }
    else {
      unique[existingIndex] = normalized
    }
  }
  return unique
}

function setSelectedIdentities(selections: readonly MailRecipientSelection[]): void {
  selectedIdentities.value = new Map(
    uniqueSelectionsByEmailLast(selections)
      .map(selection => [mailRecipientKey(selection.email), selection]),
  )
}

function updateSelectedRecipients(selections: readonly MailRecipientSelection[]): void {
  const normalized = uniqueSelectionsByEmailLast(selections)
  setSelectedIdentities(normalized)
  emit('update:modelValue', serializeMailRecipients(normalized.map(selection => selection.email)))
  emit('update:selections', normalized)
}

function synchronizeSelectedIdentities(): void {
  const current = selectedIdentities.value
  const controlledSelections = props.selections
  const next = selectedEmails.value.map((email) => {
    if (controlledSelections !== undefined) {
      return resolveUnambiguousMailRecipientSelection(email, controlledSelections)
        || manualSelection(email)
    }
    return current.get(mailRecipientKey(email)) || manualSelection(email)
  })
  setSelectedIdentities(next)
}

function rememberOptions(options: RecipientOption[]): void {
  const next = new Map<string, RecipientOption>()
  for (const option of uniqueMailRecipientSuggestions([
    ...knownOptions.value.values(),
    ...options,
  ])) {
    next.set(mailRecipientSelectionKey(option), option)
  }
  knownOptions.value = next
}

function clientOptions(client: ClientListItem): RecipientOption[] {
  const candidates = [
    client.matchedPerson?.email
      ? {
          email: client.matchedPerson.email,
          name: client.matchedPerson.display_name,
          personId: client.matchedPerson.id,
        }
      : null,
    client.primaryPerson?.email
      ? {
          email: client.primaryPerson.email,
          name: client.primaryPerson.display_name,
          personId: client.primaryPerson.id,
        }
      : null,
    client.primary_email
      ? { email: client.primary_email, name: client.display_name, personId: undefined }
      : null,
  ].filter((candidate): candidate is { email: string, name: string, personId: string | undefined } => Boolean(candidate?.email))

  const options = new Map<string, RecipientOption>()
  for (const candidate of candidates) {
    const email = candidate.email.trim()
    const key = mailRecipientKey(email)
    if (!email || options.has(key)) continue
    options.set(key, toRecipientOption({
      email,
      label: candidate.name?.trim() || email,
      clientId: client.id,
      clientLabel: client.display_name,
      personId: candidate.personId,
      source: 'crm',
    }))
  }
  return [...options.values()]
}

async function resolvePrefilledRecipients(emails: readonly string[]): Promise<void> {
  if (props.lookupDisabled) return
  const unresolvedEmails = uniqueMailRecipients(emails)
    .filter(email => (
      isValidMailRecipient(email)
      && selectionForEmail(email).source === 'manual'
    ))
  if (!unresolvedEmails.length) return

  const currentRequestId = ++prefillRequestId
  const responses = await Promise.allSettled(unresolvedEmails.map(email => (
    $fetch<{ data: ClientListItem[] }>(crmApiPath('/clients'), {
      query: {
        q: email,
        has_email: true,
        sort: 'relevance',
        limit: 8,
      },
    })
  )))
  if (!mounted.value || currentRequestId !== prefillRequestId) return

  const exactOptionsByEmail = new Map<string, RecipientOption[]>()
  responses.forEach((response, index) => {
    if (response.status !== 'fulfilled') return
    const email = unresolvedEmails[index] || ''
    const emailKey = mailRecipientKey(email)
    const exactOptions = (response.value.data || [])
      .flatMap(clientOptions)
      .filter(option => mailRecipientKey(option.email) === emailKey)
    exactOptionsByEmail.set(emailKey, exactOptions)
  })

  const exactOptions = [...exactOptionsByEmail.values()].flat()
  if (!exactOptions.length) return
  rememberOptions(exactOptions)

  let didUpgrade = false
  const upgraded = selectedEmails.value.map((email) => {
    const current = selectionForEmail(email)
    const exactSelection = resolveUnambiguousMailRecipientSelection(
      email,
      exactOptionsByEmail.get(mailRecipientKey(email)) || [],
    )
    if (!exactSelection) return current
    if (mailRecipientSelectionKey(exactSelection) !== mailRecipientSelectionKey(current)) {
      didUpgrade = true
    }
    return toRecipientSelection(exactSelection)
  })
  if (!didUpgrade) return
  setSelectedIdentities(upgraded)
  emit('update:selections', upgraded)
}

async function runSearch(query: string, currentRequestId: number): Promise<void> {
  try {
    if (!query) {
      const payload = await $fetch<{ data: ClientListItem[] }>(crmApiPath('/clients'), {
        query: {
          has_email: true,
          sort: 'updated_desc',
          limit: 8,
        },
      })
      if (currentRequestId !== requestId) return
      const options = (payload.data || []).flatMap(clientOptions)
      results.value = orderMailRecipientSuggestions(options)
      remoteProviderResults.value = []
      rememberOptions(options)
      return
    }

    const payload = await $fetch<MailRecipientSearchPayload>(orgApiPath('/mail/recipients/search'), {
      method: 'POST',
      body: {
        q: query,
        connectionId: props.connectionId || undefined,
        limit: 8,
      },
    })
    if (currentRequestId !== requestId) return
    const options = payload.data.crm.map(toRecipientOption)
    results.value = orderMailRecipientSuggestions(options)
    remoteProviderResults.value = payload.data.provider
    rememberOptions(options)

    if (payload.sources.crm === 'unavailable') {
      searchError.value = 'Wyszukiwanie klientów w CRM jest chwilowo niedostępne.'
    }
    else if (payload.sources.provider === 'unavailable') {
      searchError.value = 'Wyszukiwanie kontaktów w poczcie jest chwilowo niedostępne.'
    }
  }
  catch (error: unknown) {
    if (currentRequestId !== requestId) return
    results.value = []
    remoteProviderResults.value = []
    searchError.value = apiErrorMessage(error)
  }
  finally {
    if (currentRequestId === requestId) pending.value = false
  }
}

function scheduleSearch(immediate = false): void {
  if (!mounted.value) return
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
  }
  const currentRequestId = ++requestId
  if (props.lookupDisabled) {
    pending.value = false
    searchError.value = ''
    results.value = []
    remoteProviderResults.value = []
    return
  }
  const query = searchTerm.value.trim()
  if (query.length === 1 || query.length > 100) {
    pending.value = false
    searchError.value = ''
    return
  }
  pending.value = true
  searchError.value = ''

  if (immediate) {
    void runSearch(query, currentRequestId)
    return
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    void runSearch(query, currentRequestId)
  }, 250)
}

function addRecipients(value: string): void {
  if (!isValidMailRecipientList(value)) return
  const existing = selectedEmails.value.map(selectionForEmail)
  const existingKeys = new Set(existing.map(selection => mailRecipientKey(selection.email)))
  const additions = splitMailRecipients(value)
    .filter(email => !existingKeys.has(mailRecipientKey(email)))
    .map(manualSelection)
  if (!additions.length) {
    searchTerm.value = ''
    return
  }
  updateSelectedRecipients([...existing, ...additions])
  searchTerm.value = ''
}

function commitDraft(): void {
  const draft = searchTerm.value.trim()
  if (isValidMailRecipientList(draft)) addRecipients(draft)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing || ![',', ';'].includes(event.key) || !searchTerm.value.trim()) return
  event.preventDefault()
  commitDraft()
}

function handlePaste(event: ClipboardEvent): void {
  const value = event.clipboardData?.getData('text') || ''
  if (!/[;,\n]/u.test(value) || !isValidMailRecipientList(value)) return
  event.preventDefault()
  addRecipients(value)
}

function createLabel(value: string): string {
  const recipients = splitMailRecipients(value)
  if (recipients.length > 1) return `Dodaj ${recipients.length} adresy`
  return `Dodaj ${value.trim()}`
}

watch(
  [() => props.modelValue, () => props.selections],
  () => {
    synchronizeSelectedIdentities()
    if (mounted.value) void resolvePrefilledRecipients(selectedEmails.value)
  },
  { deep: true, immediate: true },
)
watch(
  [searchTerm, () => props.connectionId, () => props.lookupDisabled],
  () => scheduleSearch(),
)

onMounted(() => {
  mounted.value = true
  void resolvePrefilledRecipients(selectedEmails.value)
  scheduleSearch(true)
})

onBeforeUnmount(() => {
  mounted.value = false
  requestId += 1
  prefillRequestId += 1
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<template>
  <div class="mail-recipient-input">
    <UInputMenu
      v-model="selectedOptionKeys"
      v-model:search-term="searchTerm"
      class="w-full"
      multiple
      :create-item="canCreateDraft ? { when: 'always', position: 'bottom' } : false"
      value-key="selectionKey"
      label-key="label"
      description-key="description"
      by="selectionKey"
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
        content: '!max-h-96 min-w-[min(520px,calc(100vw-32px))] bg-default',
        tagsItem: 'max-w-full rounded-full py-0.5 ps-1 pe-1.5',
        tagsItemDelete: 'size-6 shrink-0 justify-center',
        tagsItemDeleteIcon: 'size-3.5',
        tagsItemText: 'min-w-0',
        tagsInput: 'min-w-12 w-12',
      }"
      @create="addRecipients"
      @blur="commitDraft"
      @keydown="handleKeydown"
      @paste="handlePaste"
    >
      <template #tags-item-text="{ item }">
        <span
          class="mail-recipient-input__tag"
          :class="{
            'is-crm': itemSource(item) === 'crm',
            'is-provider': itemSource(item) === 'provider',
            'is-invalid': !itemIsValid(item),
          }"
        >
          <UBadge
            v-if="itemSource(item) === 'crm'"
            color="success"
            variant="subtle"
            size="xs"
            icon="i-lucide-contact-round"
            class="mail-recipient-input__crm-mark"
          >
            CRM
          </UBadge>
          <UAvatar v-else size="3xs" :text="itemInitials(item)" alt="" aria-hidden="true" />
          <span class="mail-recipient-input__tag-label" :title="itemEmail(item)">{{ itemLabel(item) }}</span>
          <UIcon v-if="!itemIsValid(item)" name="i-lucide-circle-alert" aria-hidden="true" />
        </span>
      </template>

      <template #tags-item-delete="{ item }">
        <UIcon name="i-lucide-x" aria-hidden="true" />
        <span class="sr-only">Usuń {{ itemLabel(item) }}</span>
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
          <UBadge
            v-if="item.source === 'crm'"
            color="success"
            variant="subtle"
            size="xs"
            icon="i-lucide-contact-round"
          >
            CRM
          </UBadge>
          <UBadge
            v-else-if="item.source === 'provider'"
            color="neutral"
            variant="subtle"
            size="xs"
            icon="i-lucide-contact"
          >
            Kontakt
          </UBadge>
        </div>
      </template>

      <template #create-item-label="{ item }">
        <span class="mail-recipient-input__create">
          <UIcon name="i-lucide-plus" aria-hidden="true" />
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
                  : lookupDisabled
                    ? 'Brak kontaktu w poczcie. Wpisz pełny adres e-mail.'
                    : 'Nie znaleziono klienta ani kontaktu. Wpisz pełny adres e-mail.'
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

.mail-recipient-input__tag-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-recipient-input :deep([data-slot='tagsItem']:has(.mail-recipient-input__tag.is-crm)) {
  border-color: color-mix(in srgb, var(--ui-success) 34%, transparent);
  background: color-mix(in srgb, var(--ui-success) 11%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-success) 16%, transparent);
}

.mail-recipient-input__crm-mark {
  flex: 0 0 auto;
  padding-inline: 5px;
}

.mail-recipient-input__tag > :deep(svg) {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}

.mail-recipient-input__tag.is-invalid {
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
