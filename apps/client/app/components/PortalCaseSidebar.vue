<script setup lang="ts">
import type { PortalCase, PortalCaseStep } from '~/types/portal'
import { PORTAL_TIME_ZONE } from '~/utils/portal-date'

const props = defineProps<{
  caseData: PortalCase
  mobile?: boolean
  preview?: boolean
}>()

const defaultSteps: PortalCaseStep[] = [
  { id: 'scope', label: 'Zakres sprawy', status: 'completed' },
  { id: 'intake', label: 'Pytania wstępne', status: 'completed' },
  { id: 'documents', label: 'Dokumenty', status: 'current' },
  { id: 'forms', label: 'Formularze bankowe', status: 'waiting' },
  { id: 'package', label: 'Paczka ZIP', status: 'waiting' },
]

const steps = computed(() => props.caseData.steps?.length
  ? props.caseData.steps
  : defaultSteps)

const dateLabel = computed(() => new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: PORTAL_TIME_ZONE,
}).format(new Date(props.caseData.openedAt)))
</script>

<template>
  <aside class="case-sidebar" :class="{ 'case-sidebar--mobile': mobile }">
    <NuxtLink v-if="!mobile" :to="preview ? '/preview' : '/'" class="case-sidebar__back">
      <UIcon name="i-lucide-arrow-left" />
      Wróć do „Co teraz”
    </NuxtLink>

    <div class="case-sidebar__eyebrow">AKTYWNA SPRAWA</div>
    <h1>{{ caseData.title }}</h1>
    <p class="case-sidebar__subtitle">
      {{ caseData.subtitle || 'Kompleksowe wsparcie eksperta na każdym etapie sprawy.' }}
    </p>

    <dl class="case-sidebar__meta">
      <div>
        <dt><UIcon name="i-lucide-calendar-days" /> Data utworzenia</dt>
        <dd>{{ dateLabel }}</dd>
      </div>
      <div>
        <dt><UIcon name="i-lucide-user-round" /> Twój ekspert</dt>
        <dd>{{ caseData.expert.name }}</dd>
      </div>
      <div v-if="caseData.location">
        <dt><UIcon name="i-lucide-map-pin" /> Lokalizacja</dt>
        <dd>{{ caseData.location }}</dd>
      </div>
      <div v-if="caseData.caseNumber">
        <dt><UIcon name="i-lucide-tag" /> Numer sprawy</dt>
        <dd>{{ caseData.caseNumber }}</dd>
      </div>
    </dl>

    <div class="case-sidebar__divider" />

    <section class="case-progress" aria-labelledby="case-progress-title">
      <h2 id="case-progress-title">POSTĘP SPRAWY</h2>
      <ol>
        <li
          v-for="(step, index) in steps"
          :key="step.id"
          :class="`is-${step.status}`"
        >
          <span class="case-progress__rail" aria-hidden="true">
            <span class="case-progress__dot">
              <UIcon v-if="step.status === 'completed'" name="i-lucide-check" />
              <template v-else>{{ index + 1 }}</template>
            </span>
          </span>
          <span class="case-progress__copy">
            <strong>{{ step.label }}</strong>
            <small>
              {{ step.status === 'completed'
                ? 'Ukończono'
                : step.status === 'current' ? 'W trakcie' : 'Oczekuje' }}
            </small>
          </span>
        </li>
      </ol>
    </section>
  </aside>
</template>

<style scoped>
.case-sidebar {
  width: var(--portal-sidebar-width);
  min-height: calc(100dvh - var(--portal-header-height));
  padding: 38px 38px 34px;
  border-right: 1px solid var(--portal-line);
  background: #fff;
}

.case-sidebar__back {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 35px;
  color: var(--ui-text-muted);
  font-size: 14px;
  text-decoration: none;
}

.case-sidebar__back:hover {
  color: var(--ui-text-highlighted);
}

.case-sidebar__back svg {
  width: 18px;
  height: 18px;
}

.case-sidebar__eyebrow,
.case-progress h2 {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.12em;
}

.case-sidebar h1 {
  max-width: 310px;
  margin: 12px 0 9px;
  font-size: 30px;
  font-weight: 400;
  line-height: 1.28;
}

.case-sidebar__subtitle {
  max-width: 285px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.55;
}

.case-sidebar__meta {
  display: grid;
  gap: 18px;
  margin: 29px 0 0;
}

.case-sidebar__meta > div {
  padding-left: 32px;
}

.case-sidebar__meta dt {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 18px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.case-sidebar__meta dt svg {
  position: absolute;
  left: -31px;
  width: 18px;
  height: 18px;
}

.case-sidebar__meta dd {
  margin: 2px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  line-height: 1.35;
}

.case-sidebar__divider {
  width: 264px;
  max-width: 100%;
  height: 1px;
  margin: 29px 0 27px;
  background: var(--portal-line);
}

.case-progress h2 {
  margin: 0 0 14px;
}

.case-progress ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.case-progress li {
  position: relative;
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 18px;
  min-height: 64px;
}

.case-progress li:not(:last-child)::after {
  position: absolute;
  top: 30px;
  bottom: -1px;
  left: 16px;
  width: 1px;
  background: var(--ui-border-accented);
  content: "";
}

.case-progress li.is-completed:not(:last-child)::after {
  background: var(--ui-color-success-600);
}

.case-progress__dot {
  position: relative;
  z-index: 1;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-toned);
  font-size: 12px;
  font-weight: 600;
}

.is-completed .case-progress__dot {
  background: var(--ui-color-success-600);
  color: #fff;
}

.is-current .case-progress__dot {
  background: #000;
  color: #fff;
}

.case-progress__dot svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.3;
}

.case-progress__copy {
  display: grid;
  align-content: start;
  gap: 1px;
  padding-top: 3px;
}

.case-progress__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 500;
}

.case-progress__copy small {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.case-sidebar--mobile {
  width: 100%;
  min-height: 0;
  padding: 22px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
}

@media (max-width: 1100px) {
  .case-sidebar:not(.case-sidebar--mobile) {
    width: 330px;
    padding-inline: 28px;
  }
}
</style>
