<script setup lang="ts">
interface RepeatableManagerItem {
  index: number
  label: string
  description: string
  filledCount: number
  fieldCount: number
  invalidCount: number
  removable: boolean
}

const props = withDefaults(defineProps<{
  groupId: string
  legend: string
  itemLabel: string
  items: RepeatableManagerItem[]
  activeIndex: number
  maxItems: number
  canAdd?: boolean
  readonly?: boolean
  description?: string
  addLabel?: string
  removeLabel?: string
  limitLabel?: string
}>(), {
  canAdd: false,
  readonly: false,
  description: 'Dodaj osoby lub elementy, których dane mają trafić do przygotowywanych dokumentów.',
  addLabel: undefined,
  removeLabel: undefined,
  limitLabel: undefined,
})

const emit = defineEmits<{
  select: [index: number]
  add: []
  remove: [index: number]
}>()

const normalizedId = computed(() => props.groupId.replace(/[^a-zA-Z0-9_-]/g, '-'))
const activeItem = computed(() => (
  props.items.find(item => item.index === props.activeIndex) ?? props.items[0]
))
const announcement = ref('')

watch(() => props.items.length, (count, previousCount) => {
  if (previousCount === undefined || count === previousCount) return
  announcement.value = count > previousCount
    ? `Dodano: ${props.itemLabel} ${count}.`
    : `Usunięto element. Pozostało: ${count}.`

  if (count < previousCount) {
    nextTick(() => {
      const index = activeItem.value?.index
      if (index !== undefined) document.getElementById(tabId(index))?.focus()
    })
  }
})

function tabId(index: number) {
  return `${normalizedId.value}-tab-${index}`
}

function panelId(index: number) {
  return `${normalizedId.value}-panel-${index}`
}

function addButtonLabel() {
  return props.addLabel || 'Dodaj pozycję'
}

function selectItem(index: number, focus = false) {
  emit('select', index)
  if (focus) {
    nextTick(() => document.getElementById(tabId(index))?.focus())
  }
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()

  const currentPosition = props.items.findIndex(item => item.index === index)
  if (currentPosition < 0) return
  let nextPosition = currentPosition
  if (event.key === 'ArrowRight') nextPosition = (currentPosition + 1) % props.items.length
  if (event.key === 'ArrowLeft') nextPosition = (currentPosition - 1 + props.items.length) % props.items.length
  if (event.key === 'Home') nextPosition = 0
  if (event.key === 'End') nextPosition = props.items.length - 1

  const nextItem = props.items[nextPosition]
  if (nextItem) selectItem(nextItem.index, true)
}
</script>

<template>
  <section class="repeatable-group" :aria-labelledby="`${normalizedId}-heading`">
    <header class="repeatable-group__heading">
      <div>
        <span>Dane powtarzalne</span>
        <h3 :id="`${normalizedId}-heading`">{{ legend }}</h3>
        <p>{{ description }}</p>
      </div>
      <strong>{{ items.length }} / {{ maxItems }}</strong>
    </header>

    <div class="repeatable-manager">
      <aside class="repeatable-manager__rail">
        <div class="repeatable-tabs" role="tablist" :aria-label="legend">
          <button
            v-for="item in items"
            :id="tabId(item.index)"
            :key="item.index"
            type="button"
            role="tab"
            class="repeatable-tab"
            :class="{ 'repeatable-tab--active': activeItem?.index === item.index }"
            :aria-selected="activeItem?.index === item.index"
            :aria-controls="panelId(item.index)"
            :tabindex="activeItem?.index === item.index ? 0 : -1"
            @click="selectItem(item.index)"
            @keydown="handleTabKeydown($event, item.index)"
          >
            <span class="repeatable-tab__index">{{ item.index + 1 }}</span>
            <span class="repeatable-tab__copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </span>
            <span
              class="repeatable-tab__status"
              :class="{
                'repeatable-tab__status--invalid': item.invalidCount > 0,
                'repeatable-tab__status--complete': item.fieldCount > 0 && item.filledCount === item.fieldCount && item.invalidCount === 0,
              }"
              :aria-label="item.invalidCount ? `${item.invalidCount} błędne pola` : `${item.filledCount} z ${item.fieldCount} pól uzupełnionych`"
            >
              {{ item.invalidCount ? `!${item.invalidCount}` : `${item.filledCount}/${item.fieldCount}` }}
            </span>
          </button>
        </div>

        <button
          v-if="!readonly && canAdd"
          type="button"
          class="repeatable-manager__add"
          @click="emit('add')"
        >
          <span aria-hidden="true">+</span>
          {{ addButtonLabel() }}
        </button>
        <small v-else-if="!readonly" class="repeatable-manager__limit">
          {{ limitLabel || `Ten zestaw dokumentów obsługuje maksymalnie ${maxItems} pozycji.` }}
        </small>
      </aside>

      <div
        v-for="item in items"
        v-show="activeItem?.index === item.index"
        :id="panelId(item.index)"
        :key="item.index"
        class="repeatable-manager__panel"
        role="tabpanel"
        :aria-labelledby="tabId(item.index)"
        :tabindex="activeItem?.index === item.index ? 0 : -1"
      >
        <div class="repeatable-manager__panel-heading">
          <div>
            <span>Pozycja {{ item.index + 1 }}</span>
            <strong>{{ item.label }}</strong>
          </div>
          <button
            v-if="!readonly && item.removable"
            type="button"
            class="repeatable-manager__remove"
            @click="emit('remove', item.index)"
          >
            {{ removeLabel || 'Usuń pozycję' }}
          </button>
        </div>
        <slot :item="item" />
      </div>
    </div>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<style scoped>
.repeatable-group { min-width: 0; margin: 0 0 32px; }
.repeatable-group__heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 13px; margin-bottom: 17px; border-bottom: 1px solid var(--border-default); }
.repeatable-group__heading > div { display: grid; gap: 4px; }
.repeatable-group__heading span { color: var(--mf-accent); font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.repeatable-group__heading h3 { margin: 0; font-family: var(--font-serif); font-size: 20px; font-weight: 400; }
.repeatable-group__heading p { margin: 0; color: var(--fg-tertiary); font-size: 11px; line-height: 1.45; }
.repeatable-group__heading > strong { flex: 0 0 auto; color: var(--fg-tertiary); font-family: var(--font-mono); font-size: 11px; }

.repeatable-manager { display: grid; grid-template-columns: 238px minmax(0, 1fr); gap: 14px; }
.repeatable-manager__rail { min-width: 0; align-self: start; padding: 8px; background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: var(--radius-lg); }
.repeatable-tabs { display: grid; gap: 6px; }
.repeatable-tab { width: 100%; min-height: 58px; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 9px; color: var(--fg-secondary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: var(--radius-md); font: inherit; cursor: pointer; }
.repeatable-tab:hover { color: var(--fg-primary); background: color-mix(in srgb, var(--bg-default) 68%, transparent); }
.repeatable-tab:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.repeatable-tab--active { color: var(--fg-primary); background: var(--bg-default); border-color: var(--border-default); box-shadow: var(--shadow-sm); }
.repeatable-tab__index { width: 30px; height: 30px; display: grid; place-items: center; color: var(--mf-accent); background: var(--mf-accent-soft); border-radius: 50%; font-family: var(--font-mono); font-size: 10px; font-weight: 700; }
.repeatable-tab__copy { min-width: 0; display: grid; gap: 2px; }
.repeatable-tab__copy strong,
.repeatable-tab__copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repeatable-tab__copy strong { font-size: 12px; }
.repeatable-tab__copy small { color: var(--fg-tertiary); font-size: 9px; }
.repeatable-tab__status { min-width: 34px; padding: 4px 5px; color: var(--fg-tertiary); background: var(--bg-muted); border-radius: 999px; font-family: var(--font-mono); font-size: 8px; text-align: center; }
.repeatable-tab__status--invalid { color: #b91c1c; background: #fef2f2; }
.repeatable-tab__status--complete { color: var(--mf-positive); background: color-mix(in srgb, var(--mf-positive) 10%, var(--bg-default)); }
.repeatable-manager__add { width: 100%; min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 8px; color: var(--mf-accent); background: var(--bg-default); border: 1px dashed color-mix(in srgb, var(--mf-accent) 45%, var(--border-default)); border-radius: var(--radius-md); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.repeatable-manager__add:hover { background: var(--mf-accent-soft); }
.repeatable-manager__add:focus-visible,
.repeatable-manager__remove:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.repeatable-manager__add > span { font-size: 17px; font-weight: 400; line-height: 1; }
.repeatable-manager__limit { display: block; padding: 9px 5px 3px; color: var(--fg-tertiary); font-size: 8px; line-height: 1.4; text-align: center; }

.repeatable-manager__panel { min-width: 0; padding: 19px; background: var(--bg-default); border: 1px solid var(--border-default); border-radius: var(--radius-lg); outline: none; }
.repeatable-manager__panel:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--mf-accent) 10%, transparent); }
.repeatable-manager__panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 14px; margin-bottom: 18px; border-bottom: 1px solid var(--border-default); }
.repeatable-manager__panel-heading > div { display: grid; gap: 2px; }
.repeatable-manager__panel-heading span { color: var(--fg-tertiary); font-family: var(--font-mono); font-size: 8px; text-transform: uppercase; }
.repeatable-manager__panel-heading strong { font-size: 13px; }
.repeatable-manager__remove { padding: 7px 9px; color: #b91c1c; background: transparent; border: 1px solid #fecaca; border-radius: var(--radius-md); font: inherit; font-size: 10px; cursor: pointer; }
.repeatable-manager__remove:hover { background: #fef2f2; }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 720px) {
  .repeatable-manager { grid-template-columns: 1fr; }
  .repeatable-manager__rail { overflow: hidden; }
  .repeatable-tabs { display: flex; overflow-x: auto; padding-bottom: 2px; scroll-snap-type: x proximity; }
  .repeatable-tab { min-width: 190px; flex: 0 0 auto; scroll-snap-align: start; }
  .repeatable-manager__add { min-width: 100%; }
}

@media (max-width: 520px) {
  .repeatable-group__heading,
  .repeatable-manager__panel-heading { align-items: stretch; flex-direction: column; gap: 10px; }
  .repeatable-manager__remove { width: 100%; min-height: 40px; }
  .repeatable-manager__panel { padding: 15px; }
}

@media (prefers-color-scheme: dark) {
  .repeatable-tab__status--invalid { color: #fecaca; background: #450a0a; }
  .repeatable-manager__remove { color: #fecaca; border-color: #7f1d1d; }
  .repeatable-manager__remove:hover { background: #450a0a; }
}
</style>
