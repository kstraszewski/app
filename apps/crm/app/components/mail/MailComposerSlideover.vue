<script setup lang="ts">
import type { FormError, FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import type {
  MailComposerContextCasesPayload,
  MailContextScope,
  MailProviderId,
  MailSendPayload,
} from '#shared/types/mail'
import { gmailBlockedAttachmentExtension } from '#shared/utils/mail-security'
import { apiErrorMessage } from '~/utils/api-error'
import type {
  MailProviderRecipientSuggestion,
  MailRecipientSelection,
} from '~/utils/mail-recipients'
import {
  isValidMailRecipient,
  mailRecipientKey,
  splitMailRecipients,
  uniqueMailRecipientSelections,
} from '~/utils/mail-recipients'

interface ComposerForm {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  contextCaseId: string
}

interface ComposerContextClient {
  id: string
  label: string
  isPrimary?: boolean
  composeTo?: string[]
}

interface ComposerContextCase {
  id: string
  label: string
  closedAt?: string | null
}

interface ComposerClientIdentity {
  id: string
  label: string
  email?: string
}

const props = withDefaults(defineProps<{
  open: boolean
  endpoint: string
  connectionId: string
  provider: MailProviderId
  providerLabel: string
  providerIcon: string
  accountEmail: string
  externalSentUrl?: string | null
  maxAttachmentBytes?: number
  maxTotalAttachmentBytes?: number
  initialTo?: string
  initialCc?: string
  initialSubject?: string
  initialBody?: string
  threadId?: string
  contextType?: 'client' | 'case'
  contextId?: string
  contextLabel?: string
  contextClients?: readonly ComposerContextClient[]
  contextCases?: readonly ComposerContextCase[]
  providerSuggestions?: readonly MailProviderRecipientSuggestion[]
  preview?: boolean
}>(), {
  initialTo: '',
  initialCc: '',
  initialSubject: '',
  initialBody: '',
  threadId: '',
  externalSentUrl: null,
  maxAttachmentBytes: 3 * 1024 * 1024,
  maxTotalAttachmentBytes: 3 * 1024 * 1024,
  contextLabel: '',
  contextClients: () => [],
  contextCases: () => [],
  providerSuggestions: () => [],
  preview: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  sent: [value: MailSendPayload['data']]
}>()

const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const discardConfirmationOpen = ref(false)
const sendConfirmationOpen = ref(false)
const sentSuccessfully = ref(false)
const openModel = computed({
  get: () => props.open,
  set: (value) => {
    if (
      !value
      && props.open
      && !sentSuccessfully.value
      && hasChanges.value
      && !sending.value
    ) {
      discardConfirmationOpen.value = true
      return
    }
    emit('update:open', value)
  },
})
const form = reactive<ComposerForm>({
  to: props.initialTo,
  cc: props.initialCc,
  bcc: '',
  subject: props.initialSubject,
  body: props.initialBody,
  contextCaseId: props.contextType === 'case' ? props.contextId || '' : '',
})
const toSelections = ref<MailRecipientSelection[]>(initialRecipientSelections(props.initialTo, true))
const ccSelections = ref<MailRecipientSelection[]>(initialRecipientSelections(props.initialCc))
const bccSelections = ref<MailRecipientSelection[]>([])
const attachments = ref<File[]>([])
const showCc = ref(Boolean(props.initialCc))
const showBcc = ref(false)
const sending = ref(false)
const sendError = ref('')
const deliveryAmbiguous = ref(false)
const idempotencyKey = ref('')
const lastAttemptFingerprint = ref('')
const lastAttemptContentFingerprint = ref('')
const lastAttemptContexts = ref<MailContextScope[] | null>(null)
const contextCasesLoading = ref(false)
const contextCasesError = ref('')
const fetchedCasesByClient = shallowRef(new Map<string, ComposerContextCase[]>())
let contextCasesRequestId = 0
const isReply = computed(() => Boolean(props.threadId))
const title = computed(() => isReply.value ? 'Odpowiedz w wątku' : 'Nowa wiadomość')
const attachmentBytes = computed(() => (
  attachments.value.reduce((total, file) => total + file.size, 0)
))
const attachmentError = computed(() => {
  if (attachments.value.length > 10) return 'Możesz dodać maksymalnie 10 załączników.'
  if (attachments.value.some(file => file.size <= 0)) return 'Załącznik nie może być pusty.'
  if (attachments.value.some(file => file.size > props.maxAttachmentBytes)) {
    return `Pojedynczy załącznik nie może przekraczać ${formatBytes(props.maxAttachmentBytes)}.`
  }
  if (attachmentBytes.value > props.maxTotalAttachmentBytes) {
    return `Łączny rozmiar załączników nie może przekraczać ${formatBytes(props.maxTotalAttachmentBytes)}.`
  }
  const blockedFile = props.provider === 'google'
    ? attachments.value.find(file => gmailBlockedAttachmentExtension(file.name))
    : undefined
  if (blockedFile) {
    const extension = gmailBlockedAttachmentExtension(blockedFile.name)
    return `Gmail blokuje załączniki .${extension}. Wybierz bezpieczny format pliku.`
  }
  return ''
})
const hasChanges = computed(() => (
  recipientFieldFingerprint(form.to) !== recipientFieldFingerprint(props.initialTo)
  || recipientFieldFingerprint(form.cc) !== recipientFieldFingerprint(props.initialCc)
  || form.bcc !== ''
  || form.subject !== props.initialSubject
  || form.body !== props.initialBody
  || attachments.value.length > 0
))
const uniqueRecipientCount = computed(() => new Set(
  [form.to, form.cc, form.bcc]
    .flatMap(value => splitMailRecipients(value))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
).size)
const recipientCountLabel = computed(() => {
  const count = uniqueRecipientCount.value
  if (count === 1) return '1 adres'
  if (count > 1 && count < 5) return `${count} adresy`
  return `${count} adresów`
})
const selectedRecipientClients = computed<ComposerClientIdentity[]>(() => {
  const clients = new Map<string, ComposerClientIdentity>()
  for (const selection of uniqueMailRecipientSelections([
    ...toSelections.value,
    ...ccSelections.value,
  ])) {
    if (selection.source !== 'crm' || !selection.clientId) continue
    clients.set(selection.clientId, {
      id: selection.clientId,
      label: selection.clientLabel?.trim() || selection.label.trim() || selection.email,
      email: selection.email,
    })
  }
  return [...clients.values()]
})
const caseRelatedClientIds = computed(() => new Set(
  props.contextClients.map(client => client.id),
))
const caseClientMismatch = computed(() => (
  props.contextType === 'case'
  && caseRelatedClientIds.value.size > 0
  && selectedRecipientClients.value.some(client => !caseRelatedClientIds.value.has(client.id))
))
const crmContextClients = computed<ComposerClientIdentity[]>(() => {
  const clients = new Map<string, ComposerClientIdentity>()
  if (props.contextType === 'client' && props.contextId) {
    clients.set(props.contextId, {
      id: props.contextId,
      label: props.contextLabel.trim() || 'Bieżący klient',
      email: splitMailRecipients(props.initialTo)[0],
    })
  }
  for (const client of selectedRecipientClients.value) clients.set(client.id, client)

  if (props.contextType === 'case' && !clients.size) {
    const fallback = props.contextClients.find(client => client.isPrimary)
      || (props.contextClients.length === 1 ? props.contextClients[0] : undefined)
    if (fallback) {
      clients.set(fallback.id, {
        id: fallback.id,
        label: fallback.label,
        email: fallback.composeTo?.[0],
      })
    }
  }
  return [...clients.values()]
})
const crmContextClientIds = computed(() => crmContextClients.value.map(client => client.id))
const fixedContextCase = computed<ComposerContextCase | null>(() => (
  props.contextType === 'case' && props.contextId
    ? {
        id: props.contextId,
        label: props.contextLabel.trim() || 'Bieżąca sprawa',
        closedAt: null,
      }
    : null
))
const availableContextCases = computed<ComposerContextCase[]>(() => {
  if (fixedContextCase.value) return [fixedContextCase.value]
  const clientIds = crmContextClientIds.value
  if (!clientIds.length) return []

  const casesByClient = clientIds.map((clientId) => {
    if (props.contextType === 'client' && clientId === props.contextId && props.contextCases.length) {
      return [...props.contextCases]
    }
    return fetchedCasesByClient.value.get(clientId) || []
  })
  if (casesByClient.some(cases => !cases.length)) return []

  const remainingIds = casesByClient.slice(1).map(cases => new Set(cases.map(item => item.id)))
  return casesByClient[0]!
    .filter(item => remainingIds.every(ids => ids.has(item.id)))
    .sort((left, right) => {
      const closedDifference = Number(Boolean(left.closedAt)) - Number(Boolean(right.closedAt))
      return closedDifference || left.label.localeCompare(right.label, 'pl')
    })
})
const selectedContextCase = computed<ComposerContextCase | null>(() => (
  fixedContextCase.value
  || availableContextCases.value.find(item => item.id === form.contextCaseId)
  || null
))
const contextCaseItems = computed(() => availableContextCases.value.map(item => ({
  label: item.closedAt ? `${item.label} · zamknięta` : item.label,
  value: item.id,
})))
const contextCaseSelectionRequired = computed(() => (
  !fixedContextCase.value
  && crmContextClients.value.length > 0
  && availableContextCases.value.length > 0
  && !selectedContextCase.value
))
const contextScopes = computed<MailContextScope[]>(() => {
  const scopes: MailContextScope[] = crmContextClients.value
    .slice(0, 10)
    .map(client => ({ type: 'client', id: client.id }))
  if (selectedContextCase.value) {
    scopes.push({ type: 'case', id: selectedContextCase.value.id })
  }
  return scopes.sort((left, right) => (
    left.type.localeCompare(right.type) || left.id.localeCompare(right.id)
  ))
})
const hasCrmContext = computed(() => (
  crmContextClients.value.length > 0
  || Boolean(fixedContextCase.value)
  || contextCasesLoading.value
  || Boolean(contextCasesError.value)
))
const hasCompleteCrmContext = computed(() => (
  crmContextClients.value.length > 0 && Boolean(selectedContextCase.value)
))
const sendActionLabel = computed(() => (
  hasCompleteCrmContext.value
    ? 'Wyślij i przypnij'
    : contextScopes.value.length ? 'Wyślij i przypisz' : 'Wyślij'
))
const contextSummary = computed(() => {
  if (hasCompleteCrmContext.value) {
    return 'Po wysłaniu cały wątek pojawi się przy kliencie i sprawie.'
  }
  if (crmContextClients.value.length) {
    return availableContextCases.value.length
      ? 'Wybierz sprawę, aby wątek był widoczny przy kliencie i sprawie.'
      : 'Wątek zostanie przypięty do klienta. Nie znaleziono jego powiązanej sprawy.'
  }
  if (fixedContextCase.value) return 'Po wysłaniu cały wątek pojawi się przy tej sprawie.'
  return ''
})
const requiresSendConfirmation = computed(() => (
  attachments.value.length > 0
  || uniqueRecipientCount.value > 1
  || Boolean(form.bcc.trim())
))
const sendErrorTitle = computed(() => deliveryAmbiguous.value
  ? 'Nie udało się potwierdzić wysyłki'
  : 'Nie udało się wysłać wiadomości')
const attachmentDescription = computed(() => {
  const base = `Do 10 plików, maks. ${formatBytes(props.maxAttachmentBytes)} każdy i ${formatBytes(props.maxTotalAttachmentBytes)} łącznie.`
  return props.provider === 'google'
    ? `${base} Gmail blokuje pliki wykonywalne i skrypty.`
    : base
})

function initialRecipientSelections(
  value: string,
  useClientContext = false,
): MailRecipientSelection[] {
  return splitMailRecipients(value).map((email, index) => {
    if (useClientContext && index === 0 && props.contextType === 'client' && props.contextId) {
      return {
        email,
        label: props.contextLabel.trim() || email,
        source: 'crm' as const,
        clientId: props.contextId,
      }
    }
    const relatedClient = props.contextClients.find(client => (
      client.composeTo?.some(candidate => mailRecipientKey(candidate) === mailRecipientKey(email))
    ))
    if (relatedClient) {
      return {
        email,
        label: relatedClient.label,
        source: 'crm' as const,
        clientId: relatedClient.id,
      }
    }
    const providerSuggestion = props.providerSuggestions.find(suggestion => (
      mailRecipientKey(suggestion.email) === mailRecipientKey(email)
    ))
    return providerSuggestion
      ? { ...providerSuggestion, email }
      : { email, label: email, source: 'manual' as const }
  })
}

function recipientFieldFingerprint(value: string): string {
  return [...new Set(
    splitMailRecipients(value).map(email => mailRecipientKey(email)),
  )].join('\n')
}

async function loadContextCases(clientIds: readonly string[]): Promise<void> {
  const currentRequestId = ++contextCasesRequestId
  if (fixedContextCase.value || !clientIds.length) {
    contextCasesLoading.value = false
    contextCasesError.value = ''
    return
  }
  const missingIds = clientIds.filter((clientId) => {
    if (fetchedCasesByClient.value.has(clientId)) return false
    return !(props.contextType === 'client'
      && clientId === props.contextId
      && props.contextCases.length)
  })
  if (!missingIds.length) {
    contextCasesLoading.value = false
    contextCasesError.value = ''
    return
  }

  contextCasesLoading.value = true
  contextCasesError.value = ''
  try {
    const payload = await $fetch<MailComposerContextCasesPayload>(
      crmApiPath('/cases/composer-context'),
      {
        method: 'POST',
        body: { clientIds: missingIds },
      },
    )
    if (currentRequestId !== contextCasesRequestId) return

    const next = new Map(fetchedCasesByClient.value)
    for (const item of payload.data) next.set(item.clientId, item.cases)
    fetchedCasesByClient.value = next
    contextCasesError.value = ''
  }
  catch {
    if (currentRequestId !== contextCasesRequestId) return
    contextCasesError.value = 'Nie udało się pobrać wszystkich spraw. Spróbuj ponownie.'
  }
  finally {
    if (currentRequestId === contextCasesRequestId) contextCasesLoading.value = false
  }
}

watch(crmContextClientIds, ids => void loadContextCases(ids), { immediate: true })
watch(availableContextCases, (cases) => {
  if (fixedContextCase.value) {
    form.contextCaseId = fixedContextCase.value.id
    return
  }
  if (form.contextCaseId && cases.some(item => item.id === form.contextCaseId)) return
  const activeCases = cases.filter(item => !item.closedAt)
  form.contextCaseId = activeCases.length === 1 ? activeCases[0]!.id : ''
}, { immediate: true })

function validateComposer(state: Partial<ComposerForm>): FormError[] {
  const errors: FormError[] = []
  const recipientGroups = [
    recipientFieldErrors(errors, 'to', state.to || '', true),
    recipientFieldErrors(errors, 'cc', state.cc || '', false),
    recipientFieldErrors(errors, 'bcc', state.bcc || '', false),
  ]
  const uniqueRecipients = new Set(
    recipientGroups.flat().map(recipient => recipient.toLowerCase()),
  )
  if (uniqueRecipients.size > 50) {
    errors.push({
      name: 'to',
      message: 'Wiadomość może mieć łącznie maksymalnie 50 odbiorców.',
    })
  }
  if (!deliveryAmbiguous.value && crmContextClients.value.length > 10) {
    errors.push({
      name: 'to',
      message: 'Jedną wiadomość możesz przypiąć do maksymalnie 10 klientów.',
    })
  }
  if (!deliveryAmbiguous.value && caseClientMismatch.value) {
    errors.push({
      name: 'to',
      message: 'Wybrany klient nie jest powiązany z bieżącą sprawą.',
    })
  }
  if (!deliveryAmbiguous.value && contextCaseSelectionRequired.value) {
    errors.push({
      name: 'contextCaseId',
      message: 'Wybierz sprawę, do której ma zostać przypięty wątek.',
    })
  }
  if (!deliveryAmbiguous.value && contextCasesError.value && !fixedContextCase.value) {
    errors.push({
      name: 'contextCaseId',
      message: contextCasesError.value,
    })
  }
  const subject = state.subject?.trim() || ''
  if (!subject) errors.push({ name: 'subject', message: 'Podaj temat wiadomości.' })
  else if (subject.length > 500) {
    errors.push({ name: 'subject', message: 'Temat może mieć maksymalnie 500 znaków.' })
  }
  if ((state.body?.length || 0) > 200_000) {
    errors.push({ name: 'body', message: 'Treść wiadomości jest zbyt długa.' })
  }
  if (!state.body?.trim() && !attachments.value.length) {
    errors.push({ name: 'body', message: 'Dodaj treść lub co najmniej jeden załącznik.' })
  }
  if (attachmentError.value) {
    errors.push({ name: 'attachments', message: attachmentError.value })
  }
  return errors
}

function recipientFieldErrors(
  errors: FormError[],
  name: 'to' | 'cc' | 'bcc',
  value: string,
  required: boolean,
): string[] {
  const recipients = splitMailRecipients(value)
  if (required && !recipients.length) {
    errors.push({ name, message: 'Podaj co najmniej jednego odbiorcę.' })
    return recipients
  }
  if (
    recipients.length > 50
    || recipients.some(recipient => !isValidMailRecipient(recipient))
  ) {
    errors.push({
      name,
      message: 'Popraw zaznaczony adres e-mail.',
    })
  }
  return recipients
}

async function requestSend(_event: FormSubmitEvent<ComposerForm>): Promise<void> {
  if (
    sending.value
    || attachmentError.value
    || (contextCasesLoading.value && !deliveryAmbiguous.value)
  ) return
  if (requiresSendConfirmation.value) {
    sendConfirmationOpen.value = true
    return
  }
  await sendMessage()
}

async function sendMessage(): Promise<void> {
  if (
    sending.value
    || attachmentError.value
    || (contextCasesLoading.value && !deliveryAmbiguous.value)
  ) return
  sendConfirmationOpen.value = false
  if (props.preview) {
    toast.add({
      title: 'To jest bezpieczny podgląd composera',
      description: 'W trybie podglądu żadna wiadomość nie zostanie wysłana.',
      color: 'info',
      icon: 'i-lucide-eye',
    })
    return
  }
  sending.value = true
  sendError.value = ''
  const retryingAmbiguousSend = deliveryAmbiguous.value
  deliveryAmbiguous.value = false
  try {
    const currentContexts = contextScopes.value.map(context => ({ ...context }))
    const fingerprints = await composerFingerprints(currentContexts)
    const recoveringUnchangedSend = Boolean(
      retryingAmbiguousSend
      && lastAttemptContexts.value
      && fingerprints.content === lastAttemptContentFingerprint.value,
    )
    const sendContexts = recoveringUnchangedSend && lastAttemptContexts.value
      ? lastAttemptContexts.value
      : currentContexts
    const fingerprint = recoveringUnchangedSend
      ? lastAttemptFingerprint.value
      : fingerprints.request
    if (
      !idempotencyKey.value
      || (!recoveringUnchangedSend && fingerprint !== lastAttemptFingerprint.value)
    ) {
      idempotencyKey.value = crypto.randomUUID()
      lastAttemptFingerprint.value = fingerprint
      lastAttemptContentFingerprint.value = fingerprints.content
      lastAttemptContexts.value = sendContexts
    }
    const body = new FormData()
    body.append('connectionId', props.connectionId)
    body.append('idempotencyKey', idempotencyKey.value)
    body.append('to', form.to.trim())
    body.append('cc', form.cc.trim())
    body.append('bcc', form.bcc.trim())
    body.append('subject', form.subject.trim())
    body.append('body', form.body)
    if (props.threadId) body.append('threadId', props.threadId)
    if (sendContexts.length) {
      body.append('contexts', JSON.stringify(sendContexts))
    }
    if (props.contextType && props.contextId) {
      body.append('contextType', props.contextType)
      body.append('contextId', props.contextId)
    }
    for (const attachment of attachments.value) {
      body.append('attachment', attachment, attachment.name)
    }
    const response = await $fetch<MailSendPayload>(props.endpoint, {
      method: 'POST',
      body,
    })
    sentSuccessfully.value = true
    emit('sent', response.data)
    openModel.value = false
  } catch (error) {
    sendError.value = apiErrorMessage(error)
    deliveryAmbiguous.value = isDeliveryAmbiguous(error)
  } finally {
    sending.value = false
  }
}

function isDeliveryAmbiguous(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const payload = error as {
    data?: { deliveryAmbiguous?: boolean; data?: { deliveryAmbiguous?: boolean } }
  }
  return Boolean(
    payload.data?.deliveryAmbiguous
    || payload.data?.data?.deliveryAmbiguous,
  )
}

async function composerFingerprints(contexts: readonly MailContextScope[]): Promise<{
  content: string
  request: string
}> {
  const seenRecipients = new Set<string>()
  const normalizeRecipients = (value: string): string[] => (
    splitMailRecipients(value)
      .map(recipient => recipient.trim().toLowerCase())
      .filter((recipient) => {
        if (!recipient || seenRecipients.has(recipient)) return false
        seenRecipients.add(recipient)
        return true
      })
  )
  const attachmentFingerprints = await Promise.all(
    attachments.value.map(async file => ({
      name: file.name,
      size: file.size,
      type: file.type.trim().toLowerCase(),
      sha256: bytesToHex(
        await crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
      ),
    })),
  )
  const content = {
    to: normalizeRecipients(form.to),
    cc: normalizeRecipients(form.cc),
    bcc: normalizeRecipients(form.bcc),
    subject: form.subject.trim(),
    body: form.body,
    connectionId: props.connectionId,
    threadId: props.threadId,
    attachments: attachmentFingerprints,
  }
  return {
    content: JSON.stringify(content),
    request: JSON.stringify({ ...content, contexts }),
  }
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function closeComposer(): void {
  if (sending.value) return
  if (hasChanges.value) {
    discardConfirmationOpen.value = true
    return
  }
  openModel.value = false
}

function discardMessage(): void {
  discardConfirmationOpen.value = false
  sendConfirmationOpen.value = false
  emit('update:open', false)
}

function preventAccidentalUnload(event: BeforeUnloadEvent): void {
  if (!props.open || sentSuccessfully.value || !hasChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', preventAccidentalUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', preventAccidentalUnload))

async function focusFirstError(event: FormErrorEvent): Promise<void> {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  const errorId = event.errors.find(error => error.id)?.id
  const input = (
    errorId
      ? document.getElementById(errorId)
      : document.querySelector<HTMLElement>(
          '#mail-composer-form [aria-invalid="true"]',
        )
  )
  input?.focus()
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}
</script>

<template>
  <USlideover
    v-model:open="openModel"
    :title="title"
    :description="`Wiadomość zostanie wysłana z konta ${accountEmail}.`"
    :dismissible="!sending"
    :close="false"
    :ui="{ content: 'max-w-full sm:max-w-2xl' }"
  >
    <template #body>
      <div class="mail-composer">
        <UAlert
          v-if="sendError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="sendErrorTitle"
          :description="sendError"
        >
          <template v-if="deliveryAmbiguous && externalSentUrl" #actions>
            <UButton
              :href="externalSentUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="error"
              variant="soft"
              size="sm"
              icon="i-lucide-external-link"
            >
              Sprawdź folder Wysłane
            </UButton>
          </template>
        </UAlert>

        <UForm
          id="mail-composer-form"
          :state="form"
          :validate="validateComposer"
          :validate-on="['blur', 'change']"
          :loading-auto="false"
          class="mail-composer__form"
          @submit="requestSend"
          @error="focusFirstError"
        >
          <section class="mail-composer__recipients" aria-labelledby="mail-composer-recipients-title">
            <span id="mail-composer-recipients-title" class="sr-only">Odbiorcy</span>
            <header class="mail-composer__recipients-header">
              <div class="mail-composer__account">
                <img
                  v-if="providerIcon.startsWith('/')"
                  :src="providerIcon"
                  alt=""
                >
                <UIcon
                  v-else
                  :name="providerIcon"
                  class="mail-composer__account-icon"
                />
                <span>
                  <small>Nadawca</small>
                  <strong>{{ accountEmail }}</strong>
                  <em>· {{ providerLabel }}</em>
                </span>
              </div>
              <small v-if="uniqueRecipientCount" class="mail-composer__recipient-count">
                {{ recipientCountLabel }}
              </small>
            </header>

            <UFormField
              name="to"
              label="Do"
              orientation="horizontal"
              required
              :ui="{
                root: 'grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-2',
                wrapper: 'pt-2',
                labelWrapper: 'justify-start',
                label: 'text-xs font-semibold text-muted',
                container: 'min-w-0',
                error: 'mt-1.5',
              }"
            >
              <div class="mail-composer__to-row">
                <MailRecipientInput
                  v-model="form.to"
                  v-model:selections="toSelections"
                  :disabled="sending"
                  :connection-id="preview ? '' : connectionId"
                  :provider-label="providerLabel"
                  :provider-suggestions="providerSuggestions"
                  :placeholder="toSelections.length ? 'Dodaj' : 'Wpisz nazwę klienta lub adres e-mail'"
                />
                <span class="mail-composer__recipient-actions">
                  <UButton
                    v-if="!showCc"
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-controls="mail-composer-cc"
                    :aria-expanded="showCc"
                    @click="showCc = true"
                  >
                    DW
                  </UButton>
                  <UButton
                    v-if="!showBcc"
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-controls="mail-composer-bcc"
                    :aria-expanded="showBcc"
                    @click="showBcc = true"
                  >
                    UDW
                  </UButton>
                </span>
              </div>
            </UFormField>

            <UFormField
              v-if="showCc"
              id="mail-composer-cc"
              name="cc"
              label="DW"
              orientation="horizontal"
              :ui="{
                root: 'grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-2',
                wrapper: 'pt-2',
                labelWrapper: 'justify-start',
                label: 'text-xs font-semibold text-muted',
                container: 'min-w-0',
                error: 'mt-1.5',
              }"
            >
              <MailRecipientInput
                v-model="form.cc"
                v-model:selections="ccSelections"
                :disabled="sending"
                :connection-id="preview ? '' : connectionId"
                :provider-label="providerLabel"
                :provider-suggestions="providerSuggestions"
                placeholder="Dodaj odbiorców kopii"
              />
            </UFormField>

            <UFormField
              v-if="showBcc"
              id="mail-composer-bcc"
              name="bcc"
              label="UDW"
              help="Ukryci przed pozostałymi odbiorcami."
              orientation="horizontal"
              :ui="{
                root: 'grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-2',
                wrapper: 'pt-2',
                labelWrapper: 'justify-start',
                label: 'text-xs font-semibold text-muted',
                container: 'min-w-0',
                error: 'mt-1.5',
                help: 'mt-1.5 text-[10px] text-muted',
              }"
            >
              <MailRecipientInput
                v-model="form.bcc"
                v-model:selections="bccSelections"
                :disabled="sending"
                :connection-id="preview ? '' : connectionId"
                :provider-label="providerLabel"
                :provider-suggestions="providerSuggestions"
                placeholder="Dodaj ukrytych odbiorców"
              />
            </UFormField>
          </section>

          <section
            v-if="hasCrmContext"
            class="mail-composer__crm-context"
            aria-labelledby="mail-composer-context-title"
          >
            <div class="mail-composer__crm-context-main">
              <span class="mail-composer__crm-context-title">
                <UIcon name="i-lucide-link-2" aria-hidden="true" />
                <strong id="mail-composer-context-title">CRM</strong>
              </span>
              <div class="mail-composer__crm-context-links">
                <div class="mail-composer__crm-context-values">
                  <span
                    v-for="client in crmContextClients"
                    :key="client.id"
                    class="mail-composer__context-chip mail-composer__context-chip--client"
                  >
                    <UIcon name="i-lucide-contact-round" aria-hidden="true" />
                    <span>{{ client.label }}</span>
                    <small>CRM</small>
                  </span>
                  <span v-if="!crmContextClients.length" class="mail-composer__context-empty">
                    Klient z pola „Do”
                  </span>
                </div>
                <UIcon
                  name="i-lucide-arrow-right"
                  class="mail-composer__crm-context-connector"
                  aria-hidden="true"
                />
                <div class="mail-composer__crm-context-case">
                  <span
                    v-if="fixedContextCase"
                    class="mail-composer__context-chip mail-composer__context-chip--case"
                  >
                    <UIcon name="i-lucide-briefcase-business" aria-hidden="true" />
                    <span>{{ fixedContextCase.label }}</span>
                  </span>
                  <span
                    v-else-if="selectedContextCase && availableContextCases.length === 1"
                    class="mail-composer__context-chip mail-composer__context-chip--case"
                  >
                    <UIcon name="i-lucide-briefcase-business" aria-hidden="true" />
                    <span>{{ selectedContextCase.label }}</span>
                  </span>
                  <UFormField
                    v-else-if="availableContextCases.length"
                    name="contextCaseId"
                    :ui="{ error: 'mt-1.5' }"
                  >
                    <USelect
                      v-model="form.contextCaseId"
                      class="w-full"
                      size="sm"
                      :items="contextCaseItems"
                      value-key="value"
                      placeholder="Wybierz sprawę"
                      icon="i-lucide-briefcase-business"
                      :disabled="sending || contextCasesLoading"
                      aria-label="Wybierz sprawę dla wysyłanej wiadomości"
                    />
                  </UFormField>
                  <span v-else class="mail-composer__context-empty">
                    {{ contextCasesLoading ? 'Pobieram powiązane sprawy…' : 'Brak powiązanej sprawy' }}
                  </span>
                </div>
              </div>
              <span
                v-if="contextCasesLoading"
                class="mail-composer__crm-context-loading mail-composer__crm-context-status"
              >
                <UIcon name="i-lucide-loader-circle" class="animate-spin" aria-hidden="true" />
                Szukam
              </span>
              <UBadge
                v-else
                class="mail-composer__crm-context-status"
                color="success"
                variant="subtle"
                size="xs"
              >
                Auto
              </UBadge>
            </div>

            <UAlert
              v-if="caseClientMismatch"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Klient spoza bieżącej sprawy"
              description="Usuń tego odbiorcę albo otwórz composer z właściwej sprawy."
            />
            <UAlert
              v-else-if="contextCasesError"
              color="warning"
              variant="subtle"
              icon="i-lucide-wifi-off"
              title="Nie udało się pobrać spraw"
              :description="contextCasesError"
            >
              <template #actions>
                <UButton
                  color="warning"
                  variant="soft"
                  size="xs"
                  :loading="contextCasesLoading"
                  @click="loadContextCases(crmContextClientIds)"
                >
                  Spróbuj ponownie
                </UButton>
              </template>
            </UAlert>
            <p
              v-if="contextSummary && !hasCompleteCrmContext"
              class="mail-composer__crm-context-summary"
            >
              <UIcon
                :name="hasCompleteCrmContext ? 'i-lucide-circle-check' : 'i-lucide-info'"
                aria-hidden="true"
              />
              {{ contextSummary }}
            </p>
            <p v-else-if="contextSummary" class="sr-only">
              {{ contextSummary }}
            </p>
          </section>

          <UFormField
            name="subject"
            :label="isReply ? 'Temat wątku' : 'Temat'"
            :description="isReply ? 'Temat jest zachowany, aby dostawca dołączył odpowiedź do wątku.' : undefined"
            required
          >
            <UInput
              v-model="form.subject"
              class="w-full"
              :maxlength="500"
              :disabled="sending || isReply"
              placeholder="Temat wiadomości"
            />
          </UFormField>

          <UFormField
            name="body"
            label="Wiadomość"
            :hint="`${form.body.length.toLocaleString('pl-PL')} / 200 000`"
          >
            <UTextarea
              v-model="form.body"
              class="w-full"
              autoresize
              :rows="10"
              :maxrows="18"
              :maxlength="200000"
              :disabled="sending"
              placeholder="Napisz wiadomość…"
              lang="pl"
              :spellcheck="true"
            />
          </UFormField>

          <UFormField
            name="attachments"
            label="Załączniki"
            hint="Opcjonalnie"
            :description="attachmentDescription"
          >
            <UFileUpload
              v-model="attachments"
              multiple
              reset
              layout="list"
              position="outside"
              icon="i-lucide-paperclip"
              label="Wybierz lub przeciągnij pliki"
              :description="`Pliki zostaną przekazane bezpośrednio do ${providerLabel}.`"
              :file-image="false"
              :disabled="sending"
              :ui="{ base: 'min-h-28', files: 'mt-3' }"
            />
          </UFormField>

          <UAlert
            v-if="attachmentError"
            color="warning"
            variant="subtle"
            icon="i-lucide-file-warning"
            title="Sprawdź załączniki"
            :description="attachmentError"
          />

          <p v-if="attachments.length" class="mail-composer__attachment-total">
            {{ attachments.length }} {{ attachments.length === 1 ? 'załącznik' : 'załączników' }}
            · {{ formatBytes(attachmentBytes) }}
          </p>
          <p class="sr-only" aria-live="polite">
            {{ sending ? 'Wysyłanie wiadomości' : '' }}
          </p>
        </UForm>
      </div>
    </template>

    <template #footer>
      <div class="mail-composer__footer">
        <p>
          {{ preview
            ? 'Tryb podglądu — wiadomość nie zostanie wysłana.'
            : 'CRM nie zapisuje treści ani załączników wysłanej wiadomości.' }}
        </p>
        <div>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="sending"
            @click="closeComposer"
          >
            Anuluj
          </UButton>
          <UButton
            type="submit"
            form="mail-composer-form"
            icon="i-lucide-send"
            :loading="sending"
            :disabled="Boolean(attachmentError) || (!deliveryAmbiguous && (contextCasesLoading || caseClientMismatch))"
          >
            {{ sendActionLabel }}
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>

  <UModal
    v-model:open="sendConfirmationOpen"
    title="Sprawdź odbiorców i załączniki"
    description="Po wysłaniu nie można cofnąć wiadomości w CRM."
    :dismissible="!sending"
    :ui="{ footer: 'flex-col items-stretch sm:flex-row sm:items-center sm:justify-end' }"
  >
    <template #body>
      <div class="mail-composer__send-summary">
        <p>
          <strong>{{ uniqueRecipientCount }}</strong>
          {{ uniqueRecipientCount === 1 ? 'odbiorca' : 'odbiorców' }}
        </p>
        <p>
          <strong>{{ attachments.length }}</strong>
          {{ attachments.length === 1 ? 'załącznik' : 'załączników' }}
          <template v-if="attachments.length"> · {{ formatBytes(attachmentBytes) }}</template>
        </p>
        <div v-if="contextScopes.length" class="mail-composer__send-context-summary">
          <span>
            <UIcon name="i-lucide-link-2" aria-hidden="true" />
            Powiązanie po wysłaniu
          </span>
          <strong>
            {{ crmContextClients.map(client => client.label).join(', ') }}
            <template v-if="selectedContextCase">
              · {{ selectedContextCase.label }}
            </template>
          </strong>
        </div>
        <UAlert
          v-if="form.bcc.trim()"
          color="info"
          variant="subtle"
          icon="i-lucide-eye-off"
          title="Wiadomość zawiera odbiorców UDW"
          description="Sprawdź, czy ukryta kopia jest zamierzona."
        />
      </div>
    </template>
    <template #footer="{ close }">
      <UButton color="neutral" variant="outline" :disabled="sending" @click="close">
        Wróć do edycji
      </UButton>
      <UButton icon="i-lucide-send" :loading="sending" @click="sendMessage">
        Potwierdź i wyślij
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="discardConfirmationOpen"
    title="Odrzucić wiadomość?"
    description="Treść formularza i wybrane załączniki zostaną usunięte."
    :ui="{ footer: 'flex-col items-stretch sm:flex-row sm:items-center sm:justify-end' }"
  >
    <template #footer="{ close }">
      <UButton color="neutral" variant="outline" @click="close">
        Wróć do wiadomości
      </UButton>
      <UButton color="error" icon="i-lucide-trash-2" @click="discardMessage">
        Odrzuć
      </UButton>
    </template>
  </UModal>
</template>

<style scoped>
.mail-composer {
  display: grid;
  gap: 12px;
}

.mail-composer__account {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.mail-composer__account img {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.mail-composer__account-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--ui-primary);
}

.mail-composer__account span {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
}

.mail-composer__account small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.mail-composer__account strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-composer__account em {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 9px;
  font-style: normal;
}

.mail-composer__form {
  display: grid;
  gap: 13px;
}

.mail-composer__recipients {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.mail-composer__recipients-header {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 9px;
  border-bottom: 1px solid var(--ui-border);
}

.mail-composer__recipient-count {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.mail-composer__to-row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
}

.mail-composer__recipient-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0;
}

.mail-composer__recipient-actions :deep(button) {
  min-height: 32px;
  padding-inline: 7px;
}

.mail-composer__recipients :deep([data-slot='root'][data-orientation='horizontal']) {
  display: grid;
  justify-items: stretch !important;
  padding: 6px 9px;
  background: var(--ui-bg);
}

.mail-composer__recipients :deep([data-slot='root'][data-orientation='horizontal'] + [data-slot='root'][data-orientation='horizontal']) {
  border-top: 1px solid var(--ui-border);
}

.mail-composer__crm-context {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-success) 24%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-success) 3%, var(--ui-bg));
}

.mail-composer__crm-context-main {
  display: grid;
  min-height: 44px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
}

.mail-composer__crm-context-title,
.mail-composer__crm-context-loading,
.mail-composer__crm-context-summary,
.mail-composer__send-context-summary > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.mail-composer__crm-context-title :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--ui-success);
}

.mail-composer__crm-context-title strong {
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.mail-composer__crm-context-loading {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.mail-composer__crm-context-loading :deep(svg) {
  width: 13px;
  height: 13px;
}

.mail-composer__crm-context-status {
  justify-self: end;
}

.mail-composer__crm-context-links {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(72px, 0.75fr) auto minmax(112px, 1.25fr);
  align-items: center;
  gap: 4px;
}

.mail-composer__crm-context-connector {
  width: 11px;
  height: 11px;
  color: var(--ui-text-muted);
}

.mail-composer__crm-context-values {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;
}

.mail-composer__crm-context-case {
  min-width: 0;
}

.mail-composer__context-chip {
  display: inline-flex;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-weight: 650;
}

.mail-composer__context-chip > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-composer__context-chip > :deep(svg) {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.mail-composer__context-chip--client {
  border-color: color-mix(in srgb, var(--ui-success) 30%, var(--ui-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-success) 9%, var(--ui-bg));
}

.mail-composer__context-chip--client > :deep(svg),
.mail-composer__crm-context-summary > :deep(svg) {
  color: var(--ui-success);
}

.mail-composer__context-chip--client small {
  flex: 0 0 auto;
  color: var(--ui-success);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.mail-composer__context-chip--case > :deep(svg) {
  color: var(--ui-text-muted);
}

.mail-composer__context-chip--case {
  width: 100%;
}

.mail-composer__context-empty {
  display: flex;
  min-height: 30px;
  align-items: center;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.mail-composer__crm-context :deep([data-slot='alert']) {
  margin: 0 9px 9px;
}

.mail-composer__crm-context-summary {
  margin: 0;
  padding: 7px 9px;
  border-top: 1px solid color-mix(in srgb, var(--ui-success) 16%, var(--ui-border));
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.mail-composer__crm-context-summary > :deep(svg) {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.mail-composer__attachment-total {
  margin: -8px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.mail-composer__footer {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: env(safe-area-inset-bottom);
}

.mail-composer__footer p {
  max-width: 320px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.mail-composer__footer > div {
  display: flex;
  gap: 8px;
}

.mail-composer__send-summary {
  display: grid;
  gap: 12px;
}

.mail-composer__send-summary > p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.mail-composer__send-summary strong {
  color: var(--ui-text-highlighted);
}

.mail-composer__send-context-summary {
  display: grid;
  gap: 5px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--ui-success) 24%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
  font-size: 12px;
}

.mail-composer__send-context-summary > span {
  color: var(--ui-success);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

@media (max-width: 640px) {
  .mail-composer__recipients :deep([data-slot='root'][data-orientation='horizontal']) {
    grid-template-columns: 32px minmax(0, 1fr);
    padding: 8px;
  }

  .mail-composer__account small {
    display: none;
  }

  .mail-composer__crm-context-case :deep([role='combobox']) {
    min-height: 44px;
  }

  .mail-composer__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .mail-composer__footer > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .mail-composer__recipient-actions :deep(button),
  .mail-composer__footer :deep(button) {
    min-height: 44px;
  }
}

@media (max-width: 359px) {
  .mail-composer__to-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .mail-composer__recipient-actions {
    justify-content: flex-end;
  }

  .mail-composer__crm-context-main {
    grid-template-columns: auto 1fr auto;
  }

  .mail-composer__crm-context-links {
    grid-column: 1 / -1;
    grid-row: 2;
    grid-template-columns: minmax(0, 1fr);
  }

  .mail-composer__crm-context-connector {
    display: none;
  }
}
</style>
