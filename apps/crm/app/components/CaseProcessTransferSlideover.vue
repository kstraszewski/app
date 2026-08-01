<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { CaseItem } from '~/types/cases'

interface AssigneeRow {
  user_id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: 'expert' | 'admin'
  team_name?: string | null
  open_task_count?: number
}

interface AssigneesResponse {
  data: {
    members: AssigneeRow[]
  }
}

interface TransferForm {
  proposed_owner_user_id: string
  request_note: string
}

const props = defineProps<{
  open: boolean
  caseId: string
  caseTitle: string
  item: CaseItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'changed': []
}>()

const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const candidates = ref<AssigneeRow[]>([])
const loadingCandidates = ref(false)
const candidatesError = ref('')
const submitError = ref('')
const submitting = ref(false)
const idempotencyKey = ref('')
const form = reactive<TransferForm>({
  proposed_owner_user_id: '',
  request_note: '',
})

const candidateOptions = computed(() => candidates.value
  .filter(candidate => candidate.user_id !== props.item?.owner_user_id)
  .map(candidate => ({
    label: candidate.full_name || candidate.email,
    description: [candidate.team_name, candidate.open_task_count != null
      ? `${candidate.open_task_count} otwartych zadań`
      : null].filter(Boolean).join(' · '),
    value: candidate.user_id,
  })))

const selectedCandidate = computed(() => (
  candidates.value.find(candidate => candidate.user_id === form.proposed_owner_user_id) ?? null
))

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!submitting.value) emit('update:open', value)
  },
})

function freshIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function resetForm() {
  form.proposed_owner_user_id = ''
  form.request_note = ''
  submitError.value = ''
  candidatesError.value = ''
  idempotencyKey.value = freshIdempotencyKey()
}

function validateTransfer(state: Partial<TransferForm>): FormError[] {
  return state.proposed_owner_user_id
    ? []
    : [{ name: 'proposed_owner_user_id', message: 'Wybierz nowego opiekuna procesu.' }]
}

function errorMessage(caught: unknown) {
  const error = caught as { data?: { statusMessage?: string }, message?: string }
  return error.data?.statusMessage ?? error.message ?? 'Spróbuj ponownie za chwilę.'
}

async function loadCandidates() {
  if (!props.caseId || loadingCandidates.value) return
  loadingCandidates.value = true
  candidatesError.value = ''
  try {
    const response = await $fetch<AssigneesResponse>(
      crmApiPath(`/cases/${props.caseId}/tasks/assignees`),
    )
    candidates.value = response.data.members ?? []
  }
  catch (caught) {
    candidates.value = []
    candidatesError.value = errorMessage(caught)
  }
  finally {
    loadingCandidates.value = false
  }
}

async function submitTransfer(_event: FormSubmitEvent<TransferForm>) {
  if (!props.item || submitting.value) return
  submitting.value = true
  submitError.value = ''
  try {
    await $fetch(
      crmApiPath(`/cases/${props.caseId}/items/${props.item.id}/handoffs`),
      {
        method: 'POST',
        body: {
          proposed_owner_user_id: form.proposed_owner_user_id,
          request_note: form.request_note.trim() || null,
          idempotency_key: idempotencyKey.value || freshIdempotencyKey(),
        },
      },
    )
    toast.add({
      title: 'Wysłano prośbę o przejęcie procesu',
      description: selectedCandidate.value?.full_name || selectedCandidate.value?.email,
      color: 'success',
      icon: 'i-lucide-send',
    })
    emit('changed')
    emit('update:open', false)
  }
  catch (caught) {
    submitError.value = errorMessage(caught)
    toast.add({
      title: 'Nie udało się przekazać procesu',
      description: submitError.value,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    submitting.value = false
  }
}

watch(
  [() => props.open, () => props.item?.id],
  ([open]) => {
    if (!open) return
    resetForm()
    void loadCandidates()
  },
  { immediate: true },
)
</script>

<template>
  <USlideover
    v-model:open="openModel"
    title="Przekaż proces"
    :description="item ? `${item.title} · ${caseTitle}` : caseTitle"
    :dismissible="!submitting"
    :close="!submitting"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <UForm
        v-if="item"
        id="case-process-transfer-form"
        :state="form"
        :validate="validateTransfer"
        :validate-on="['blur', 'change']"
        class="transfer-form"
        @submit="submitTransfer"
      >
        <section class="transfer-context" aria-label="Przekazywany proces">
          <span aria-hidden="true"><UIcon name="i-lucide-workflow" /></span>
          <div>
            <small>{{ item.product_type?.name || 'Proces w sprawie' }}</small>
            <strong>{{ item.title }}</strong>
            <p>Obecny opiekun: {{ item.owner?.full_name || item.owner?.email || 'Nieprzypisany' }}</p>
          </div>
        </section>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się wysłać prośby"
          :description="submitError"
          role="alert"
        />

        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="Nowy opiekun musi przyjąć proces"
          description="Do czasu akceptacji bieżący opiekun pozostaje odpowiedzialny za proces. Przekazanie nie zmienia właściciela klienta ani całej sprawy."
        />

        <UFormField
          name="proposed_owner_user_id"
          label="Nowy opiekun procesu"
          description="Wybierz osobę, do której trafi prośba o przejęcie prowadzenia."
          required
        >
          <USelectMenu
            v-model="form.proposed_owner_user_id"
            class="w-full"
            :items="candidateOptions"
            value-key="value"
            label-key="label"
            :loading="loadingCandidates"
            :disabled="loadingCandidates || submitting"
            placeholder="Wybierz osobę z zespołu"
            searchable
          />
        </UFormField>

        <UAlert
          v-if="candidatesError"
          color="error"
          variant="subtle"
          title="Nie udało się pobrać zespołu"
          :description="candidatesError"
        >
          <template #actions>
            <UButton color="error" variant="soft" size="xs" @click="loadCandidates">
              Spróbuj ponownie
            </UButton>
          </template>
        </UAlert>

        <UFormField
          name="request_note"
          label="Wiadomość dla nowego opiekuna"
          hint="Opcjonalnie"
          description="Dodaj kontekst, którego nie widać bezpośrednio w danych procesu."
        >
          <UTextarea
            v-model="form.request_note"
            class="w-full"
            :rows="4"
            :maxlength="2000"
            autoresize
            placeholder="Np. klient oczekuje kontaktu po 16:00…"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="transfer-footer">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="submitting"
          @click="openModel = false"
        >
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="case-process-transfer-form"
          icon="i-lucide-send"
          :loading="submitting"
          :disabled="loadingCandidates || !candidateOptions.length"
        >
          Wyślij prośbę
        </UButton>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.transfer-form {
  display: grid;
  gap: 22px;
}

.transfer-context {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.transfer-context > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.transfer-context > div { min-width: 0; }
.transfer-context small,
.transfer-context strong { display: block; }
.transfer-context small { color: var(--ui-text-muted); font-size: 11px; }
.transfer-context strong { margin-top: 2px; color: var(--ui-text-highlighted); font-size: 14px; }
.transfer-context p { margin: 5px 0 0; color: var(--ui-text-muted); font-size: 12px; }

.transfer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

@media (max-width: 560px) {
  .transfer-footer > :deep(button) { flex: 1; justify-content: center; }
}
</style>
