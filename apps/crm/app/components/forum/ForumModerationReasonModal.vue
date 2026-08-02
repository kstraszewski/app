<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  targetLabel: string
  busy?: boolean
  error?: string
}>(), {
  busy: false,
  error: '',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [reason: string]
}>()

const openModel = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})
const reason = ref('')
const validationError = ref('')

watch(() => props.open, (open) => {
  if (!open) return
  reason.value = ''
  validationError.value = ''
})

function submitReason(): void {
  if (props.busy) return
  const normalizedReason = reason.value.trim()
  if (normalizedReason.length < 5) {
    validationError.value = 'Podaj konkretny powód — co najmniej 5 znaków.'
    return
  }
  if (normalizedReason.length > 1_000) {
    validationError.value = 'Powód może mieć maksymalnie 1 000 znaków.'
    return
  }
  validationError.value = ''
  emit('confirm', normalizedReason)
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="`Ukryj ${targetLabel}`"
    description="Ukryta treść przestanie być widoczna dla członków organizacji. Moderatorzy nadal będą mogli ją sprawdzić i przywrócić."
    :dismissible="!busy"
    :close="busy ? false : undefined"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <form id="forum-moderation-reason-form" class="forum-moderation-reason" @submit.prevent="submitReason">
        <UAlert
          v-if="error"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się ukryć treści"
          :description="error"
        />
        <UFormField
          name="moderation-reason"
          label="Powód ukrycia"
          description="Powód trafia do historii moderacji i pomaga innym moderatorom zrozumieć decyzję."
          :hint="`${reason.length} / 1 000`"
          :error="validationError || undefined"
          required
        >
          <UTextarea
            v-model="reason"
            class="w-full"
            autoresize
            autofocus
            :rows="4"
            :maxrows="8"
            :maxlength="1000"
            :disabled="busy"
            placeholder="Np. wpis zawiera dane osobowe klienta…"
          />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="busy"
        @click="openModel = false"
      >
        Anuluj
      </UButton>
      <UButton
        type="submit"
        form="forum-moderation-reason-form"
        color="error"
        icon="i-lucide-eye-off"
        :loading="busy"
        :disabled="reason.trim().length < 5"
      >
        Ukryj treść
      </UButton>
    </template>
  </UModal>
</template>

<style scoped>
.forum-moderation-reason {
  display: grid;
  gap: 16px;
}
</style>
