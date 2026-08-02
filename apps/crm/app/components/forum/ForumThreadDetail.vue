<script setup lang="ts">
import type {
  ForumAuthor,
  ForumCategory,
  ForumCreateReplyPayload,
  ForumPost,
  ForumThread,
  ForumThreadStatus,
  ForumThreadType,
} from '#shared/types/forum'
import { apiErrorMessage } from '~/utils/api-error'

interface ForumModerationAccess {
  canModerate: boolean
  canManageCategories: boolean
  roleLabel: string
}

interface ForumModerationVisibility {
  isHidden?: boolean
  hiddenAt?: string | null
  hiddenReason?: string | null
  hiddenByUserId?: string | null
}

interface ForumThreadModerationRequest {
  action: 'hide' | 'restore' | 'close' | 'reopen' | 'move'
  reason?: string
  categoryId?: string
}

interface ForumPendingHideAction {
  target: 'thread' | 'post'
  postId?: string
  targetLabel: string
}

interface ForumThreadModerationMenuItem {
  label: string
  description: string
  icon: string
  color?: 'error' | 'success' | 'warning'
  disabled?: boolean
  onSelect: () => void
}

const props = withDefaults(defineProps<{
  thread: ForumThread
  posts: ForumPost[]
  replyEndpoint: string
  categories?: ForumCategory[]
  moderation?: ForumModerationAccess
  threadModerationEndpoint?: string
  postsModerationEndpoint?: string
}>(), {
  categories: () => [],
  moderation: () => ({
    canModerate: false,
    canManageCategories: false,
    roleLabel: '',
  }),
  threadModerationEndpoint: '',
  postsModerationEndpoint: '',
})

const emit = defineEmits<{
  back: []
  replied: [payload: ForumCreateReplyPayload]
  moderated: []
}>()

const toast = useToast()
const replyBody = ref('')
const sendingReply = ref(false)
const replyError = ref('')
const moderationBusyKey = ref('')
const moderationError = ref('')
const reasonModalOpen = ref(false)
const pendingHideAction = ref<ForumPendingHideAction | null>(null)
const moveModalOpen = ref(false)
const moveCategoryId = ref('')

const statusPresentation: Record<ForumThreadStatus, { label: string, icon: string, color: 'success' | 'warning' | 'neutral' }> = {
  open: { label: 'Otwarte', icon: 'i-lucide-circle-dot', color: 'warning' },
  answered: { label: 'Odpowiedziane', icon: 'i-lucide-message-circle-check', color: 'success' },
  resolved: { label: 'Rozwiązane', icon: 'i-lucide-circle-check', color: 'success' },
  closed: { label: 'Zamknięte', icon: 'i-lucide-lock-keyhole', color: 'neutral' },
}

const typeLabels: Record<ForumThreadType, string> = {
  question: 'Pytanie',
  discussion: 'Dyskusja',
}

const moderatedThread = computed(() => props.thread as ForumThread & ForumModerationVisibility)
const threadIsHidden = computed(() => moderatedThread.value.isHidden === true)
const anyModerationBusy = computed(() => Boolean(moderationBusyKey.value))
const status = computed(() => statusPresentation[props.thread.status])
const questionPost = computed(() => props.posts.find(post => post.kind === 'question') ?? null)
const verifiedAnswer = computed(() => (
  props.posts.find(post => post.isVerifiedExpertAnswer) ?? null
))
const officialAnswer = computed(() => (
  props.posts.find(post => post.isOfficialAdminAnswer) ?? null
))
const remainingPosts = computed(() => props.posts.filter(post => (
  post.id !== questionPost.value?.id
  && post.id !== verifiedAnswer.value?.id
  && post.id !== officialAnswer.value?.id
)))
const questionBody = computed(() => (
  props.thread.body?.trim()
  || props.thread.content?.trim()
  || questionPost.value?.body?.trim()
  || questionPost.value?.content?.trim()
  || ''
))
const canReply = computed(() => props.thread.status !== 'closed' && !threadIsHidden.value)
const moveCategoryItems = computed(() => props.categories.map(category => ({
  label: category.name,
  value: category.id,
  icon: category.icon || 'i-lucide-folder',
})))
const threadModerationItems = computed<ForumThreadModerationMenuItem[][]>(() => [[
  props.thread.status === 'closed'
    ? {
        label: 'Otwórz ponownie',
        description: 'Pozwól członkom organizacji ponownie odpowiadać',
        icon: 'i-lucide-lock-open',
        color: 'success',
        disabled: anyModerationBusy.value,
        onSelect: () => { void moderateThread({ action: 'reopen' }) },
      }
    : {
        label: 'Zamknij wątek',
        description: 'Zatrzymaj dodawanie nowych odpowiedzi',
        icon: 'i-lucide-lock-keyhole',
        color: 'warning',
        disabled: anyModerationBusy.value,
        onSelect: () => { void moderateThread({ action: 'close' }) },
      },
  {
    label: 'Zmień kategorię',
    description: 'Przenieś temat do właściwego obszaru wiedzy',
    icon: 'i-lucide-folder-input',
    disabled: anyModerationBusy.value || !props.categories.length,
    onSelect: openMoveModal,
  },
], [
  threadIsHidden.value
    ? {
        label: 'Przywróć wątek',
        description: 'Ponownie pokaż go członkom organizacji',
        icon: 'i-lucide-eye',
        color: 'success',
        disabled: anyModerationBusy.value,
        onSelect: () => { void moderateThread({ action: 'restore' }) },
      }
    : {
        label: 'Ukryj wątek',
        description: 'Wymaga podania powodu moderacji',
        icon: 'i-lucide-eye-off',
        color: 'error',
        disabled: anyModerationBusy.value,
        onSelect: requestThreadHide,
      },
]])

watch(() => props.thread.id, () => {
  replyBody.value = ''
  replyError.value = ''
  moderationError.value = ''
  reasonModalOpen.value = false
  pendingHideAction.value = null
  moveModalOpen.value = false
  moveCategoryId.value = props.thread.category.id
})

function postBody(post: ForumPost): string {
  return post.body?.trim() || post.content?.trim() || ''
}

function postModerationState(post: ForumPost): ForumPost & ForumModerationVisibility {
  return post as ForumPost & ForumModerationVisibility
}

function isPostHidden(post: ForumPost): boolean {
  return postModerationState(post).isHidden === true
}

function postHiddenReason(post: ForumPost): string {
  return postModerationState(post).hiddenReason?.trim() || ''
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map(part => part.charAt(0).toLocaleUpperCase('pl'))
    .join('') || '?'
}

function authorRole(post: ForumPost): string {
  if (post.isOfficialAdminAnswer || post.author.role === 'admin') return 'Administracja organizacji'
  if (post.author.roleLabel === 'Administrator forum') {
    return post.author.expertise
      ? `Administrator forum · ${post.author.expertise}`
      : 'Administrator forum'
  }
  if (post.isVerifiedExpertAnswer || post.author.role === 'expert') {
    return post.author.expertise ? `Ekspert · ${post.author.expertise}` : 'Ekspert'
  }
  return post.author.roleLabel || 'Pracownik organizacji'
}

function authorRoleLabel(author: ForumAuthor): string {
  if (author.role === 'admin') return 'Administracja organizacji'
  if (author.roleLabel === 'Administrator forum') {
    return author.expertise
      ? `Administrator forum · ${author.expertise}`
      : 'Administrator forum'
  }
  if (author.role === 'expert') return author.expertise ? `Ekspert · ${author.expertise}` : 'Ekspert'
  return author.roleLabel || 'Pracownik organizacji'
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace('.', '')
}

async function submitReply(): Promise<void> {
  const body = replyBody.value.trim()
  if (body.length < 2 || sendingReply.value || !canReply.value) return
  sendingReply.value = true
  replyError.value = ''
  try {
    const payload = await $fetch<ForumCreateReplyPayload>(props.replyEndpoint, {
      method: 'POST',
      body: {
        body,
        clientRequestId: crypto.randomUUID(),
      },
    })
    replyBody.value = ''
    emit('replied', payload)
    toast.add({
      title: 'Odpowiedź została dodana',
      description: 'Uczestnicy wątku zobaczą ją zgodnie ze swoimi uprawnieniami.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error) {
    replyError.value = apiErrorMessage(error)
  } finally {
    sendingReply.value = false
  }
}

function moderationSuccessMessage(action: ForumThreadModerationRequest['action']): string {
  const messages: Record<ForumThreadModerationRequest['action'], string> = {
    hide: 'Wątek został ukryty',
    restore: 'Wątek został przywrócony',
    close: 'Wątek został zamknięty',
    reopen: 'Wątek został ponownie otwarty',
    move: 'Kategoria wątku została zmieniona',
  }
  return messages[action]
}

async function moderateThread(request: ForumThreadModerationRequest): Promise<boolean> {
  if (!props.moderation.canModerate || !props.threadModerationEndpoint || anyModerationBusy.value) {
    return false
  }
  moderationBusyKey.value = `thread:${request.action}`
  moderationError.value = ''
  try {
    await $fetch(props.threadModerationEndpoint, {
      method: 'PATCH',
      body: request,
    })
    toast.add({
      title: moderationSuccessMessage(request.action),
      description: 'Zmiana została zapisana w historii moderacji.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
    emit('moderated')
    return true
  } catch (error) {
    moderationError.value = apiErrorMessage(error)
    return false
  } finally {
    moderationBusyKey.value = ''
  }
}

async function moderatePost(postId: string, action: 'hide' | 'restore', reason?: string): Promise<boolean> {
  if (!props.moderation.canModerate || !props.postsModerationEndpoint || anyModerationBusy.value) {
    return false
  }
  moderationBusyKey.value = `post:${postId}:${action}`
  moderationError.value = ''
  try {
    await $fetch(`${props.postsModerationEndpoint}/${encodeURIComponent(postId)}/moderation`, {
      method: 'PATCH',
      body: { action, ...(reason ? { reason } : {}) },
    })
    toast.add({
      title: action === 'hide' ? 'Wpis został ukryty' : 'Wpis został przywrócony',
      description: 'Zmiana została zapisana w historii moderacji.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
    emit('moderated')
    return true
  } catch (error) {
    moderationError.value = apiErrorMessage(error)
    return false
  } finally {
    moderationBusyKey.value = ''
  }
}

function requestThreadHide(): void {
  moderationError.value = ''
  pendingHideAction.value = {
    target: 'thread',
    targetLabel: 'wątek',
  }
  reasonModalOpen.value = true
}

function requestPostAction(post: ForumPost, action: 'hide' | 'restore'): void {
  if (action === 'restore') {
    void moderatePost(post.id, 'restore')
    return
  }
  moderationError.value = ''
  pendingHideAction.value = {
    target: 'post',
    postId: post.id,
    targetLabel: `wpis użytkownika ${post.author.name}`,
  }
  reasonModalOpen.value = true
}

async function confirmHide(reason: string): Promise<void> {
  const pendingAction = pendingHideAction.value
  if (!pendingAction) return
  const succeeded = pendingAction.target === 'thread'
    ? await moderateThread({ action: 'hide', reason })
    : await moderatePost(pendingAction.postId || '', 'hide', reason)
  if (!succeeded) return
  reasonModalOpen.value = false
  pendingHideAction.value = null
}

function openMoveModal(): void {
  moderationError.value = ''
  moveCategoryId.value = props.thread.category.id
  moveModalOpen.value = true
}

async function confirmMove(): Promise<void> {
  if (!moveCategoryId.value || moveCategoryId.value === props.thread.category.id) {
    moveModalOpen.value = false
    return
  }
  const succeeded = await moderateThread({
    action: 'move',
    categoryId: moveCategoryId.value,
  })
  if (succeeded) moveModalOpen.value = false
}

</script>

<template>
  <article class="forum-detail" :aria-labelledby="`forum-thread-title-${thread.id}`">
    <div class="forum-detail__mobile-back">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        @click="emit('back')"
      >
        Wróć do tematów
      </UButton>
    </div>

    <header class="forum-detail__header">
      <div class="forum-detail__topline">
        <nav class="forum-detail__breadcrumbs" aria-label="Położenie wątku">
          <span>{{ thread.category.name }}</span>
          <UIcon name="i-lucide-chevron-right" aria-hidden="true" />
          <span>{{ typeLabels[thread.type] }}</span>
          <UIcon name="i-lucide-chevron-right" aria-hidden="true" />
          <span class="forum-detail__status-label">
            <UIcon :name="status.icon" aria-hidden="true" />
            {{ status.label }}
          </span>
        </nav>
        <div class="forum-detail__tools">
          <UBadge
            v-if="threadIsHidden"
            color="error"
            variant="subtle"
            size="xs"
            icon="i-lucide-eye-off"
          >
            Ukryty
          </UBadge>
          <span class="forum-detail__id">ID: {{ thread.id.slice(0, 8).toUpperCase() }}</span>
          <UDropdownMenu
            v-if="moderation.canModerate"
            :items="threadModerationItems"
            :content="{ align: 'end' }"
          >
            <UButton
              color="neutral"
              variant="outline"
              size="xs"
              icon="i-lucide-shield-check"
              trailing-icon="i-lucide-chevron-down"
              :loading="anyModerationBusy"
              aria-label="Otwórz menu moderatora wątku"
            >
              Moderuj
            </UButton>
          </UDropdownMenu>
        </div>
      </div>

      <h2 :id="`forum-thread-title-${thread.id}`">{{ thread.title }}</h2>

      <div class="forum-detail__meta">
        <UBadge color="neutral" variant="outline" icon="i-lucide-building-2">
          Cała organizacja
        </UBadge>
        <span>Język: {{ (thread.languageCode || 'pl').toLocaleUpperCase('pl') }}</span>
        <span>Aktywność: {{ formatDate(thread.lastActivityAt) }}</span>
        <span>
          <UIcon name="i-lucide-eye" aria-hidden="true" />
          {{ thread.viewCount || 0 }} wyświetleń
        </span>
      </div>
    </header>

    <UAlert
      v-if="moderationError && !reasonModalOpen && !moveModalOpen"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się wykonać działania moderatora"
      :description="moderationError"
      :close="{ onClick: () => { moderationError = '' } }"
    />

    <UAlert
      v-if="threadIsHidden"
      color="error"
      variant="subtle"
      icon="i-lucide-eye-off"
      title="Ten wątek jest ukryty"
      :description="moderatedThread.hiddenReason || 'Treść jest widoczna wyłącznie dla moderatorów do czasu jej przywrócenia.'"
    />

    <section class="forum-question" aria-labelledby="forum-question-heading">
      <header class="forum-post-heading">
        <div>
          <p id="forum-question-heading">{{ typeLabels[thread.type] }}</p>
          <span>Autor: {{ questionPost?.author.name || thread.author.name }}</span>
          <span>{{ questionPost ? authorRole(questionPost) : authorRoleLabel(thread.author) }}</span>
        </div>
        <time :datetime="thread.createdAt">Utworzono: {{ formatDate(thread.createdAt) }}</time>
      </header>
      <p class="forum-question__body">{{ questionBody }}</p>
    </section>

    <section
      v-if="verifiedAnswer"
      class="forum-featured-answer forum-featured-answer--expert"
      :class="{ 'forum-post--hidden': isPostHidden(verifiedAnswer) }"
      aria-labelledby="forum-verified-answer-heading"
    >
      <header class="forum-featured-answer__title">
        <span>
          <UIcon name="i-lucide-badge-check" aria-hidden="true" />
          <strong id="forum-verified-answer-heading">Zweryfikowana odpowiedź eksperta</strong>
        </span>
        <div class="forum-featured-answer__actions">
          <span class="forum-featured-answer__verification">
            <UIcon name="i-lucide-circle-check" aria-hidden="true" />
            Zweryfikowano {{ formatDate(verifiedAnswer.updatedAt || verifiedAnswer.createdAt) }}
          </span>
          <ForumPostModerationMenu
            v-if="moderation.canModerate"
            :is-hidden="isPostHidden(verifiedAnswer)"
            :busy="anyModerationBusy"
            post-label="zweryfikowanej odpowiedzi"
            @action="requestPostAction(verifiedAnswer, $event)"
          />
        </div>
      </header>

      <div class="forum-answer-author">
        <UAvatar
          :src="verifiedAnswer.author.avatarUrl || undefined"
          :alt="verifiedAnswer.author.name"
          :text="initials(verifiedAnswer.author.name)"
          size="md"
        />
        <div>
          <strong>{{ verifiedAnswer.author.name }}</strong>
          <UBadge color="success" variant="subtle" size="xs" icon="i-lucide-badge-check">
            {{ authorRole(verifiedAnswer) }}
          </UBadge>
        </div>
      </div>

      <p v-if="isPostHidden(verifiedAnswer)" class="forum-post__moderation-note">
        <UIcon name="i-lucide-eye-off" aria-hidden="true" />
        Ukryty wpis<span v-if="postHiddenReason(verifiedAnswer)"> · {{ postHiddenReason(verifiedAnswer) }}</span>
      </p>

      <p class="forum-featured-answer__body">{{ postBody(verifiedAnswer) }}</p>

      <div v-if="verifiedAnswer.sources?.length" class="forum-answer-sources">
        <h3>Źródła i podstawa odpowiedzi</h3>
        <ul>
          <li v-for="source in verifiedAnswer.sources" :key="source.id">
            <UIcon name="i-lucide-file-text" aria-hidden="true" />
            <span>
              <strong>{{ source.title }}</strong>
              <small>{{ source.label || (source.kind === 'external' ? 'Dokument zewnętrzny' : 'Dokument wewnętrzny') }}</small>
            </span>
            <UButton
              v-if="source.url"
              :href="source.url"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="outline"
              size="xs"
              trailing-icon="i-lucide-external-link"
            >
              Otwórz
            </UButton>
          </li>
        </ul>
      </div>
    </section>

    <section
      v-if="officialAnswer"
      class="forum-featured-answer forum-featured-answer--admin"
      :class="{ 'forum-post--hidden': isPostHidden(officialAnswer) }"
      aria-labelledby="forum-official-answer-heading"
    >
      <header class="forum-featured-answer__title">
        <span>
          <UIcon name="i-lucide-shield-check" aria-hidden="true" />
          <strong id="forum-official-answer-heading">Oficjalna odpowiedź administracji</strong>
        </span>
        <div class="forum-featured-answer__actions">
          <time :datetime="officialAnswer.createdAt">Opublikowano: {{ formatDate(officialAnswer.createdAt) }}</time>
          <ForumPostModerationMenu
            v-if="moderation.canModerate"
            :is-hidden="isPostHidden(officialAnswer)"
            :busy="anyModerationBusy"
            post-label="oficjalnej odpowiedzi administracji"
            @action="requestPostAction(officialAnswer, $event)"
          />
        </div>
      </header>
      <div class="forum-answer-author">
        <UAvatar
          :src="officialAnswer.author.avatarUrl || undefined"
          :alt="officialAnswer.author.name"
          :text="initials(officialAnswer.author.name)"
          size="md"
        />
        <div>
          <strong>{{ officialAnswer.author.name }}</strong>
          <UBadge color="warning" variant="subtle" size="xs" icon="i-lucide-shield-check">
            Administracja organizacji
          </UBadge>
        </div>
      </div>
      <p v-if="isPostHidden(officialAnswer)" class="forum-post__moderation-note">
        <UIcon name="i-lucide-eye-off" aria-hidden="true" />
        Ukryty wpis<span v-if="postHiddenReason(officialAnswer)"> · {{ postHiddenReason(officialAnswer) }}</span>
      </p>
      <p class="forum-featured-answer__body">{{ postBody(officialAnswer) }}</p>
    </section>

    <section v-if="remainingPosts.length" class="forum-replies" aria-labelledby="forum-replies-heading">
      <div class="forum-replies__heading">
        <h3 id="forum-replies-heading">Pozostałe odpowiedzi</h3>
        <span>{{ remainingPosts.length }}</span>
      </div>
      <article
        v-for="post in remainingPosts"
        :key="post.id"
        class="forum-reply"
        :class="{ 'forum-post--hidden': isPostHidden(post) }"
      >
        <header>
          <UAvatar
            :src="post.author.avatarUrl || undefined"
            :alt="post.author.name"
            :text="initials(post.author.name)"
            size="sm"
          />
          <div>
            <strong>{{ post.author.name }}</strong>
            <span>{{ authorRole(post) }}</span>
          </div>
          <div class="forum-reply__actions">
            <time :datetime="post.createdAt">{{ formatDate(post.createdAt) }}</time>
            <ForumPostModerationMenu
              v-if="moderation.canModerate"
              :is-hidden="isPostHidden(post)"
              :busy="anyModerationBusy"
              :post-label="`odpowiedzi użytkownika ${post.author.name}`"
              @action="requestPostAction(post, $event)"
            />
          </div>
        </header>
        <p v-if="isPostHidden(post)" class="forum-post__moderation-note">
          <UIcon name="i-lucide-eye-off" aria-hidden="true" />
          Ukryty wpis<span v-if="postHiddenReason(post)"> · {{ postHiddenReason(post) }}</span>
        </p>
        <p>{{ postBody(post) }}</p>
      </article>
    </section>

    <form class="forum-reply-composer" @submit.prevent="submitReply">
      <UAlert
        v-if="replyError"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się dodać odpowiedzi"
        :description="replyError"
      />
      <UFormField
        name="forum-reply"
        label="Twoja odpowiedź"
        :description="canReply ? 'Odpowiedź będzie widoczna dla użytkowników z dostępem do tego wątku.' : 'Ten wątek został zamknięty.'"
        :error="replyBody.trim().length === 1 ? 'Odpowiedź musi mieć co najmniej 2 znaki.' : undefined"
      >
        <UTextarea
          v-model="replyBody"
          class="w-full"
          autoresize
          :rows="3"
          :maxrows="10"
          :maxlength="12000"
          :disabled="!canReply || sendingReply"
          placeholder="Dodaj odpowiedź lub poproś o doprecyzowanie…"
        />
      </UFormField>
      <div class="forum-reply-composer__actions">
        <UButton
          type="submit"
          icon="i-lucide-send"
          :loading="sendingReply"
          :disabled="!canReply || replyBody.trim().length < 2"
        >
          Opublikuj odpowiedź
        </UButton>
      </div>
    </form>

    <ForumModerationReasonModal
      v-model:open="reasonModalOpen"
      :target-label="pendingHideAction?.targetLabel || 'treść'"
      :busy="anyModerationBusy"
      :error="moderationError"
      @confirm="confirmHide"
    />

    <UModal
      v-model:open="moveModalOpen"
      title="Zmień kategorię wątku"
      description="Przenieś temat do obszaru, w którym eksperci najłatwiej go odnajdą."
      :dismissible="!anyModerationBusy"
      :close="anyModerationBusy ? false : undefined"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <form id="forum-move-thread-form" class="forum-move-thread" @submit.prevent="confirmMove">
          <UAlert
            v-if="moderationError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się przenieść wątku"
            :description="moderationError"
          />
          <UFormField
            name="forum-thread-category"
            label="Docelowa kategoria"
            description="Zmiana kategorii nie wpływa na treść ani historię odpowiedzi."
            required
          >
            <USelect
              v-model="moveCategoryId"
              class="w-full"
              :items="moveCategoryItems"
              value-key="value"
              :disabled="anyModerationBusy"
              placeholder="Wybierz kategorię"
            />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="anyModerationBusy"
          @click="moveModalOpen = false"
        >
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="forum-move-thread-form"
          icon="i-lucide-folder-input"
          :loading="moderationBusyKey === 'thread:move'"
          :disabled="!moveCategoryId || moveCategoryId === thread.category.id"
        >
          Przenieś wątek
        </UButton>
      </template>
    </UModal>
  </article>
</template>

<style scoped>
.forum-detail {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 28px 30px 42px;
}

.forum-detail__mobile-back {
  display: none;
}

.forum-detail__header {
  padding-bottom: 10px;
}

.forum-detail__topline,
.forum-detail__breadcrumbs,
.forum-detail__meta,
.forum-detail__tools,
.forum-post-heading,
.forum-featured-answer__title,
.forum-featured-answer__title > span,
.forum-featured-answer__actions,
.forum-featured-answer__verification,
.forum-answer-author,
.forum-answer-author > div,
.forum-replies__heading,
.forum-reply header,
.forum-reply__actions,
.forum-post__moderation-note,
.forum-reply-composer__actions {
  display: flex;
  align-items: center;
}

.forum-detail__topline {
  justify-content: space-between;
  gap: 18px;
}

.forum-detail__breadcrumbs {
  min-width: 0;
  flex-wrap: wrap;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.forum-detail__breadcrumbs :deep(svg) {
  width: 13px;
  height: 13px;
}

.forum-detail__status-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-success);
  font-weight: 650;
}

.forum-detail__id {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.forum-detail__tools {
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 8px;
}

.forum-detail__header h2 {
  max-width: 840px;
  margin: 24px 0 20px;
  color: var(--ui-text-highlighted);
  font-size: clamp(24px, 2.7vw, 34px);
  font-weight: 560;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.forum-detail__meta {
  flex-wrap: wrap;
  gap: 8px 24px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.forum-detail__meta > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.forum-question,
.forum-featured-answer,
.forum-reply,
.forum-reply-composer {
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.forum-question {
  padding: 18px 20px;
}

.forum-post-heading {
  justify-content: space-between;
  gap: 18px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-post-heading > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.forum-post-heading p {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.forum-question__body,
.forum-featured-answer__body,
.forum-reply > p {
  color: var(--ui-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.forum-question__body {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.6;
}

.forum-featured-answer {
  padding: 18px 20px 20px;
}

.forum-featured-answer--expert {
  border-color: color-mix(in srgb, var(--ui-success) 40%, var(--ui-border));
}

.forum-featured-answer--admin {
  border-color: color-mix(in srgb, var(--ui-warning) 45%, var(--ui-border));
}

.forum-post--hidden {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--ui-error) 48%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-error) 4%, var(--ui-bg));
}

.forum-featured-answer__title {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-featured-answer__title > span {
  gap: 8px;
}

.forum-featured-answer__actions {
  justify-content: flex-end;
  gap: 8px;
}

.forum-featured-answer__verification {
  gap: 5px;
}

.forum-featured-answer__title > span:first-child {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.forum-featured-answer--expert .forum-featured-answer__title > span:first-child,
.forum-featured-answer--expert .forum-featured-answer__verification {
  color: var(--ui-success);
}

.forum-featured-answer--admin .forum-featured-answer__title > span:first-child {
  color: var(--ui-warning);
}

.forum-featured-answer__title :deep(svg) {
  width: 19px;
  height: 19px;
}

.forum-answer-author {
  gap: 11px;
}

.forum-answer-author > div {
  flex-wrap: wrap;
  gap: 7px 10px;
}

.forum-answer-author strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.forum-featured-answer__body {
  margin: 16px 0 0;
  font-size: 13px;
  line-height: 1.65;
}

.forum-post__moderation-note {
  gap: 6px;
  margin: 12px 0 0;
  padding: 7px 9px;
  border-radius: 7px;
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 9%, transparent);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
}

.forum-post__moderation-note :deep(svg) {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
}

.forum-answer-sources {
  margin-top: 20px;
}

.forum-answer-sources h3 {
  margin: 0 0 9px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.forum-answer-sources ul {
  display: grid;
  margin: 0;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  list-style: none;
}

.forum-answer-sources li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
}

.forum-answer-sources li + li {
  border-top: 1px solid var(--ui-border);
}

.forum-answer-sources li > :deep(svg) {
  color: var(--ui-text-muted);
}

.forum-answer-sources li > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.forum-answer-sources li strong,
.forum-answer-sources li small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forum-answer-sources li strong {
  color: var(--ui-text);
  font-size: 11px;
}

.forum-answer-sources li small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.forum-replies {
  display: grid;
  gap: 10px;
  padding-top: 8px;
}

.forum-replies__heading {
  justify-content: space-between;
}

.forum-replies__heading h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
}

.forum-replies__heading span {
  display: grid;
  place-items: center;
  min-width: 25px;
  height: 22px;
  border-radius: 999px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
  font-family: var(--font-mono);
  font-size: 9px;
}

.forum-reply {
  padding: 15px 17px 17px;
}

.forum-reply header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
}

.forum-reply header > div {
  display: grid;
  gap: 1px;
}

.forum-reply header > .forum-reply__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.forum-reply header strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.forum-reply header span,
.forum-reply time {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.forum-reply > p {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
}

.forum-reply > .forum-post__moderation-note {
  margin-top: 10px;
  font-size: 10px;
  line-height: 1.4;
}

.forum-reply-composer {
  display: grid;
  gap: 12px;
  margin-top: 16px;
  padding: 16px;
}

.forum-reply-composer__actions {
  justify-content: flex-end;
  gap: 8px;
}

.forum-move-thread {
  display: grid;
  gap: 16px;
}

@media (max-width: 740px) {
  .forum-detail {
    padding: 18px 15px 34px;
  }

  .forum-detail__mobile-back {
    display: block;
    margin-left: -8px;
  }

  .forum-detail__topline,
  .forum-post-heading,
  .forum-featured-answer__title {
    align-items: flex-start;
    flex-direction: column;
  }

  .forum-detail__tools,
  .forum-featured-answer__actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .forum-detail__id {
    overflow-wrap: anywhere;
  }

  .forum-detail__header h2 {
    margin-block: 18px;
  }

  .forum-question,
  .forum-featured-answer {
    padding: 16px;
  }

  .forum-answer-sources li {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .forum-answer-sources li :deep(a) {
    grid-column: 2;
    justify-self: start;
  }

  .forum-reply header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .forum-reply__actions {
    grid-column: 2;
    justify-content: flex-start;
  }

  .forum-reply-composer__actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .forum-reply-composer__actions :deep(button) {
    justify-content: center;
  }
}
</style>
