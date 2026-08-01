<script setup lang="ts">
import type { PortalCase, PortalCaseAction, PortalTimelineItem } from '~/types/portal'
import { PORTAL_TIME_ZONE } from '~/utils/portal-date'

const props = withDefaults(defineProps<{
  caseData: PortalCase
  preview?: boolean
}>(), {
  preview: false,
})

const toast = useToast()
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadedFileName = ref('')
const contactOpen = ref(false)
const contactMessage = ref('')
const sendingMessage = ref(false)

const action = computed<PortalCaseAction>(() => {
  if (props.caseData.action) return props.caseData.action
  if (props.caseData.grant.multiformEnabled) {
    return {
      kind: 'complete_multiform',
      title: 'Formularz Multiwniosku jest gotowy do uzupełnienia',
      description: 'Odpowiedz na krótkie pytania. Na ich podstawie ekspert przygotuje formularze bankowe i listę dokumentów.',
      label: 'Uzupełnij formularz',
      to: `/cases/${encodeURIComponent(props.caseData.id)}/multiform`,
    }
  }
  return {
    kind: 'wait',
    title: 'Twój ekspert przygotowuje kolejny etap',
    description: 'Dam znać w tym miejscu, gdy pojawi się nowe zadanie lub dokument do uzupełnienia.',
  }
})

const updates = computed<PortalTimelineItem[]>(() => props.caseData.timeline || [])

function initials(name: string) {
  const parts = name.trim().split(/\s+/u)
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase()
}

function dateTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const datePart = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: PORTAL_TIME_ZONE,
  }).format(date)
  const timePart = new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit', minute: '2-digit', timeZone: PORTAL_TIME_ZONE,
  }).format(date)
  return `${datePart}, ${timePart}`
}

function deadlineLabel(value?: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric', month: 'long',
    timeZone: PORTAL_TIME_ZONE,
  }).format(new Date(value))
}

function timelineIcon(kind: PortalTimelineItem['kind']) {
  if (kind === 'document') return 'i-lucide-file-check-2'
  if (kind === 'multiform') return 'i-lucide-clipboard-check'
  if (kind === 'status') return 'i-lucide-badge-check'
  return 'i-lucide-message-circle-more'
}

function actionIcon() {
  if (action.value.kind === 'complete_multiform') return 'i-lucide-clipboard-list'
  if (action.value.kind === 'wait') return 'i-lucide-clock-3'
  return 'i-lucide-file-text'
}

async function uploadDocument(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 20 * 1024 * 1024) {
    toast.add({
      title: 'Plik jest zbyt duży',
      description: 'Maksymalny rozmiar pliku to 20 MB.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return
  }

  uploading.value = true
  try {
    if (!props.preview) {
      const body = new FormData()
      body.append('file', file)
      await $fetch(`/api/client/cases/${encodeURIComponent(props.caseData.id)}/documents`, {
        method: 'POST',
        body,
      })
    }
    uploadedFileName.value = file.name
    toast.add({
      title: 'Dokument został bezpiecznie przesłany',
      description: file.name,
      color: 'success',
      icon: 'i-lucide-file-check-2',
    })
  }
  catch {
    toast.add({
      title: 'Nie udało się przesłać dokumentu',
      description: 'Spróbuj ponownie lub napisz do swojego eksperta.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    uploading.value = false
    if (uploadInput.value) uploadInput.value.value = ''
  }
}

async function sendMessage() {
  const message = contactMessage.value.trim()
  if (!message) return
  sendingMessage.value = true
  try {
    if (!props.preview) {
      await $fetch(`/api/client/cases/${encodeURIComponent(props.caseData.id)}/messages`, {
        method: 'POST',
        body: { message },
      })
    }
    contactOpen.value = false
    contactMessage.value = ''
    toast.add({
      title: `Wiadomość została wysłana do ${props.caseData.expert.name.split(' ')[0]}`,
      icon: 'i-lucide-send',
      color: 'success',
    })
  }
  catch {
    toast.add({
      title: 'Nie udało się wysłać wiadomości',
      description: 'Spróbuj ponownie za chwilę.',
      icon: 'i-lucide-circle-alert',
      color: 'error',
    })
  }
  finally {
    sendingMessage.value = false
  }
}
</script>

<template>
  <div class="case-timeline">
    <article class="action-update">
      <div class="action-update__icon" aria-hidden="true">
        <UIcon :name="actionIcon()" />
      </div>

      <div class="action-update__content">
        <header class="action-update__header">
          <div class="action-update__meta">
            <span class="action-update__new"><i /> NOWE</span>
            <span class="action-update__author">
              <span>{{ initials(caseData.expert.name) }}</span>
              <strong>{{ caseData.expert.name }}</strong>
              <i>·</i>
              Twój ekspert
            </span>
          </div>
          <time :datetime="caseData.updatedAt">{{ dateTimeLabel(caseData.updatedAt) }}</time>
        </header>

        <h2>{{ action.title }}</h2>
        <p v-if="action.description" class="action-update__description">
          {{ action.description }}
        </p>

        <div v-if="action.deadlineAt" class="action-update__deadline">
          <UIcon name="i-lucide-calendar-days" />
          <strong>Do {{ deadlineLabel(action.deadlineAt) }}</strong>
          <span>–</span>
          prosimy o wykonanie zadania w tym terminie.
        </div>

        <div class="action-update__footer">
          <div class="action-update__security">
            <UIcon name="i-lucide-lock-keyhole" />
            <p>
              Twoje dane i dokumenty są bezpieczne i widoczne tylko dla Ciebie,
              {{ caseData.expert.name.split(' ')[0] }} oraz uprawnionych instytucji finansowych.
            </p>
          </div>

          <div v-if="action.kind === 'upload_document'" class="action-update__cta">
            <input
              ref="uploadInput"
              class="portal-sr-only"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              @change="uploadDocument"
            >
            <UButton
              variant="solid"
              icon="i-lucide-upload"
              :loading="uploading"
              @click="uploadInput?.click()"
            >
              {{ uploadedFileName ? 'Dodaj kolejny' : action.label || 'Dodaj dokument' }}
            </UButton>
            <small>{{ uploadedFileName || 'PDF, JPG do 20 MB' }}</small>
          </div>

          <div v-else-if="action.kind === 'complete_multiform'" class="action-update__cta">
            <UButton
              variant="solid"
              icon="i-lucide-arrow-right"
              trailing
              :to="preview
                ? '/preview/multiform'
                : action.to || `/cases/${encodeURIComponent(caseData.id)}/multiform`"
            >
              {{ action.label || 'Uzupełnij formularz' }}
            </UButton>
            <small>Zapisujemy postęp automatycznie</small>
          </div>
        </div>
      </div>
    </article>

    <div class="timeline-list" aria-label="Historia sprawy">
      <article
        v-for="(item, index) in updates"
        :key="item.id"
        class="timeline-item"
      >
        <div class="timeline-item__marker" aria-hidden="true">
          <UIcon :name="timelineIcon(item.kind)" />
        </div>
        <div class="timeline-item__content">
          <header>
            <p>
              <strong>
                {{ item.author?.role === 'client'
                  ? 'Ty'
                  : item.author?.name || caseData.expert.name }}
              </strong>
              <template v-if="item.author?.role !== 'client'">
                <span>·</span>
                Twój ekspert
              </template>
            </p>
            <time :datetime="item.createdAt">{{ dateTimeLabel(item.createdAt) }}</time>
          </header>
          <h3>{{ item.title }}</h3>
          <p v-if="item.body" class="timeline-item__body">{{ item.body }}</p>
          <NuxtLink
            v-if="item.action"
            :to="item.action.to || `/cases/${encodeURIComponent(caseData.id)}/multiform`"
            class="timeline-item__action"
          >
            {{ item.action.label }}
            <UIcon name="i-lucide-arrow-right" />
          </NuxtLink>
          <span v-if="index < updates.length - 1" class="timeline-item__line" />
        </div>
      </article>
    </div>

    <section id="kontakt" class="case-contact">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-message-circle"
        class="case-contact__button"
        @click="contactOpen = true"
      >
        Napisz do {{ caseData.expert.name.split(' ')[0] }}
      </UButton>
      <p>
        Masz pytanie lub chcesz coś doprecyzować?<br>
        Jesteśmy tu, aby Ci pomóc.
      </p>
    </section>

    <UModal
      v-model:open="contactOpen"
      :title="`Napisz do ${caseData.expert.name}`"
      description="Wiadomość zostanie przypisana do tej sprawy."
    >
      <template #body>
        <form id="expert-message-form" class="contact-form" @submit.prevent="sendMessage">
          <UFormField label="Wiadomość" required>
            <UTextarea
              v-model="contactMessage"
              :rows="5"
              autoresize
              :maxrows="8"
              placeholder="Napisz, w czym możemy pomóc…"
              class="w-full"
            />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="contact-form__actions">
          <UButton color="neutral" variant="ghost" @click="contactOpen = false">
            Anuluj
          </UButton>
          <UButton
            type="submit"
            form="expert-message-form"
            variant="solid"
            icon="i-lucide-send"
            :loading="sendingMessage"
            :disabled="!contactMessage.trim()"
          >
            Wyślij wiadomość
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.case-timeline {
  display: grid;
  gap: 0;
}

.action-update {
  display: grid;
  grid-template-columns: 76px 1fr;
  min-height: 374px;
  padding: 31px 31px 22px 27px;
  border: 1px solid var(--portal-warm-border);
  border-radius: 15px;
  background: var(--portal-warm-surface);
}

.action-update__icon,
.timeline-item__marker {
  display: grid;
  place-items: center;
  border: 1px solid var(--portal-line);
  border-radius: 999px;
  background: #fff;
  color: #0a0a0a;
}

.action-update__icon {
  width: 78px;
  height: 78px;
  transform: translateX(-1px);
}

.action-update__icon svg {
  width: 32px;
  height: 32px;
  stroke-width: 1.65;
}

.action-update__content {
  min-width: 0;
  padding-left: 29px;
}

.action-update__header,
.timeline-item header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.action-update__meta,
.action-update__author {
  display: flex;
  align-items: center;
}

.action-update__meta {
  gap: 28px;
}

.action-update__new {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.13em;
}

.action-update__new i {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #000;
}

.action-update__author {
  gap: 10px;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.action-update__author > span {
  display: grid;
  width: 35px;
  height: 35px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 600;
}

.action-update__author strong {
  color: var(--ui-text-highlighted);
  font-weight: 500;
}

.action-update__author i {
  font-style: normal;
}

.action-update time,
.timeline-item time {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.action-update h2 {
  margin: 17px 0 12px;
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1.32;
}

.action-update__description {
  max-width: 705px;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 16px;
  line-height: 1.55;
}

.action-update__deadline {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 24px;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.action-update__deadline svg {
  width: 19px;
  height: 19px;
  margin-right: 3px;
  color: #000;
}

.action-update__deadline strong {
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.action-update__footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 22px;
  margin-top: 26px;
  padding-top: 17px;
  border-top: 1px solid var(--portal-line);
}

.action-update__security {
  display: grid;
  grid-template-columns: 23px 1fr;
  gap: 12px;
  align-items: start;
}

.action-update__security svg {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  color: #000;
}

.action-update__security p {
  max-width: 505px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.action-update__cta {
  display: grid;
  justify-items: center;
  gap: 7px;
}

.action-update__cta :deep(button),
.action-update__cta :deep(a) {
  min-width: 188px;
  min-height: 54px;
  border-radius: 12px;
  background: #000;
  color: #fff;
  font-size: 15px;
}

.action-update__cta small {
  max-width: 220px;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-align: center;
  word-break: break-word;
}

.timeline-list {
  padding: 37px 6px 0 20px;
}

.timeline-item {
  position: relative;
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  min-height: 164px;
}

.timeline-item__marker {
  position: relative;
  z-index: 2;
  width: 69px;
  height: 69px;
}

.timeline-item__marker svg {
  width: 29px;
  height: 29px;
  stroke-width: 1.7;
}

.timeline-item__content {
  position: relative;
  min-width: 0;
  padding: 4px 0 30px 26px;
}

.timeline-item header p {
  display: flex;
  gap: 9px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.timeline-item header strong {
  color: var(--ui-text-highlighted);
  font-weight: 500;
}

.timeline-item h3 {
  margin: 14px 0 7px;
  font-size: 19px;
  font-weight: 650;
  line-height: 1.3;
}

.timeline-item__body {
  max-width: 695px;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 14px;
  line-height: 1.55;
}

.timeline-item__line {
  position: absolute;
  right: 0;
  bottom: 12px;
  left: 26px;
  height: 1px;
  background: var(--portal-line);
}

.timeline-item__action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.case-contact {
  display: grid;
  grid-template-columns: 220px 1fr;
  align-items: center;
  gap: 25px;
  min-height: 70px;
  margin-top: 6px;
  padding: 0 24px;
  border: 1px solid var(--portal-line);
  border-radius: 12px;
}

.case-contact__button {
  justify-content: flex-start;
  padding-left: 5px;
  border: 0;
  box-shadow: none;
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.case-contact__button :deep(svg) {
  width: 25px;
  height: 25px;
  margin-right: 5px;
}

.case-contact p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.contact-form {
  padding: 2px;
}

.contact-form__actions {
  display: flex;
  width: 100%;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 1180px) {
  .action-update__meta {
    gap: 15px;
  }

  .action-update__footer {
    grid-template-columns: 1fr;
  }

  .action-update__cta {
    justify-items: start;
  }
}

@media (max-width: 760px) {
  .action-update {
    grid-template-columns: 1fr;
    padding: 20px;
  }

  .action-update__icon {
    width: 54px;
    height: 54px;
    margin-bottom: 17px;
  }

  .action-update__icon svg {
    width: 25px;
    height: 25px;
  }

  .action-update__content {
    padding-left: 0;
  }

  .action-update__header {
    align-items: flex-start;
  }

  .action-update__meta {
    align-items: flex-start;
    flex-direction: column;
  }

  .action-update__author i,
  .action-update__author i + * {
    display: none;
  }

  .action-update time {
    max-width: 100px;
    text-align: right;
  }

  .action-update h2 {
    margin-top: 21px;
    font-size: 20px;
  }

  .action-update__description {
    font-size: 15px;
  }

  .action-update__deadline {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .action-update__security {
    order: 2;
  }

  .action-update__cta {
    width: 100%;
    justify-items: stretch;
  }

  .action-update__cta :deep(button),
  .action-update__cta :deep(a) {
    width: 100%;
  }

  .timeline-list {
    padding-inline: 1px;
  }

  .timeline-item {
    grid-template-columns: 57px minmax(0, 1fr);
  }

  .timeline-item__marker {
    width: 48px;
    height: 48px;
  }

  .timeline-item__marker svg {
    width: 22px;
    height: 22px;
  }

  .timeline-item__content {
    padding-left: 13px;
  }

  .timeline-item header {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }

  .timeline-item h3 {
    margin-top: 10px;
    font-size: 17px;
  }

  .timeline-item__line {
    left: 13px;
  }

  .case-contact {
    grid-template-columns: 1fr;
    gap: 0;
    padding: 14px 18px;
  }

  .case-contact p {
    padding-left: 7px;
  }
}
</style>
