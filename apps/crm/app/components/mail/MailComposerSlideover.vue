<script setup lang="ts">
import type { FormError, FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import type { MailProviderId, MailSendPayload } from '#shared/types/mail'
import { gmailBlockedAttachmentExtension } from '#shared/utils/mail-security'
import { apiErrorMessage } from '~/utils/api-error'
import {
  isValidMailRecipient,
  splitMailRecipients,
} from '~/utils/mail-recipients'

interface ComposerForm {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
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
}>(), {
  initialTo: '',
  initialCc: '',
  initialSubject: '',
  initialBody: '',
  threadId: '',
  externalSentUrl: null,
  maxAttachmentBytes: 3 * 1024 * 1024,
  maxTotalAttachmentBytes: 3 * 1024 * 1024,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  sent: [value: MailSendPayload['data']]
}>()

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
})
const attachments = ref<File[]>([])
const showCc = ref(Boolean(props.initialCc))
const showBcc = ref(false)
const sending = ref(false)
const sendError = ref('')
const deliveryAmbiguous = ref(false)
const idempotencyKey = ref('')
const lastAttemptFingerprint = ref('')
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
  form.to !== props.initialTo
  || form.cc !== props.initialCc
  || form.bcc !== ''
  || form.subject !== props.initialSubject
  || Boolean(form.body)
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
  if (sending.value || attachmentError.value) return
  if (requiresSendConfirmation.value) {
    sendConfirmationOpen.value = true
    return
  }
  await sendMessage()
}

async function sendMessage(): Promise<void> {
  if (sending.value || attachmentError.value) return
  sendConfirmationOpen.value = false
  sending.value = true
  sendError.value = ''
  deliveryAmbiguous.value = false
  try {
    const fingerprint = await composerFingerprint()
    if (!idempotencyKey.value || fingerprint !== lastAttemptFingerprint.value) {
      idempotencyKey.value = crypto.randomUUID()
      lastAttemptFingerprint.value = fingerprint
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

async function composerFingerprint(): Promise<string> {
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
  const context = props.contextType && props.contextId
    ? { type: props.contextType, id: props.contextId }
    : null
  return JSON.stringify({
    to: normalizeRecipients(form.to),
    cc: normalizeRecipients(form.cc),
    bcc: normalizeRecipients(form.bcc),
    subject: form.subject.trim(),
    body: form.body,
    connectionId: props.connectionId,
    threadId: props.threadId,
    context,
    attachments: attachmentFingerprints,
  })
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
            <small>Nadawca · {{ providerLabel }}</small>
            <strong>{{ accountEmail }}</strong>
          </span>
        </div>

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
            <header class="mail-composer__recipients-header">
              <span>
                <strong id="mail-composer-recipients-title">Odbiorcy</strong>
                <small v-if="uniqueRecipientCount">{{ recipientCountLabel }}</small>
              </span>
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
            </header>

            <UFormField
              name="to"
              label="Do"
              orientation="horizontal"
              required
              :ui="{
                root: 'grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-2',
                wrapper: 'pt-2.5',
                labelWrapper: 'justify-start',
                label: 'text-xs font-semibold text-muted',
                container: 'min-w-0',
                error: 'mt-1.5',
              }"
            >
              <MailRecipientInput
                v-model="form.to"
                :disabled="sending"
                placeholder="Wpisz nazwę klienta lub adres e-mail"
              />
            </UFormField>

            <UFormField
              v-if="showCc"
              id="mail-composer-cc"
              name="cc"
              label="DW"
              orientation="horizontal"
              :ui="{
                root: 'grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-2',
                wrapper: 'pt-2.5',
                labelWrapper: 'justify-start',
                label: 'text-xs font-semibold text-muted',
                container: 'min-w-0',
                error: 'mt-1.5',
              }"
            >
              <MailRecipientInput
                v-model="form.cc"
                :disabled="sending"
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
                root: 'grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-2',
                wrapper: 'pt-2.5',
                labelWrapper: 'justify-start',
                label: 'text-xs font-semibold text-muted',
                container: 'min-w-0',
                error: 'mt-1.5',
                help: 'mt-1.5 text-[10px] text-muted',
              }"
            >
              <MailRecipientInput
                v-model="form.bcc"
                :disabled="sending"
                placeholder="Dodaj ukrytych odbiorców"
              />
            </UFormField>
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
        <p>CRM nie zapisuje treści ani załączników wysłanej wiadomości.</p>
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
            :disabled="Boolean(attachmentError)"
          >
            Wyślij
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
    :ui="{ footer: 'justify-end' }"
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
    :ui="{ footer: 'justify-end' }"
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
  gap: 18px;
}

.mail-composer__account {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.mail-composer__account img {
  width: 24px;
  height: 24px;
}

.mail-composer__account-icon {
  width: 24px;
  height: 24px;
  color: var(--ui-primary);
}

.mail-composer__account span {
  display: grid;
  min-width: 0;
}

.mail-composer__account small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.mail-composer__account strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-composer__form {
  display: grid;
  gap: 17px;
}

.mail-composer__recipients {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.mail-composer__recipients-header {
  display: flex;
  min-height: 39px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--ui-border);
}

.mail-composer__recipients-header > span:first-child {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.mail-composer__recipients-header strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.mail-composer__recipients-header small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.mail-composer__recipient-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
}

.mail-composer__recipients :deep([data-slot='root'][data-orientation='horizontal']) {
  display: grid;
  padding: 9px 11px;
  background: var(--ui-bg);
}

.mail-composer__recipients :deep([data-slot='root'][data-orientation='horizontal'] + [data-slot='root'][data-orientation='horizontal']) {
  border-top: 1px solid var(--ui-border);
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

@media (max-width: 640px) {
  .mail-composer__recipients :deep([data-slot='root'][data-orientation='horizontal']) {
    grid-template-columns: 34px minmax(0, 1fr);
    padding: 8px;
  }

  .mail-composer__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .mail-composer__footer > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
