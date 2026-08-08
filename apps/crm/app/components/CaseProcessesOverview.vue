<script setup lang="ts">
import type {
  CaseDetail,
  CaseItem,
  CaseItemHandoff,
  CaseItemHandoffAction,
} from '~/types/cases'

const props = defineProps<{
  caseData: CaseDetail
  currentUserId: string
}>()

const emit = defineEmits<{
  changed: []
}>()

const route = useRoute()
const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const transferOpen = ref(false)
const transferItemId = ref('')
const statusUpdatingItemId = ref('')
const handoffUpdatingId = ref('')

const transferItem = computed(() => (
  props.caseData.items.find(item => item.id === transferItemId.value) ?? null
))
const focusedProcessId = computed(() => {
  const value = Array.isArray(route.query.process) ? route.query.process[0] : route.query.process
  return typeof value === 'string' && props.caseData.items.some(item => item.id === value)
    ? value
    : ''
})

function errorMessage(caught: unknown) {
  const error = caught as { data?: { statusMessage?: string }, message?: string }
  return error.data?.statusMessage ?? error.message ?? 'Spróbuj ponownie za chwilę.'
}

function openTransfer(item: CaseItem) {
  transferItemId.value = item.id
  transferOpen.value = true
}

function statusLabel(item: CaseItem, statusCode: string) {
  return item.workflow?.statuses.find(status => status.code === statusCode)?.label
    ?? statusCode.replaceAll('_', ' ')
}

async function changeStatus(payload: { item: CaseItem, statusCode: string }) {
  if (statusUpdatingItemId.value) return
  statusUpdatingItemId.value = payload.item.id
  try {
    await $fetch(crmApiPath(`/items/${payload.item.id}/status`), {
      method: 'PATCH',
      body: {
        status_code: payload.statusCode,
        expected_updated_at: payload.item.updated_at,
      },
    })
    toast.add({
      title: 'Zmieniono etap procesu',
      description: `${payload.item.title} · ${statusLabel(payload.item, payload.statusCode)}`,
      color: 'success',
      icon: 'i-lucide-route',
    })
    emit('changed')
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się zmienić etapu',
      description: errorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    statusUpdatingItemId.value = ''
  }
}

async function resolveHandoff(payload: {
  item: CaseItem
  handoff: CaseItemHandoff
  action: CaseItemHandoffAction
}) {
  if (handoffUpdatingId.value) return
  handoffUpdatingId.value = payload.handoff.id
  try {
    await $fetch(
      crmApiPath(`/cases/${props.caseData.id}/items/${payload.item.id}/handoffs/${payload.handoff.id}`),
      {
        method: 'PATCH',
        body: { action: payload.action },
      },
    )
    const messages = {
      accept: 'Przyjęto prowadzenie procesu',
      reject: 'Odrzucono przekazanie procesu',
      cancel: 'Anulowano przekazanie procesu',
    }
    toast.add({
      title: messages[payload.action],
      description: payload.item.title,
      color: payload.action === 'accept' ? 'success' : 'neutral',
      icon: payload.action === 'accept' ? 'i-lucide-circle-check' : 'i-lucide-history',
    })
    emit('changed')
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się zapisać decyzji',
      description: errorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    handoffUpdatingId.value = ''
  }
}

function handleTransferChanged() {
  transferOpen.value = false
  emit('changed')
}

async function scrollToFocusedProcess() {
  if (!import.meta.client || !focusedProcessId.value) return
  await nextTick()
  window.requestAnimationFrame(() => {
    document.getElementById(`case-process-${focusedProcessId.value}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

watch(
  [focusedProcessId, () => props.caseData.items.map(item => item.id).join(',')],
  () => scrollToFocusedProcess(),
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <section class="case-processes" aria-labelledby="case-processes-title">
    <header class="case-processes__heading">
      <div>
        <p>Odpowiedzialność i przebieg</p>
        <h2 id="case-processes-title">Procesy w sprawie</h2>
        <span>Każdy proces ma własny etap, termin i opiekuna.</span>
      </div>
      <UBadge color="neutral" variant="subtle">
        {{ caseData.items.length }} {{ caseData.items.length === 1 ? 'proces' : 'procesów' }}
      </UBadge>
    </header>

    <div v-if="caseData.items.length" class="case-processes__grid">
      <CaseProcessCard
        v-for="item in caseData.items"
        :key="item.id"
        :item="item"
        :current-user-id="currentUserId"
        :case-owner-user-id="caseData.owner_user_id"
        :status-updating="statusUpdatingItemId === item.id"
        :handoff-updating="handoffUpdatingId === item.pending_handoff?.id"
        :focused="focusedProcessId === item.id"
        @change-status="changeStatus"
        @handoff="openTransfer"
        @resolve-handoff="resolveHandoff"
      />
    </div>

    <OeEmptyState
      v-else
      size="compact"
      align="start"
      icon="i-lucide-workflow"
      title="Nie uruchomiono jeszcze żadnego procesu"
      description="Proces pojawi się tutaj po dodaniu produktu lub rozpoczęciu obsługi wniosku."
    />

    <CaseProcessTransferSlideover
      v-if="transferItem"
      v-model:open="transferOpen"
      :case-id="caseData.id"
      :case-title="caseData.title"
      :item="transferItem"
      @changed="handleTransferChanged"
    />
  </section>
</template>

<style scoped>
.case-processes {
  display: grid;
  gap: 16px;
}

.case-processes__heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.case-processes__heading p {
  margin: 0 0 4px;
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.case-processes__heading h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 750;
}

.case-processes__heading span {
  display: block;
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.case-processes__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.case-processes__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-surface);
  color: var(--ui-text-muted);
}

.case-processes__empty > span {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-elevated);
}

.case-processes__empty strong { color: var(--ui-text-highlighted); font-size: 13px; }
.case-processes__empty p { margin: 3px 0 0; font-size: 12px; }

@media (max-width: 1120px) {
  .case-processes__grid { grid-template-columns: 1fr; }
}
</style>
