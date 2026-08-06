<script setup lang="ts">
import type {
  CaseItem,
  CaseItemHandoff,
  CaseItemHandoffAction,
  CaseUserSummary,
  CaseWorkflowStatus,
} from '~/types/cases'

type StatusColor = 'neutral' | 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error'

const props = withDefaults(defineProps<{
  item: CaseItem
  currentUserId: string
  caseOwnerUserId: string | null
  statusUpdating?: boolean
  handoffUpdating?: boolean
  focused?: boolean
}>(), {
  statusUpdating: false,
  handoffUpdating: false,
  focused: false,
})

const emit = defineEmits<{
  'change-status': [payload: { item: CaseItem, statusCode: string }]
  'handoff': [item: CaseItem]
  'resolve-handoff': [payload: {
    item: CaseItem
    handoff: CaseItemHandoff
    action: CaseItemHandoffAction
  }]
}>()

const dateFormatter = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' })
const dateTimeFormatter = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const statuses = computed(() => (
  [...(props.item.workflow?.statuses ?? [])].sort((left, right) => left.sort_order - right.sort_order)
))
const currentStatusIndex = computed(() => (
  statuses.value.findIndex(status => status.code === props.item.status_code)
))
const currentStatus = computed(() => (
  statuses.value.find(status => status.code === props.item.status_code) ?? null
))
const statusOptions = computed(() => statuses.value.map(status => ({
  label: status.label,
  value: status.code,
})))
const pendingHandoff = computed(() => (
  props.item.pending_handoff
  ?? (props.item.handoffs ?? []).find(handoff => handoff.status === 'pending')
  ?? null
))
const canChangeStatus = computed(() => Boolean(props.item.permissions?.can_change_status))
const canHandoff = computed(() => Boolean(props.item.permissions?.can_handoff) && !pendingHandoff.value)
const canRespondToHandoff = computed(() => (
  pendingHandoff.value?.proposed_owner_user_id === props.currentUserId
))
const canCancelHandoff = computed(() => {
  const handoff = pendingHandoff.value
  if (!handoff || !props.currentUserId) return false
  return handoff.requested_by_user_id === props.currentUserId
    || props.item.owner_user_id === props.currentUserId
    || props.caseOwnerUserId === props.currentUserId
})

const processIcon = computed(() => {
  const code = props.item.product_type?.code ?? ''
  if (code === 'credit_mortgage') return 'i-lucide-landmark'
  if (code.startsWith('credit_')) return 'i-lucide-wallet-cards'
  if (code === 'insurance_life') return 'i-lucide-heart-pulse'
  if (code.startsWith('insurance_')) return 'i-lucide-shield-check'
  if (code.startsWith('real_estate_')) return 'i-lucide-house'
  return 'i-lucide-workflow'
})

function profileName(profile: CaseUserSummary | null | undefined) {
  return profile?.full_name || profile?.email || 'Nieprzypisany'
}

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : 'Nie ustalono'
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function statusLabel() {
  return currentStatus.value?.label ?? props.item.status_code.replaceAll('_', ' ')
}

function statusColor(value: string | undefined): StatusColor {
  const colors: StatusColor[] = ['neutral', 'primary', 'secondary', 'info', 'success', 'warning', 'error']
  return colors.includes(value as StatusColor) ? value as StatusColor : 'neutral'
}

function stageClass(status: CaseWorkflowStatus, index: number) {
  if (status.code === props.item.status_code) return 'is-current'
  if (currentStatusIndex.value >= 0 && index < currentStatusIndex.value) return 'is-complete'
  return 'is-upcoming'
}

function changeStatus(value: unknown) {
  const statusCode = typeof value === 'string' ? value : ''
  if (!statusCode || statusCode === props.item.status_code || props.statusUpdating) return
  emit('change-status', { item: props.item, statusCode })
}

function resolveHandoff(action: CaseItemHandoffAction) {
  if (!pendingHandoff.value || props.handoffUpdating) return
  emit('resolve-handoff', {
    item: props.item,
    handoff: pendingHandoff.value,
    action,
  })
}
</script>

<template>
  <article
    :id="`case-process-${item.id}`"
    class="process-card"
    :class="{ 'is-focused': focused }"
    :aria-labelledby="`case-process-title-${item.id}`"
  >
    <header class="process-card__header">
      <span class="process-card__icon" aria-hidden="true">
        <UIcon :name="processIcon" />
      </span>
      <div class="process-card__identity">
        <small>{{ item.product_type?.name || 'Proces w sprawie' }}</small>
        <h3 :id="`case-process-title-${item.id}`">{{ item.title }}</h3>
      </div>
      <UBadge
        :color="statusColor(currentStatus?.color)"
        variant="subtle"
        size="sm"
      >
        {{ statusLabel() }}
      </UBadge>
    </header>

    <dl class="process-card__facts">
      <div>
        <dt><UIcon name="i-lucide-user-round" /> Opiekun procesu</dt>
        <dd>{{ profileName(item.owner) }}</dd>
      </div>
      <div>
        <dt><UIcon name="i-lucide-calendar-clock" /> Planowane zakończenie</dt>
        <dd>{{ formatDate(item.expected_close_date) }}</dd>
      </div>
    </dl>

    <section v-if="statuses.length" class="process-card__workflow" :aria-labelledby="`case-process-workflow-${item.id}`">
      <div class="process-card__section-heading">
        <div>
          <small>Przebieg procesu</small>
          <strong :id="`case-process-workflow-${item.id}`">{{ item.workflow?.name }}</strong>
        </div>
        <span>{{ Math.max(1, currentStatusIndex + 1) }}/{{ statuses.length }}</span>
      </div>

      <div class="workflow-stages-scroll">
        <ol class="workflow-stages">
          <li
            v-for="(status, index) in statuses"
            :key="status.code"
            :class="stageClass(status, index)"
            :aria-current="status.code === item.status_code ? 'step' : undefined"
          >
            <span class="workflow-stage__rail" aria-hidden="true" />
            <span class="workflow-stage__point" aria-hidden="true">
              <Transition name="workflow-check">
                <UIcon v-if="index < currentStatusIndex" name="i-lucide-check" />
              </Transition>
            </span>
            <span class="workflow-stage__label">{{ status.label }}</span>
          </li>
        </ol>
      </div>
    </section>

    <section v-if="pendingHandoff" class="handoff-notice" aria-label="Oczekujące przekazanie procesu">
      <span class="handoff-notice__icon" aria-hidden="true">
        <UIcon name="i-lucide-send" />
      </span>
      <div class="handoff-notice__copy">
        <small>Oczekujące przekazanie</small>
        <strong>{{ profileName(pendingHandoff.proposed_owner) }}</strong>
        <span>
          {{ profileName(pendingHandoff.requested_by) }} · {{ formatDateTime(pendingHandoff.requested_at) }}
        </span>
        <p v-if="pendingHandoff.request_note">{{ pendingHandoff.request_note }}</p>
      </div>
      <div v-if="canRespondToHandoff || canCancelHandoff" class="handoff-notice__actions">
        <template v-if="canRespondToHandoff">
          <UButton
            size="xs"
            color="success"
            icon="i-lucide-check"
            :loading="handoffUpdating"
            :disabled="handoffUpdating"
            @click="resolveHandoff('accept')"
          >
            Przyjmij prowadzenie
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-x"
            :disabled="handoffUpdating"
            @click="resolveHandoff('reject')"
          >
            Odrzuć
          </UButton>
        </template>
        <UButton
          v-if="canCancelHandoff"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="handoffUpdating"
          @click="resolveHandoff('cancel')"
        >
          Anuluj przekazanie
        </UButton>
      </div>
    </section>

    <footer class="process-card__footer">
      <UFormField
        v-if="canChangeStatus && statusOptions.length"
        class="process-card__status-field"
        :name="`process-status-${item.id}`"
        label="Bieżący etap"
      >
        <USelect
          :model-value="item.status_code"
          class="w-full"
          :items="statusOptions"
          value-key="value"
          :loading="statusUpdating"
          :disabled="statusUpdating || handoffUpdating"
          aria-label="Zmień etap procesu"
          @update:model-value="changeStatus"
        />
      </UFormField>
      <span v-else />

      <UButton
        v-if="canHandoff"
        color="neutral"
        variant="outline"
        icon="i-lucide-user-round-cog"
        :disabled="statusUpdating || handoffUpdating"
        @click="emit('handoff', item)"
      >
        Przekaż proces
      </UButton>
    </footer>
  </article>
</template>

<style scoped>
.process-card {
  display: grid;
  gap: 20px;
  min-width: 0;
  padding: 20px;
  scroll-margin-top: 24px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.process-card.is-focused {
  border-color: color-mix(in srgb, var(--ui-primary) 58%, var(--ui-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 14%, transparent);
}

.process-card__header,
.process-card__facts,
.process-card__section-heading,
.process-card__footer,
.handoff-notice,
.handoff-notice__actions {
  display: flex;
}

.process-card__header {
  align-items: flex-start;
  gap: 12px;
}

.process-card__icon,
.handoff-notice__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.process-card__icon .iconify { width: 18px; height: 18px; }

.process-card__identity {
  min-width: 0;
  flex: 1;
}

.process-card__identity small,
.process-card__section-heading small,
.handoff-notice__copy small {
  display: block;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .035em;
  text-transform: uppercase;
}

.process-card__identity h3 {
  overflow: hidden;
  margin: 3px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-card__facts {
  gap: 12px;
}

.process-card__facts > div {
  min-width: 0;
  flex: 1;
  padding: 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.process-card__facts dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.process-card__facts dt .iconify { width: 13px; height: 13px; }

.process-card__facts dd {
  overflow: hidden;
  margin: 5px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-card__workflow {
  min-width: 0;
}

.process-card__section-heading {
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 13px;
}

.process-card__section-heading strong {
  display: block;
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.process-card__section-heading > span {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.workflow-stages-scroll {
  overflow-x: auto;
  padding: 2px 1px 5px;
}

.workflow-stages {
  display: flex;
  min-width: max-content;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workflow-stages li {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 7px;
  width: 98px;
  color: var(--ui-text-dimmed);
  text-align: center;
}

.workflow-stage__rail {
  position: absolute;
  top: 8px;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--ui-border-accented);
}

.workflow-stage__rail::after {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--ui-success) 68%, var(--ui-border));
  content: '';
  opacity: 0;
  transform: scaleX(0);
  transform-origin: left center;
  transition:
    opacity 90ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1)),
    transform 120ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1));
}

.workflow-stages li:first-child .workflow-stage__rail { left: 50%; width: 50%; }
.workflow-stages li:last-child .workflow-stage__rail { width: 50%; }
.workflow-stages li:only-child .workflow-stage__rail { display: none; }

.workflow-stage__point {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 2px solid var(--ui-border-accented);
  border-radius: 999px;
  background: var(--ui-bg);
}

.workflow-stage__point::after {
  position: absolute;
  inset: -4px;
  border: 4px solid color-mix(in srgb, var(--ui-primary) 14%, transparent);
  border-radius: inherit;
  content: '';
  opacity: 0;
  transform: scale(0.82);
  transition:
    opacity 90ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1)),
    transform 120ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1));
}

.workflow-stage__point .iconify { width: 10px; height: 10px; }

.workflow-stage__label {
  max-width: 92px;
  font-size: 10px;
  line-height: 1.25;
}

.workflow-stages li.is-complete .workflow-stage__rail::after,
.workflow-stages li.is-current .workflow-stage__rail::after {
  opacity: 1;
  transform: scaleX(1);
  transition:
    opacity 150ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1)),
    transform 220ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1));
}

.workflow-stages li.is-complete .workflow-stage__point {
  border-color: var(--ui-success);
  background: var(--ui-success);
  color: var(--ui-bg);
}

.workflow-stages li.is-current {
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.workflow-stages li.is-current .workflow-stage__point {
  border-color: var(--ui-primary);
}

.workflow-stages li.is-current .workflow-stage__point::after {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity 150ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1)),
    transform 180ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1));
}

.workflow-check-enter-active {
  transition:
    opacity 150ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1)),
    transform 150ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1));
}

.workflow-check-leave-active {
  transition:
    opacity 90ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1)),
    transform 90ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1));
}

.workflow-check-enter-from,
.workflow-check-leave-to {
  opacity: 0;
  transform: scale(0.82);
}

.handoff-notice {
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--ui-info) 35%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-info) 7%, var(--ui-bg));
}

.handoff-notice__icon {
  width: 34px;
  height: 34px;
  background: color-mix(in srgb, var(--ui-info) 14%, var(--ui-bg));
  color: var(--ui-info);
}

.handoff-notice__copy {
  min-width: 0;
  flex: 1;
}

.handoff-notice__copy strong,
.handoff-notice__copy span {
  display: block;
}

.handoff-notice__copy strong {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.handoff-notice__copy span,
.handoff-notice__copy p {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.handoff-notice__copy p { margin: 7px 0 0; line-height: 1.4; }

.handoff-notice__actions {
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.process-card__footer {
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border-muted);
}

.process-card__status-field { width: min(240px, 100%); }

@media (max-width: 720px) {
  .process-card { padding: 16px; }
  .process-card__header { flex-wrap: wrap; }
  .process-card__header > :deep([data-slot="base"]) { margin-left: 50px; }
  .process-card__facts { flex-direction: column; }
  .handoff-notice { flex-wrap: wrap; }
  .handoff-notice__actions { width: 100%; justify-content: flex-start; padding-left: 46px; }
  .process-card__footer { align-items: stretch; flex-direction: column; }
  .process-card__status-field { width: 100%; }
  .process-card__footer > :deep(button) { justify-content: center; width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .process-card { transition: none; }

  .workflow-stage__rail::after,
  .workflow-stages li.is-complete .workflow-stage__rail::after,
  .workflow-stages li.is-current .workflow-stage__rail::after,
  .workflow-stage__point::after,
  .workflow-stages li.is-current .workflow-stage__point::after,
  .workflow-check-enter-active,
  .workflow-check-leave-active {
    transform: none;
    transition: opacity 120ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1));
  }

  .workflow-check-enter-from,
  .workflow-check-leave-to {
    opacity: 0;
    transform: none;
  }
}
</style>
