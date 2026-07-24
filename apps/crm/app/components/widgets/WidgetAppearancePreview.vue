<script setup lang="ts">
import type { BookingWidgetType } from '#shared/types/booking-calculators'
import { bookingWidgetTypeMeta } from '~/utils/booking-widgets'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string | null
  facilityName?: string
  widgetType: BookingWidgetType
  theme: 'light' | 'dark' | 'auto'
  accentColor?: string
  compact?: boolean
}>(), {
  subtitle: null,
  facilityName: 'Twoja placówka',
  accentColor: '#2563eb',
  compact: false,
})

const colorMode = useColorMode()
const isHydrated = ref(false)
const typeMeta = computed(() => bookingWidgetTypeMeta(props.widgetType))
const isDark = computed(() => (
  props.theme === 'dark'
  || (props.theme === 'auto' && isHydrated.value && colorMode.value === 'dark')
))
const eyebrow = computed(() => ({
  calendar: 'Rezerwacja online',
  mortgage_capacity: 'Kalkulator zdolności',
  mortgage_payment: 'Kalkulator raty',
})[props.widgetType])

onMounted(() => {
  isHydrated.value = true
})
</script>

<template>
  <div
    class="widget-preview"
    :class="{
      'widget-preview--dark': isDark,
      'widget-preview--compact': props.compact,
    }"
    :style="{ '--preview-accent': props.accentColor }"
  >
    <header class="widget-preview__header">
      <div class="widget-preview__brand">
        <img
          :src="isDark ? '/assets/logo-dark.svg' : '/assets/logo-light.svg'"
          alt=""
          class="widget-preview__mark"
        >
        <span>OpenExpert</span>
      </div>
      <p>{{ eyebrow }}</p>
      <h3>{{ props.title || typeMeta.defaultTitle }}</h3>
      <span v-if="props.subtitle">{{ props.subtitle }}</span>
      <div class="widget-preview__facility">
        <UIcon name="i-lucide-map-pin" />
        {{ props.facilityName }}
      </div>
    </header>

    <div class="widget-preview__body">
      <template v-if="props.widgetType === 'calendar'">
        <div class="widget-preview__field">
          <span>Rodzaj spotkania</span>
          <strong>Spotkanie z ekspertem</strong>
        </div>
        <div class="widget-preview__field">
          <span>Wybierz dzień</span>
          <div class="widget-preview__days">
            <b>24</b><b>25</b><b>26</b><b>27</b>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="widget-preview__result">
          <UIcon :name="typeMeta.icon" />
          <span>{{ props.widgetType === 'mortgage_capacity' ? 'Orientacyjna zdolność' : 'Szacowana rata' }}</span>
          <strong>{{ props.widgetType === 'mortgage_capacity' ? '648 000 zł' : '3 420 zł' }}</strong>
        </div>
        <div class="widget-preview__progress">
          <span />
          <span />
          <span />
        </div>
      </template>

      <div class="widget-preview__cta">
        {{ props.widgetType === 'calendar' ? 'Pokaż dostępne terminy' : 'Przejdź do rezerwacji' }}
        <UIcon name="i-lucide-arrow-right" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.widget-preview {
  --preview-surface: var(--ui-color-neutral-50);
  --preview-muted: var(--ui-color-neutral-100);
  --preview-border: var(--ui-color-neutral-200);
  --preview-text: var(--ui-color-neutral-950);
  --preview-subtle: var(--ui-color-neutral-500);
  overflow: hidden;
  border: 1px solid var(--preview-border);
  border-radius: 16px;
  background: var(--preview-surface);
  color: var(--preview-text);
  box-shadow: 0 18px 48px rgb(0 0 0 / 8%);
}

.widget-preview--dark {
  --preview-surface: var(--ui-color-neutral-950);
  --preview-muted: var(--ui-color-neutral-900);
  --preview-border: var(--ui-color-neutral-800);
  --preview-text: var(--ui-color-neutral-50);
  --preview-subtle: var(--ui-color-neutral-400);
}

.widget-preview__header {
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--preview-border);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--preview-accent) 20%, transparent), transparent 45%),
    var(--preview-surface);
}

.widget-preview__brand {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 28px;
  font-size: 11px;
  font-weight: 700;
}

.widget-preview__mark {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.widget-preview__header > p {
  margin: 0;
  color: var(--preview-accent);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.widget-preview__header h3 {
  margin: 7px 0 0;
  color: var(--preview-text);
  font-size: clamp(22px, 3vw, 30px);
  line-height: 1.12;
}

.widget-preview__header > span {
  display: block;
  margin-top: 8px;
  color: var(--preview-subtle);
  font-size: 11px;
  line-height: 1.5;
}

.widget-preview__facility {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  color: var(--preview-subtle);
  font-size: 10px;
}

.widget-preview__body {
  display: grid;
  gap: 14px;
  padding: 20px 24px 24px;
}

.widget-preview__field {
  display: grid;
  gap: 7px;
}

.widget-preview__field > span,
.widget-preview__result > span {
  color: var(--preview-subtle);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .03em;
  text-transform: uppercase;
}

.widget-preview__field > strong {
  padding: 11px 12px;
  border: 1px solid var(--preview-border);
  border-radius: 9px;
  background: var(--preview-muted);
  color: var(--preview-text);
  font-size: 11px;
}

.widget-preview__days {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
}

.widget-preview__days b {
  display: grid;
  min-height: 40px;
  place-items: center;
  border: 1px solid var(--preview-border);
  border-radius: 8px;
  color: var(--preview-subtle);
  font-size: 10px;
}

.widget-preview__days b:first-child {
  border-color: var(--preview-accent);
  background: color-mix(in srgb, var(--preview-accent) 12%, var(--preview-surface));
  color: var(--preview-accent);
}

.widget-preview__result {
  display: grid;
  justify-items: center;
  padding: 20px;
  border-radius: 12px;
  background: var(--preview-muted);
  text-align: center;
}

.widget-preview__result > svg {
  margin-bottom: 9px;
  color: var(--preview-accent);
  font-size: 22px;
}

.widget-preview__result strong {
  margin-top: 6px;
  color: var(--preview-text);
  font-size: 24px;
}

.widget-preview__progress {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}

.widget-preview__progress span {
  height: 3px;
  border-radius: 999px;
  background: var(--preview-border);
}

.widget-preview__progress span:first-child {
  background: var(--preview-accent);
}

.widget-preview__cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  border: 0;
  border-radius: 9px;
  background: var(--preview-accent);
  color: var(--ui-color-neutral-50);
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
}

.widget-preview--compact .widget-preview__header {
  padding: 18px;
}

.widget-preview--compact .widget-preview__brand {
  margin-bottom: 18px;
}

.widget-preview--compact .widget-preview__body {
  padding: 16px 18px 18px;
}
</style>
