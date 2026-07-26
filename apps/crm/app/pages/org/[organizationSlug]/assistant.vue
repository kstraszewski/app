<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Agent AI — OpenExpert CRM' })

const route = useRoute()
const historyOpen = ref(false)
const assistantStatus = ref('checking')
const assistant = ref<{ newConversation: () => Promise<void> | void } | null>(null)
const showDemo = computed(() => import.meta.dev && route.query.preview === 'tool-run')

const statusLabel = computed(() => {
  if (showDemo.value) return 'Pracuje'
  if (assistantStatus.value === 'checking') return 'Sprawdzam połączenie'
  if (assistantStatus.value === 'unavailable') return 'Model niedostępny'
  if (assistantStatus.value === 'waiting') return 'Czeka na decyzję'
  if (assistantStatus.value === 'authorization') return 'Wymaga połączenia'
  if (assistantStatus.value === 'submitted') return 'Uruchamia zadanie'
  if (assistantStatus.value === 'streaming') return 'Pracuje'
  if (assistantStatus.value === 'error') return 'Wymaga uwagi'
  return 'Gotowy'
})

const statusTone = computed(() => {
  if (assistantStatus.value === 'error' || assistantStatus.value === 'unavailable') return 'error'
  if (assistantStatus.value === 'waiting' || assistantStatus.value === 'authorization') return 'warning'
  if (showDemo.value || assistantStatus.value === 'submitted' || assistantStatus.value === 'streaming') return 'success'
  return 'neutral'
})

async function startNewTask() {
  await assistant.value?.newConversation()
}

function openHistory() {
  historyOpen.value = true
}
</script>

<template>
  <CrmShell class="assistant-page-shell" title="Agent AI">
    <template #meta>
      <div class="assistant-page__meta">
        <span class="assistant-page__status" :class="`assistant-page__status--${statusTone}`">
          <span aria-hidden="true" />
          {{ statusLabel }}
        </span>
        <span aria-hidden="true">·</span>
        <span>{{ showDemo ? 'Sprawa: Anna Kowalska' : 'Kontekst: aktywna organizacja' }}</span>
        <span aria-hidden="true">·</span>
        <span class="assistant-page__model">Gemini 3.5 Flash-Lite</span>
      </div>
    </template>

    <template #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-history"
        label="Historia zadań"
        @click="openHistory"
      />
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-plus-circle"
        label="Nowe zadanie"
        @click="startNewTask"
      />
    </template>

    <CrmEveAssistant
      ref="assistant"
      mode="page"
      :demo="showDemo"
      @status-change="assistantStatus = $event"
    />

    <USlideover
      v-model:open="historyOpen"
      title="Historia zadań"
      description="Wróć do ostatnich rozmów i zadań agenta."
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <div class="assistant-history">
          <button v-if="showDemo" type="button" class="assistant-history__item" @click="historyOpen = false">
            <span class="assistant-history__icon"><UIcon name="i-lucide-list-checks" /></span>
            <span>
              <strong>Gotowość sprawy Anny Kowalskiej</strong>
              <small>Aktywne · przed chwilą</small>
            </span>
            <UIcon name="i-lucide-chevron-right" />
          </button>

          <div v-else class="assistant-history__empty">
            <UIcon name="i-lucide-history" />
            <strong>Brak zapisanych zadań</strong>
            <p>Historia pojawi się po rozpoczęciu pierwszej rozmowy z agentem.</p>
          </div>

          <UButton
            block
            color="neutral"
            icon="i-lucide-plus"
            label="Rozpocznij nowe zadanie"
            @click="historyOpen = false; startNewTask()"
          />
        </div>
      </template>
    </USlideover>
  </CrmShell>
</template>

<style scoped>
.assistant-page-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}

.assistant-page-shell :deep(.crm-page-header) {
  flex: 0 0 auto;
  align-items: center;
  min-height: 76px;
  margin-bottom: 0;
  padding-bottom: 18px;
}

.assistant-page-shell :deep(.crm-page-header h1) {
  margin-top: 0;
  font-size: 32px;
  font-weight: 420;
}

.assistant-page-shell :deep(.crm-page-header__meta) { margin-top: 7px; }

.assistant-page__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.assistant-page__status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-weight: 550;
}

.assistant-page__status > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-text-dimmed);
}

.assistant-page__status--success { color: var(--ui-success); }
.assistant-page__status--success > span { background: var(--ui-success); }
.assistant-page__status--warning { color: var(--ui-warning); }
.assistant-page__status--warning > span { background: var(--ui-warning); }
.assistant-page__status--error { color: var(--ui-error); }
.assistant-page__status--error > span { background: var(--ui-error); }
.assistant-page__model { color: var(--ui-text-dimmed); }

.assistant-page-shell :deep(.crm-eve-assistant--page) {
  min-height: 0;
  flex: 1;
}

.assistant-page-shell :deep(.crm-eve-assistant--page > .assistant-chat) { height: 100%; }

.assistant-history {
  display: grid;
  gap: 14px;
}

.assistant-history__item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 11px;
  min-height: 66px;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
}

.assistant-history__item:hover { background: var(--ui-bg-muted); }

.assistant-history__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.assistant-history__item > span:nth-child(2) { display: grid; }
.assistant-history__item strong { color: var(--ui-text-highlighted); font-size: 13px; }
.assistant-history__item small { color: var(--ui-text-muted); font-size: 11px; }

.assistant-history__empty {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 36px 18px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-surface);
  color: var(--ui-text-muted);
  text-align: center;
}

.assistant-history__empty > :first-child { font-size: 24px; }
.assistant-history__empty strong { color: var(--ui-text-highlighted); font-size: 14px; }
.assistant-history__empty p { max-width: 280px; margin: 0; font-size: 12px; line-height: 1.5; }

@media (max-width: 900px) {
  .assistant-page-shell :deep(.crm-page-header) { align-items: stretch; }
  .assistant-page-shell :deep(.crm-page-header__actions) { align-items: center; }
  .assistant-page-shell :deep(.crm-eve-assistant--page) { flex: 1 1 auto; }
}

@media (max-width: 640px) {
  .assistant-page-shell :deep(.crm-page-header h1) { font-size: 28px; }
  .assistant-page__model { display: none; }
  .assistant-page-shell :deep(.crm-page-header__actions > *) {
    flex: 1 1 150px;
    min-height: 44px;
  }
}
</style>
