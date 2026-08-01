<script setup lang="ts">
interface ProcessUser {
  id: string
  email: string
  full_name: string | null
}

interface ProcessSummary {
  id: string
  case_id: string
  title: string
  status_code: string
  expected_close_date: string | null
  updated_at: string
  product_type: {
    domain: string
    code: string
    name: string
  } | null
  case: {
    id: string
    title: string
  } | null
}

interface PendingProcessHandoff {
  id: string
  request_note: string | null
  requested_at: string
  requested_by: ProcessUser | null
  process: ProcessSummary
}

interface ProcessInboxResponse {
  data: {
    pending: PendingProcessHandoff[]
    owned: ProcessSummary[]
  }
}

const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const emptyInbox = (): ProcessInboxResponse => ({ data: { pending: [], owned: [] } })
const { data, status, error, refresh } = await useAsyncData(
  `dashboard-process-inbox-${organizationSlug.value}`,
  () => requestFetch<ProcessInboxResponse>(crmApiPath('/processes/inbox')),
  { default: emptyInbox },
)

const hasProcesses = computed(() => Boolean(data.value.data.pending.length || data.value.data.owned.length))

function userLabel(user: ProcessUser | null) {
  return user?.full_name || user?.email || 'Członek zespołu'
}

function processPath(process: ProcessSummary) {
  return orgPath(`/cases/${process.case_id}?view=overview&process=${process.id}`)
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ')
}
</script>

<template>
  <section class="process-inbox dashboard-block" aria-labelledby="process-inbox-title">
    <header class="process-inbox__header">
      <div>
        <span>Twoja odpowiedzialność</span>
        <h2 id="process-inbox-title">Procesy klientów</h2>
        <p>Przekazania do przyjęcia i procesy, które obecnie prowadzisz.</p>
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        aria-label="Odśwież procesy"
        @click="refresh()"
      />
    </header>

    <UAlert
      v-if="error"
      color="warning"
      variant="subtle"
      icon="i-lucide-workflow"
      title="Nie udało się pobrać procesów"
      description="Odśwież sekcję i spróbuj ponownie."
    />

    <div v-else-if="status === 'pending' && !hasProcesses" class="process-inbox__loading">
      <USkeleton v-for="index in 3" :key="index" class="h-24 w-full" />
    </div>

    <div v-else-if="hasProcesses" class="process-inbox__columns">
      <div class="process-inbox__column">
        <div class="process-inbox__title">
          <span class="process-inbox__icon process-inbox__icon--pending">
            <UIcon name="i-lucide-user-round-check" />
          </span>
          <div>
            <h3>Do przyjęcia</h3>
            <p>{{ data.data.pending.length }} oczekujących</p>
          </div>
        </div>

        <div v-if="data.data.pending.length" class="process-inbox__list">
          <NuxtLink
            v-for="handoff in data.data.pending"
            :key="handoff.id"
            :to="processPath(handoff.process)"
            class="process-inbox__row"
          >
            <span>
              <strong>{{ handoff.process.title }}</strong>
              <small>{{ handoff.process.case?.title || 'Sprawa klienta' }} · od {{ userLabel(handoff.requested_by) }}</small>
            </span>
            <UBadge color="warning" variant="subtle">Oczekuje</UBadge>
            <UIcon name="i-lucide-chevron-right" />
          </NuxtLink>
        </div>
        <p v-else class="process-inbox__empty">Nie masz nowych przekazań.</p>
      </div>

      <div class="process-inbox__column">
        <div class="process-inbox__title">
          <span class="process-inbox__icon">
            <UIcon name="i-lucide-route" />
          </span>
          <div>
            <h3>Prowadzone przez Ciebie</h3>
            <p>{{ data.data.owned.length }} aktywnych</p>
          </div>
        </div>

        <div v-if="data.data.owned.length" class="process-inbox__list">
          <NuxtLink
            v-for="process in data.data.owned"
            :key="process.id"
            :to="processPath(process)"
            class="process-inbox__row"
          >
            <span>
              <strong>{{ process.title }}</strong>
              <small>{{ process.case?.title || 'Sprawa klienta' }} · {{ process.product_type?.name || 'Proces' }}</small>
            </span>
            <UBadge color="neutral" variant="subtle" class="capitalize">{{ statusLabel(process.status_code) }}</UBadge>
            <UIcon name="i-lucide-chevron-right" />
          </NuxtLink>
        </div>
        <p v-else class="process-inbox__empty">Nie prowadzisz jeszcze żadnego procesu.</p>
      </div>
    </div>

    <div v-else class="process-inbox__empty-state">
      <UIcon name="i-lucide-git-pull-request-arrow" />
      <div>
        <strong>Brak procesów do obsługi</strong>
        <span>Odśwież sekcję, aby sprawdzić nowe przekazania od opiekuna sprawy.</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.process-inbox {
  display: grid;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-emphasis);
  background: var(--ui-bg);
}

.process-inbox__header,
.process-inbox__title,
.process-inbox__row,
.process-inbox__empty-state {
  display: flex;
  align-items: center;
}

.process-inbox__header {
  justify-content: space-between;
  gap: 16px;
}

.process-inbox__header span,
.process-inbox__header h2,
.process-inbox__header p,
.process-inbox__title h3,
.process-inbox__title p,
.process-inbox__empty {
  margin: 0;
}

.process-inbox__header span {
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.process-inbox__header h2 {
  margin-top: 3px;
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.process-inbox__header p,
.process-inbox__title p,
.process-inbox__row small,
.process-inbox__empty,
.process-inbox__empty-state span {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.process-inbox__columns,
.process-inbox__loading {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.process-inbox__column {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.process-inbox__title {
  gap: 10px;
  margin-bottom: 12px;
}

.process-inbox__title h3 {
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.process-inbox__icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-accented);
  color: var(--ui-text-highlighted);
}

.process-inbox__icon--pending {
  background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg));
  color: var(--ui-warning);
}

.process-inbox__list {
  display: grid;
  gap: 8px;
}

.process-inbox__row {
  min-width: 0;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
  color: inherit;
  text-decoration: none;
  transition: border-color 150ms ease, transform 150ms ease;
}

.process-inbox__row:hover {
  border-color: var(--ui-border-accented);
  transform: translateY(-1px);
}

.process-inbox__row > span:first-child {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.process-inbox__row strong,
.process-inbox__row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-inbox__row strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.process-inbox__row > :deep(svg) {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
}

.process-inbox__empty {
  padding: 12px 2px 2px;
}

.process-inbox__empty-state {
  min-height: 92px;
  justify-content: center;
  gap: 12px;
  border: 1px dashed var(--ui-border);
  border-radius: var(--oe-radius-surface);
  text-align: left;
}

.process-inbox__empty-state > :deep(svg) {
  width: 24px;
  height: 24px;
  color: var(--ui-text-muted);
}

.process-inbox__empty-state div {
  display: grid;
  gap: 3px;
}

@media (max-width: 900px) {
  .process-inbox__columns,
  .process-inbox__loading {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
