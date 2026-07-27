<script setup lang="ts">
import type { FormError, FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import type { MailSendPayload } from '#shared/types/mail'
import { apiErrorMessage } from '~/utils/api-error'

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
  accountEmail: string
  initialTo?: string
  initialCc?: string
  initialSubject?: string
  threadId?: string
}>(), {
  initialTo: '',
  initialCc: '',
  initialSubject: '',
  threadId: '',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  sent: [value: MailSendPayload['data']]
}>()

const discardConfirmationOpen = ref(false)
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
  body: '',
})
const attachments = ref<File[]>([])
const showCopies = ref(Boolean(props.initialCc))
const sending = ref(false)
const sendError = ref('')
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
  if (attachments.value.some(file => file.size > 10 * 1024 * 1024)) {
    return 'Pojedynczy załącznik nie może przekraczać 10 MB.'
  }
  if (attachmentBytes.value > 16 * 1024 * 1024) {
    return 'Łączny rozmiar załączników nie może przekraczać 16 MB.'
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
  const recipients = value
    .split(/[;,\n]+/u)
    .map(recipient => recipient.trim())
    .filter(Boolean)
  if (required && !recipients.length) {
    errors.push({ name, message: 'Podaj co najmniej jednego odbiorcę.' })
    return recipients
  }
  if (
    recipients.length > 50
    || recipients.some(recipient => (
      recipient.length > 254
      || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(recipient)
    ))
  ) {
    errors.push({
      name,
      message: 'Podaj poprawne adresy e-mail oddzielone przecinkami.',
    })
  }
  return recipients
}

async function sendMessage(_event: FormSubmitEvent<ComposerForm>): Promise<void> {
  if (sending.value || attachmentError.value) return
  sending.value = true
  sendError.value = ''
  try {
    const fingerprint = await composerFingerprint()
    if (!idempotencyKey.value || fingerprint !== lastAttemptFingerprint.value) {
      idempotencyKey.value = crypto.randomUUID()
      lastAttemptFingerprint.value = fingerprint
    }
    const body = new FormData()
    body.append('idempotencyKey', idempotencyKey.value)
    body.append('to', form.to.trim())
    body.append('cc', form.cc.trim())
    body.append('bcc', form.bcc.trim())
    body.append('subject', form.subject.trim())
    body.append('body', form.body)
    if (props.threadId) body.append('threadId', props.threadId)
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
  } finally {
    sending.value = false
  }
}

async function composerFingerprint(): Promise<string> {
  const seenRecipients = new Set<string>()
  const normalizeRecipients = (value: string): string[] => (
    value
      .split(/[;,\n]+/u)
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
  return JSON.stringify({
    to: normalizeRecipients(form.to),
    cc: normalizeRecipients(form.cc),
    bcc: normalizeRecipients(form.bcc),
    subject: form.subject.trim(),
    body: form.body,
    threadId: props.threadId,
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
  emit('update:open', false)
}

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
          <img src="/assets/google-icon.svg" alt="">
          <span>
            <small>Nadawca</small>
            <strong>{{ accountEmail }}</strong>
          </span>
        </div>

        <UAlert
          v-if="sendError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się potwierdzić wysyłki"
          :description="sendError"
        />

        <UForm
          id="mail-composer-form"
          :state="form"
          :validate="validateComposer"
          :validate-on="['blur', 'change']"
          :loading-auto="false"
          class="mail-composer__form"
          @submit="sendMessage"
          @error="focusFirstError"
        >
          <UFormField
            name="to"
            label="Do"
            description="Wiele adresów oddziel przecinkami."
            required
          >
            <UInput
              v-model="form.to"
              class="w-full"
              type="text"
              inputmode="email"
              autocomplete="email"
              placeholder="anna@firma.pl, jan@firma.pl"
              :disabled="sending"
            />
          </UFormField>

          <div class="mail-composer__copy-toggle">
            <UButton
              v-if="!showCopies"
              type="button"
              color="neutral"
              variant="link"
              size="sm"
              aria-controls="mail-composer-copies"
              :aria-expanded="showCopies"
              @click="showCopies = true"
            >
              Dodaj DW lub UDW
            </UButton>
          </div>

          <div v-if="showCopies" id="mail-composer-copies" class="mail-composer__copies">
            <UFormField name="cc" label="DW">
              <UInput
                v-model="form.cc"
                class="w-full"
                inputmode="email"
                placeholder="kopia@firma.pl"
                :disabled="sending"
              />
            </UFormField>
            <UFormField name="bcc" label="UDW">
              <UInput
                v-model="form.bcc"
                class="w-full"
                inputmode="email"
                placeholder="ukryta-kopia@firma.pl"
                :disabled="sending"
              />
            </UFormField>
          </div>

          <UFormField
            name="subject"
            :label="isReply ? 'Temat wątku' : 'Temat'"
            :description="isReply ? 'Temat jest zachowany, aby Gmail dołączył odpowiedź do wątku.' : undefined"
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
            />
          </UFormField>

          <UFormField
            name="attachments"
            label="Załączniki"
            hint="Opcjonalnie"
            description="Do 10 plików, maks. 10 MB każdy i 16 MB łącznie."
          >
            <UFileUpload
              v-model="attachments"
              multiple
              reset
              layout="list"
              position="outside"
              icon="i-lucide-paperclip"
              label="Wybierz lub przeciągnij pliki"
              description="Pliki zostaną przekazane bezpośrednio do Gmaila."
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

.mail-composer__copy-toggle {
  display: flex;
  justify-content: flex-end;
  margin-top: -14px;
}

.mail-composer__copies {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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

@media (max-width: 640px) {
  .mail-composer__copies {
    grid-template-columns: minmax(0, 1fr);
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
