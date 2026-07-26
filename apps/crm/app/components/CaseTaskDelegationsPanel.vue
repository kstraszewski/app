<script setup lang="ts">
interface DelegationProfile {
  id?: string
  user_id?: string
  email?: string | null
  full_name?: string | null
}

interface DelegationHistoryEntry {
  id: string
  activity_type: string
  title: string
  body?: string | null
  created_at: string
  actor?: DelegationProfile | null
}

interface DelegationMeeting {
  id: string
  starts_at: string
  ends_at?: string | null
  status: string
  meeting_mode?: string | null
  customer_name?: string | null
  notes?: string | null
  expert?: DelegationProfile | null
}

interface DelegatedTask {
  id: string
  title: string
  description?: string | null
  assignee_user_id: string
  delegator_user_id: string
  delegation_status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  status_code: 'open' | 'in_progress' | 'done' | 'cancelled' | string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  due_at?: string | null
  data_access_scope?: string[]
  delegated_at: string
  accepted_at?: string | null
  rejected_at?: string | null
  rejection_reason?: string | null
  completed_at?: string | null
  assignee?: DelegationProfile | null
  delegator?: DelegationProfile | null
  history?: DelegationHistoryEntry[]
  meetings?: DelegationMeeting[]
}

const props = defineProps<{
  tasks: DelegatedTask[]
  loading?: boolean
  currentUserId?: string | null
  updatingTaskId?: string | null
}>()

const emit = defineEmits<{
  delegate: []
  respond: [payload: { taskId: string, action: 'accept' | 'reject' | 'cancel', reason?: string }]
  updateStatus: [payload: { taskId: string, statusCode: 'in_progress' | 'done' }]
}>()

const rejectedTask = ref<DelegatedTask | null>(null)
const cancelledTask = ref<DelegatedTask | null>(null)
const rejectionReason = ref('')

const dateTimeFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const summary = computed(() => ({
  all: props.tasks.length,
  pending: props.tasks.filter(task => task.delegation_status === 'pending').length,
  active: props.tasks.filter(task => (
    task.delegation_status === 'accepted'
    && task.status_code !== 'done'
    && task.status_code !== 'cancelled'
  )).length,
  done: props.tasks.filter(task => task.status_code === 'done').length,
}))

const sortedTasks = computed(() => [...props.tasks].sort((left, right) => {
  const stateWeight = (task: DelegatedTask) => {
    if (task.delegation_status === 'pending') return 0
    if (task.delegation_status === 'accepted' && task.status_code !== 'done') return 1
    if (task.delegation_status === 'rejected') return 3
    return 2
  }
  const stateDifference = stateWeight(left) - stateWeight(right)
  if (stateDifference) return stateDifference
  return new Date(right.delegated_at).valueOf() - new Date(left.delegated_at).valueOf()
}))

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  return dateTimeFormatter.format(new Date(value))
}

function formatDate(value?: string | null) {
  if (!value) return 'Bez terminu'
  return dateFormatter.format(new Date(value))
}

function profileName(profile?: DelegationProfile | null) {
  return profile?.full_name || profile?.email || 'Nieznana osoba'
}

function initials(profile?: DelegationProfile | null) {
  const label = profileName(profile)
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '—'
}

function taskState(task: DelegatedTask) {
  if (task.delegation_status === 'pending') {
    return { label: 'Czeka na przyjęcie', color: 'warning' as const, icon: 'i-lucide-clock-3' }
  }
  if (task.delegation_status === 'rejected') {
    return { label: 'Odrzucone', color: 'error' as const, icon: 'i-lucide-circle-x' }
  }
  if (task.delegation_status === 'cancelled' || task.status_code === 'cancelled') {
    return { label: 'Anulowane', color: 'neutral' as const, icon: 'i-lucide-ban' }
  }
  if (task.status_code === 'done') {
    return { label: 'Zakończone', color: 'success' as const, icon: 'i-lucide-circle-check-big' }
  }
  if (task.status_code === 'in_progress') {
    return { label: 'W realizacji', color: 'info' as const, icon: 'i-lucide-loader-circle' }
  }
  return { label: 'Przyjęte', color: 'primary' as const, icon: 'i-lucide-shield-check' }
}

function priorityLabel(priority: DelegatedTask['priority']) {
  return {
    low: 'Niski',
    normal: 'Normalny',
    high: 'Wysoki',
    urgent: 'Pilny',
  }[priority]
}

function accessLabel(scope: string) {
  return {
    case_summary: 'Podsumowanie sprawy',
    client_contact: 'Kontakt do klienta',
    client_identity: 'Dane klienta',
    documents: 'Dokumenty',
    offers: 'Oferty',
    financial_data: 'Dane finansowe',
    activities: 'Historia aktywności',
  }[scope] ?? scope.replaceAll('_', ' ')
}

function meetingStatusLabel(status: string) {
  return {
    confirmed: 'Potwierdzone',
    hold: 'Oczekuje',
    cancelled: 'Anulowane',
  }[status] ?? status
}

function isOverdue(task: DelegatedTask) {
  return Boolean(
    task.due_at
    && task.status_code !== 'done'
    && task.status_code !== 'cancelled'
    && new Date(task.due_at).valueOf() < Date.now(),
  )
}

function openRejection(task: DelegatedTask) {
  rejectedTask.value = task
  rejectionReason.value = ''
}

function closeRejection() {
  rejectedTask.value = null
  rejectionReason.value = ''
}

function confirmRejection() {
  const reason = rejectionReason.value.trim()
  if (!rejectedTask.value || reason.length < 3) return
  emit('respond', {
    taskId: rejectedTask.value.id,
    action: 'reject',
    reason,
  })
  closeRejection()
}

function closeCancellation() {
  cancelledTask.value = null
}

function confirmCancellation() {
  if (!cancelledTask.value) return
  emit('respond', {
    taskId: cancelledTask.value.id,
    action: 'cancel',
  })
  closeCancellation()
}
</script>

<template>
  <section class="delegations-panel" aria-labelledby="delegations-panel-title">
    <header class="delegations-panel__header">
      <div>
        <p>Kontrola przekazanej pracy</p>
        <h2 id="delegations-panel-title">Delegowane zadania</h2>
        <span>Status, realizator, terminy, spotkania i pełny ślad zmian w jednym miejscu.</span>
      </div>
      <UButton
        icon="i-lucide-user-round-plus"
        size="lg"
        @click="emit('delegate')"
      >
        Deleguj zadanie
      </UButton>
    </header>

    <div class="delegations-summary" aria-label="Podsumowanie delegowanych zadań">
      <div>
        <span>Wszystkie</span>
        <strong>{{ summary.all }}</strong>
      </div>
      <div>
        <span>Czeka na przyjęcie</span>
        <strong>{{ summary.pending }}</strong>
      </div>
      <div>
        <span>W realizacji</span>
        <strong>{{ summary.active }}</strong>
      </div>
      <div>
        <span>Zakończone</span>
        <strong>{{ summary.done }}</strong>
      </div>
    </div>

    <div v-if="loading" class="delegations-loading" aria-label="Wczytywanie delegowanych zadań">
      <USkeleton v-for="index in 3" :key="index" class="h-44 w-full" />
    </div>

    <div v-else-if="!sortedTasks.length" class="delegations-empty">
      <span><UIcon name="i-lucide-send" /></span>
      <div>
        <strong>Jeszcze nic nie delegowano</strong>
        <p>Przekaż pierwsze zadanie i śledź tutaj jego przyjęcie, realizację oraz historię.</p>
      </div>
      <UButton color="neutral" variant="outline" @click="emit('delegate')">
        Deleguj pierwsze zadanie
      </UButton>
    </div>

    <ol v-else class="delegations-list">
      <li v-for="task in sortedTasks" :key="task.id">
        <article class="delegation-card">
          <div class="delegation-card__lead">
            <div class="delegation-card__title">
              <span :class="`delegation-card__state delegation-card__state--${taskState(task).color}`">
                <UIcon :name="taskState(task).icon" />
              </span>
              <div>
                <div class="delegation-card__badges">
                  <UBadge :color="taskState(task).color" variant="subtle" size="sm">
                    {{ taskState(task).label }}
                  </UBadge>
                  <UBadge
                    :color="task.priority === 'urgent' || task.priority === 'high' ? 'warning' : 'neutral'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ priorityLabel(task.priority) }}
                  </UBadge>
                </div>
                <h3>{{ task.title }}</h3>
                <p v-if="task.description">{{ task.description }}</p>
              </div>
            </div>

            <div class="delegation-card__assignee">
              <span class="delegation-avatar">{{ initials(task.assignee) }}</span>
              <div>
                <small>Realizator</small>
                <strong>{{ profileName(task.assignee) }}</strong>
              </div>
            </div>
          </div>

          <dl class="delegation-card__facts">
            <div :class="{ 'is-overdue': isOverdue(task) }">
              <dt><UIcon name="i-lucide-calendar-clock" />Termin</dt>
              <dd>{{ formatDate(task.due_at) }}</dd>
            </div>
            <div>
              <dt><UIcon name="i-lucide-send" />Oddelegowano</dt>
              <dd>{{ formatDateTime(task.delegated_at) }}</dd>
            </div>
            <div>
              <dt><UIcon name="i-lucide-handshake" />Przyjęcie</dt>
              <dd>{{ task.accepted_at ? formatDateTime(task.accepted_at) : task.rejected_at ? 'Odrzucone' : 'Oczekuje' }}</dd>
            </div>
            <div>
              <dt><UIcon name="i-lucide-video" />Spotkania</dt>
              <dd>{{ task.meetings?.length ?? 0 }}</dd>
            </div>
          </dl>

          <div v-if="task.data_access_scope?.length" class="delegation-card__access">
            <span><UIcon name="i-lucide-list-checks" />Kontekst zadania</span>
            <div>
              <UBadge
                v-for="scope in task.data_access_scope"
                :key="scope"
                color="neutral"
                variant="outline"
                size="sm"
              >
                {{ accessLabel(scope) }}
              </UBadge>
            </div>
          </div>

          <UAlert
            v-if="task.delegation_status === 'rejected'"
            color="error"
            variant="subtle"
            icon="i-lucide-message-square-warning"
            title="Zadanie zostało odrzucone"
            :description="task.rejection_reason || 'Realizator nie podał powodu.'"
          />

          <div
            v-if="(
              task.assignee_user_id === currentUserId
              || task.delegator_user_id === currentUserId
            ) && (task.delegation_status === 'pending' || task.delegation_status === 'accepted')"
            class="delegation-card__actions"
          >
            <UButton
              v-if="task.delegator_user_id === currentUserId"
              color="neutral"
              variant="ghost"
              icon="i-lucide-ban"
              :disabled="updatingTaskId === task.id"
              @click="cancelledTask = task"
            >
              Anuluj delegację
            </UButton>
            <template v-if="task.assignee_user_id === currentUserId && task.delegation_status === 'pending'">
              <UButton
                color="neutral"
                variant="outline"
                :disabled="updatingTaskId === task.id"
                @click="openRejection(task)"
              >
                Odrzuć
              </UButton>
              <UButton
                icon="i-lucide-check"
                :loading="updatingTaskId === task.id"
                @click="emit('respond', { taskId: task.id, action: 'accept' })"
              >
                Przyjmij zadanie
              </UButton>
            </template>
            <UButton
              v-else-if="task.assignee_user_id === currentUserId && task.status_code === 'open'"
              icon="i-lucide-play"
              :loading="updatingTaskId === task.id"
              @click="emit('updateStatus', { taskId: task.id, statusCode: 'in_progress' })"
            >
              Rozpocznij realizację
            </UButton>
            <UButton
              v-else-if="task.assignee_user_id === currentUserId && task.status_code === 'in_progress'"
              icon="i-lucide-circle-check-big"
              :loading="updatingTaskId === task.id"
              @click="emit('updateStatus', { taskId: task.id, statusCode: 'done' })"
            >
              Oznacz jako zakończone
            </UButton>
          </div>

          <div v-if="task.meetings?.length" class="delegation-card__meetings">
            <strong><UIcon name="i-lucide-calendar-days" />Spotkania powiązane z zadaniem</strong>
            <ol>
              <li v-for="meeting in task.meetings" :key="meeting.id">
                <span>{{ formatDateTime(meeting.starts_at) }}</span>
                <span>
                  {{ meeting.customer_name || 'Spotkanie z klientem' }}
                  <template v-if="meeting.expert"> · {{ profileName(meeting.expert) }}</template>
                </span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ meetingStatusLabel(meeting.status) }}
                </UBadge>
              </li>
            </ol>
          </div>

          <details v-if="task.history?.length" class="delegation-card__history">
            <summary>
              <span><UIcon name="i-lucide-history" />Historia zadania</span>
              <span>{{ task.history.length }} {{ task.history.length === 1 ? 'zdarzenie' : 'zdarzeń' }}</span>
            </summary>
            <ol>
              <li v-for="entry in task.history" :key="entry.id">
                <span />
                <div>
                  <strong>{{ entry.title }}</strong>
                  <p v-if="entry.body">{{ entry.body }}</p>
                  <small>{{ formatDateTime(entry.created_at) }} · {{ profileName(entry.actor) }}</small>
                </div>
              </li>
            </ol>
          </details>
        </article>
      </li>
    </ol>

    <UModal
      :open="Boolean(rejectedTask)"
      title="Odrzuć delegowane zadanie"
      description="Podaj krótki powód — delegujący zobaczy go w historii zadania."
      :ui="{ footer: 'justify-end' }"
      @update:open="value => { if (!value) closeRejection() }"
    >
      <template #body>
        <UFormField
          label="Powód odrzucenia"
          required
          :error="rejectionReason.trim().length > 0 && rejectionReason.trim().length < 3 ? 'Podaj co najmniej 3 znaki.' : undefined"
        >
          <UTextarea
            v-model="rejectionReason"
            class="w-full"
            :rows="4"
            maxlength="500"
            placeholder="Np. nie mam dostępu do wymaganych dokumentów."
            autofocus
          />
        </UFormField>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="closeRejection">
          Wróć
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-circle-x"
          :disabled="rejectionReason.trim().length < 3"
          @click="confirmRejection"
        >
          Odrzuć zadanie
        </UButton>
      </template>
    </UModal>

    <UModal
      :open="Boolean(cancelledTask)"
      title="Anulować delegację?"
      description="Zadanie pozostanie w historii sprawy, ale realizator nie będzie już go wykonywać."
      :ui="{ footer: 'justify-end' }"
      @update:open="value => { if (!value) closeCancellation() }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-history"
          title="Historia zostanie zachowana"
          :description="cancelledTask ? `Anulujesz: ${cancelledTask.title}` : undefined"
        />
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="closeCancellation">
          Wróć
        </UButton>
        <UButton color="error" icon="i-lucide-ban" @click="confirmCancellation">
          Anuluj delegację
        </UButton>
      </template>
    </UModal>
  </section>
</template>

<style scoped>
.delegations-panel {
  display: grid;
  gap: 22px;
}

.delegations-panel__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
}

.delegations-panel__header > div {
  display: grid;
  gap: 5px;
}

.delegations-panel__header p {
  margin: 0;
  color: var(--ui-primary);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.delegations-panel__header h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(1.35rem, 2vw, 1.85rem);
  letter-spacing: -0.035em;
}

.delegations-panel__header span {
  color: var(--ui-text-muted);
}

.delegations-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 72%, transparent);
}

.delegations-summary > div {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 17px 20px;
}

.delegations-summary > div + div {
  border-left: 1px solid var(--ui-border);
}

.delegations-summary span {
  color: var(--ui-text-muted);
  font-size: 0.83rem;
}

.delegations-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 1.35rem;
  font-variant-numeric: tabular-nums;
}

.delegations-loading,
.delegations-list {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.delegations-empty {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 28px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 14px;
}

.delegations-empty > span {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
  font-size: 1.25rem;
}

.delegations-empty strong {
  color: var(--ui-text-highlighted);
}

.delegations-empty p {
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 0.88rem;
}

.delegation-card {
  display: grid;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-bg-elevated);
}

.delegation-card__lead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, auto);
  align-items: start;
  gap: 24px;
}

.delegation-card__title {
  display: flex;
  gap: 14px;
}

.delegation-card__title > div {
  min-width: 0;
}

.delegation-card__state {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 11px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
  font-size: 1.05rem;
}

.delegation-card__state--warning { color: var(--ui-warning); }
.delegation-card__state--error { color: var(--ui-error); }
.delegation-card__state--success { color: var(--ui-success); }
.delegation-card__state--info { color: var(--ui-info); }
.delegation-card__state--primary { color: var(--ui-primary); }

.delegation-card__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.delegation-card h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 1.06rem;
  letter-spacing: -0.015em;
}

.delegation-card__title p {
  max-width: 68ch;
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 0.88rem;
  line-height: 1.55;
}

.delegation-card__assignee {
  display: flex;
  align-items: center;
  gap: 10px;
}

.delegation-avatar {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 34%, var(--ui-border));
  border-radius: 50%;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 0.75rem;
  font-weight: 800;
}

.delegation-card__assignee div {
  display: grid;
  gap: 1px;
}

.delegation-card__assignee small {
  color: var(--ui-text-dimmed);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.delegation-card__assignee strong {
  color: var(--ui-text-highlighted);
  font-size: 0.87rem;
}

.delegation-card__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 14px 0;
  border-block: 1px solid var(--ui-border);
}

.delegation-card__facts > div {
  display: grid;
  gap: 5px;
  padding-inline: 16px;
}

.delegation-card__facts > div:first-child {
  padding-left: 0;
}

.delegation-card__facts > div + div {
  border-left: 1px solid var(--ui-border);
}

.delegation-card__facts dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-dimmed);
  font-size: 0.72rem;
}

.delegation-card__facts dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 0.84rem;
  font-weight: 700;
}

.delegation-card__facts .is-overdue dt,
.delegation-card__facts .is-overdue dd {
  color: var(--ui-error);
}

.delegation-card__access {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 20px;
}

.delegation-card__access > span {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.delegation-card__access > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.delegation-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.delegation-card__meetings {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--ui-bg);
}

.delegation-card__meetings > strong {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-highlighted);
  font-size: 0.83rem;
}

.delegation-card__meetings ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.delegation-card__meetings li {
  display: grid;
  grid-template-columns: minmax(150px, auto) minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
}

.delegation-card__history {
  border-top: 1px solid var(--ui-border);
  padding-top: 14px;
}

.delegation-card__history summary {
  display: flex;
  cursor: pointer;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
  list-style: none;
}

.delegation-card__history summary::-webkit-details-marker {
  display: none;
}

.delegation-card__history summary > span:first-child {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-highlighted);
  font-weight: 700;
}

.delegation-card__history ol {
  display: grid;
  gap: 14px;
  margin: 16px 0 0 6px;
  padding: 0;
  list-style: none;
}

.delegation-card__history li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 11px;
}

.delegation-card__history li > span {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--ui-primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-primary) 12%, transparent);
}

.delegation-card__history strong {
  color: var(--ui-text-highlighted);
  font-size: 0.8rem;
}

.delegation-card__history p {
  margin: 3px 0;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
}

.delegation-card__history small {
  color: var(--ui-text-dimmed);
  font-size: 0.7rem;
}

@media (max-width: 900px) {
  .delegations-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .delegations-summary > div:nth-child(3) {
    border-left: 0;
    border-top: 1px solid var(--ui-border);
  }

  .delegations-summary > div:nth-child(4) {
    border-top: 1px solid var(--ui-border);
  }

  .delegation-card__lead {
    grid-template-columns: 1fr;
  }

  .delegation-card__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .delegation-card__facts > div:nth-child(3) {
    border-left: 0;
    border-top: 1px solid var(--ui-border);
    padding-top: 12px;
    padding-left: 0;
  }

  .delegation-card__facts > div:nth-child(4) {
    border-top: 1px solid var(--ui-border);
    padding-top: 12px;
  }
}

@media (max-width: 640px) {
  .delegations-panel__header {
    align-items: stretch;
    flex-direction: column;
  }

  .delegations-panel__header :deep(button) {
    justify-content: center;
    min-height: 44px;
  }

  .delegations-empty {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .delegations-empty :deep(button) {
    grid-column: 1 / -1;
    justify-content: center;
    min-height: 44px;
  }

  .delegation-card {
    padding: 17px;
  }

  .delegation-card__facts {
    grid-template-columns: 1fr;
    padding: 4px 0;
  }

  .delegation-card__facts > div,
  .delegation-card__facts > div:first-child,
  .delegation-card__facts > div:nth-child(3),
  .delegation-card__facts > div:nth-child(4) {
    border: 0;
    padding: 10px 0;
  }

  .delegation-card__facts > div + div {
    border-top: 1px solid var(--ui-border);
  }

  .delegation-card__access {
    align-items: stretch;
    flex-direction: column;
  }

  .delegation-card__access > div {
    justify-content: flex-start;
  }

  .delegation-card__meetings li {
    grid-template-columns: 1fr auto;
  }

  .delegation-card__meetings li > span:nth-child(2) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

@media (max-width: 480px) {
  .delegation-card__actions {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .delegation-card__actions :deep(button),
  .delegation-card__actions :deep(a) {
    flex: 1 1 100%;
    justify-content: center;
    width: 100%;
    min-height: 44px;
  }
}
</style>
