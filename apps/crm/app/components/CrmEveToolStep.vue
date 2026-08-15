<script setup lang="ts">
import type { InputResponse } from 'eve/client'
import type { EveDynamicToolPart } from 'eve/vue'
import {
  eveToolDefinition,
  eveToolInputSummary,
  eveToolIsLoading,
  eveToolIsOpenByDefault,
  eveToolOutputSummary,
  eveToolStatus,
  eveToolTitle,
} from '~/utils/eve-tool-presentation'

const props = withDefaults(defineProps<{
  autoSubmit?: boolean
  part: EveDynamicToolPart
  position: number
  response?: InputResponse
}>(), {
  autoSubmit: false,
  response: undefined,
})

const emit = defineEmits<{
  select: [response: InputResponse]
  submit: [response: InputResponse]
}>()

const open = ref(eveToolIsOpenByDefault(props.part))
const freeform = ref('')
const definition = computed(() => eveToolDefinition(props.part.toolName))
const status = computed(() => eveToolStatus(props.part))
const title = computed(() => eveToolTitle(props.part))
const loading = computed(() => eveToolIsLoading(props.part))
const inputSummary = computed(() => eveToolInputSummary(props.part))
const outputSummary = computed(() => eveToolOutputSummary(props.part))
const request = computed(() => (
  props.part.state === 'approval-requested'
    ? props.part.toolMetadata?.eve?.inputRequest
    : undefined
))
const options = computed(() => request.value?.options ?? [])
const selectedOptionId = computed(() => props.response?.optionId)
const isPending = computed(() => props.part.state === 'approval-requested')
const canSendFreeform = computed(() => Boolean(
  request.value
  && (request.value.display === 'text' || request.value.allowFreeform)
  && freeform.value.trim(),
))

watch(() => props.part.state, () => {
  if (eveToolIsOpenByDefault(props.part)) open.value = true
})

function chooseOption(optionId: string) {
  const pendingRequest = request.value
  if (!pendingRequest) return
  const response = { requestId: pendingRequest.requestId, optionId }
  if (props.autoSubmit) emit('submit', response)
  else emit('select', response)
}

function sendFreeform() {
  const pendingRequest = request.value
  const text = freeform.value.trim()
  if (!pendingRequest || !text) return
  const response = { requestId: pendingRequest.requestId, text }
  if (props.autoSubmit) emit('submit', response)
  else emit('select', response)
}

function optionColor(style: 'danger' | 'default' | 'primary' | undefined) {
  if (style === 'danger') return 'error' as const
  if (style === 'primary') return 'success' as const
  return 'neutral' as const
}

function optionVariant(style: 'danger' | 'default' | 'primary' | undefined) {
  return style === 'primary' ? 'solid' as const : 'outline' as const
}
</script>

<template>
  <li
    class="eve-tool-step"
    :class="[
      `eve-tool-step--${status.tone}`,
      { 'eve-tool-step--loading': loading },
    ]"
    :aria-current="loading ? 'step' : undefined"
  >
    <span class="eve-tool-step__marker" aria-hidden="true">
      <UIcon :name="status.icon" :class="{ 'eve-tool-step__spinner': loading }" />
    </span>

    <UCollapsible v-model:open="open" class="eve-tool-step__collapsible">
      <button type="button" class="eve-tool-step__trigger">
        <span class="eve-tool-step__heading">
          <strong>{{ position }}. {{ title }}</strong>
          <small>{{ definition.source }}</small>
        </span>
        <span class="eve-tool-step__state" :class="`eve-tool-step__state--${status.tone}`">
          <UIcon :name="status.icon" :class="{ 'eve-tool-step__spinner': loading }" />
          {{ status.label }}
        </span>
        <UIcon
          name="i-lucide-chevron-down"
          class="eve-tool-step__chevron"
          :class="{ 'eve-tool-step__chevron--open': open }"
        />
      </button>

      <template #content>
        <div class="eve-tool-step__body">
          <div class="eve-tool-step__tool-summary">
            <span class="eve-tool-step__tool-icon" aria-hidden="true">
              <UIcon :name="definition.icon" />
            </span>
            <div>
              <span>Źródło: {{ definition.source }}</span>
              <p>{{ outputSummary ?? inputSummary }}</p>
            </div>
          </div>

          <UProgress
            v-if="loading"
            class="eve-tool-step__progress"
            color="success"
            size="xs"
            animation="carousel"
            aria-label="Działanie w toku"
          />

          <section
            v-if="isPending && request"
            class="eve-tool-step__approval"
            aria-label="Decyzja wymagana przez agenta"
          >
            <div class="eve-tool-step__approval-copy">
              <div class="eve-tool-step__approval-title">
                <UIcon name="i-lucide-shield-alert" />
                <strong>{{ request.prompt }}</strong>
              </div>
              <p>{{ inputSummary }}</p>
            </div>

            <div v-if="options.length" class="eve-tool-step__approval-actions">
              <UButton
                v-for="option in options"
                :key="option.id"
                :color="optionColor(option.style)"
                :variant="selectedOptionId === option.id ? 'solid' : optionVariant(option.style)"
                :icon="option.id === 'approve' ? 'i-lucide-check' : option.id === 'deny' ? 'i-lucide-x' : undefined"
                :label="option.label"
                @click.stop="chooseOption(option.id)"
              />
            </div>

            <form
              v-if="request.display === 'text' || request.allowFreeform"
              class="eve-tool-step__freeform"
              @submit.prevent="sendFreeform"
            >
              <UInput
                v-model="freeform"
                class="w-full"
                :placeholder="request.display === 'text' ? 'Wpisz odpowiedź…' : 'Lub wpisz własną odpowiedź…'"
                aria-label="Odpowiedź dla agenta"
              />
              <UButton
                type="submit"
                color="neutral"
                variant="outline"
                label="Wybierz"
                :disabled="!canSendFreeform"
              />
            </form>
          </section>
        </div>
      </template>
    </UCollapsible>
  </li>
</template>

<style scoped>
.eve-tool-step {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 16px;
  min-width: 0;
}

.eve-tool-step__marker {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
  font-size: 15px;
}

.eve-tool-step--success .eve-tool-step__marker {
  border-color: color-mix(in srgb, var(--ui-success) 65%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-success) 13%, var(--ui-bg));
  color: var(--ui-success);
}

.eve-tool-step--warning .eve-tool-step__marker {
  border-color: color-mix(in srgb, var(--ui-warning) 65%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-warning) 10%, var(--ui-bg));
  color: var(--ui-warning);
}

.eve-tool-step--error .eve-tool-step__marker {
  border-color: color-mix(in srgb, var(--ui-error) 65%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-error) 10%, var(--ui-bg));
  color: var(--ui-error);
}

.eve-tool-step__collapsible {
  min-width: 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.eve-tool-step__trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 44px;
  padding: 0 0 11px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.eve-tool-step__heading {
  display: grid;
  min-width: 0;
}

.eve-tool-step__heading strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eve-tool-step__heading small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.eve-tool-step__state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
}

.eve-tool-step__state--success { color: var(--ui-success); }
.eve-tool-step__state--warning { color: var(--ui-warning); }
.eve-tool-step__state--error { color: var(--ui-error); }

.eve-tool-step__chevron {
  color: var(--ui-text-dimmed);
  transition: transform var(--oe-motion-base);
}

.eve-tool-step__chevron--open { transform: rotate(180deg); }

.eve-tool-step__body {
  display: grid;
  gap: 14px;
  margin-bottom: 14px;
  padding: 14px 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-bg-muted) 76%, var(--ui-bg));
}

.eve-tool-step__tool-summary {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.eve-tool-step__tool-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
}

.eve-tool-step__tool-summary span {
  color: var(--ui-text-toned);
  font-size: 12px;
  font-weight: 600;
}

.eve-tool-step__tool-summary p {
  min-width: 0;
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.eve-tool-step__progress { width: 100%; }

.eve-tool-step__approval {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border-muted);
}

.eve-tool-step__approval-copy {
  min-width: 0;
}

.eve-tool-step__approval-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-highlighted);
}

.eve-tool-step__approval-title > :first-child { color: var(--ui-warning); }

.eve-tool-step__approval-title strong {
  font-size: 15px;
  font-weight: 600;
}

.eve-tool-step__approval-copy p {
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.eve-tool-step__approval-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.eve-tool-step__freeform {
  display: flex;
  grid-column: 1 / -1;
  gap: 8px;
  width: 100%;
}

.eve-tool-step__spinner { animation: eve-tool-spin 1s linear infinite; }

@keyframes eve-tool-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 720px) {
  .eve-tool-step {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 10px;
  }

  .eve-tool-step__marker {
    width: 28px;
    height: 28px;
  }

  .eve-tool-step__trigger {
    grid-template-columns: minmax(0, 1fr) 18px;
    gap: 8px;
  }

  .eve-tool-step__state {
    grid-column: 1;
    justify-self: start;
    margin-top: 2px;
  }

  .eve-tool-step__chevron {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  .eve-tool-step__approval {
    align-items: stretch;
    flex-direction: column;
  }

  .eve-tool-step__approval-actions :deep(button) { flex: 1 1 140px; }
  .eve-tool-step__freeform { flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .eve-tool-step__spinner { animation: none; }
}
</style>
