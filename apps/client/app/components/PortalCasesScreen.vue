<script setup lang="ts">
import type { PortalPayload } from '~/types/portal'
import { isCompletedPortalCase } from '~/utils/portal-cases'

const props = withDefaults(defineProps<{
  payload: PortalPayload
  preview?: boolean
}>(), {
  preview: false,
})

const activeCases = computed(() => props.payload.cases.filter(item => !isCompletedPortalCase(item)))
const completedCases = computed(() => props.payload.cases.filter(isCompletedPortalCase))
const homeTo = computed(() => props.preview ? '/preview' : '/')
</script>

<template>
  <div class="portal-cases-screen">
    <PortalHeader
      :user-name="payload.user.name"
      :user-email="payload.user.email"
      :preview="preview"
    />

    <main class="portal-cases-screen__main">
      <NuxtLink :to="homeTo" class="portal-cases-screen__back">
        <UIcon name="i-lucide-arrow-left" />
        Wróć do „Co teraz”
      </NuxtLink>

      <header class="portal-cases-screen__heading">
        <div>
          <p>TWÓJ PANEL</p>
          <h1>Wszystkie sprawy</h1>
        </div>
        <p>
          {{ payload.cases.length
            ? `Masz ${payload.cases.length} ${payload.cases.length === 1 ? 'udostępnioną sprawę' : 'udostępnione sprawy'}.`
            : 'Nie masz jeszcze udostępnionych spraw.' }}
        </p>
      </header>

      <section v-if="activeCases.length" class="portal-cases-screen__section" aria-labelledby="active-cases-title">
        <header>
          <h2 id="active-cases-title">Aktywne</h2>
          <span>{{ activeCases.length }}</span>
        </header>
        <div class="portal-cases-screen__grid">
          <PortalCaseCard
            v-for="caseData in activeCases"
            :key="caseData.id"
            :case-data="caseData"
            :preview="preview"
          />
        </div>
      </section>

      <section v-if="completedCases.length" class="portal-cases-screen__section" aria-labelledby="completed-cases-title">
        <header>
          <h2 id="completed-cases-title">Zakończone</h2>
          <span>{{ completedCases.length }}</span>
        </header>
        <div class="portal-cases-screen__grid">
          <PortalCaseCard
            v-for="caseData in completedCases"
            :key="caseData.id"
            :case-data="caseData"
            :preview="preview"
          />
        </div>
      </section>

      <OeEmptyState
        v-if="!payload.cases.length"
        icon="i-lucide-folder-clock"
        title="Tu pojawią się Twoje sprawy"
        description="Ekspert musi najpierw udostępnić sprawę temu kontu. Nie musisz zakładać kolejnego konta."
        title-tag="h2"
      >
        <template #actions>
          <UButton :to="homeTo" color="neutral" variant="outline" icon="i-lucide-arrow-left">
            Wróć na start
          </UButton>
        </template>
      </OeEmptyState>
    </main>
  </div>
</template>

<style scoped>
.portal-cases-screen {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.portal-cases-screen__main {
  width: min(1160px, calc(100% - 48px));
  margin: 0 auto;
  padding: 48px 0 120px;
}

.portal-cases-screen__back {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 36px;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-decoration: none;
}

.portal-cases-screen__back:hover {
  color: var(--ui-text-highlighted);
}

.portal-cases-screen__back svg {
  width: 17px;
  height: 17px;
}

.portal-cases-screen__heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 40px;
  margin-bottom: 48px;
  padding-bottom: 30px;
  border-bottom: 1px solid var(--portal-line);
}

.portal-cases-screen__heading p,
.portal-cases-screen__heading h1 {
  margin: 0;
}

.portal-cases-screen__heading > div > p {
  margin-bottom: 6px;
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.portal-cases-screen__heading h1 {
  font-size: clamp(38px, 4vw, 52px);
  line-height: 1.1;
}

.portal-cases-screen__heading > p {
  max-width: 360px;
  padding-bottom: 4px;
  color: var(--ui-text-muted);
  font-size: 14px;
  text-align: right;
}

.portal-cases-screen__section + .portal-cases-screen__section {
  margin-top: 54px;
}

.portal-cases-screen__section > header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.portal-cases-screen__section h2 {
  margin: 0;
  font-size: 23px;
}

.portal-cases-screen__section > header span {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.portal-cases-screen__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.portal-cases-screen__empty {
  display: grid;
  justify-items: center;
  max-width: 640px;
  margin: 60px auto 0;
  padding: 48px 30px;
  border: 1px solid var(--portal-line);
  border-radius: 20px;
  background: var(--ui-bg);
  text-align: center;
}

.portal-cases-screen__empty > span {
  display: grid;
  width: 62px;
  height: 62px;
  place-items: center;
  margin-bottom: 18px;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
}

.portal-cases-screen__empty > span svg {
  width: 26px;
  height: 26px;
}

.portal-cases-screen__empty h2,
.portal-cases-screen__empty p {
  margin: 0;
}

.portal-cases-screen__empty h2 { font-size: 27px; }
.portal-cases-screen__empty p { max-width: 470px; margin: 8px 0 22px; color: var(--ui-text-muted); font-size: 14px; }

@media (max-width: 760px) {
  .portal-cases-screen__main {
    width: min(calc(100% - 32px), 640px);
    padding: 30px 0 110px;
  }

  .portal-cases-screen__back {
    margin-bottom: 26px;
  }

  .portal-cases-screen__heading {
    display: block;
    margin-bottom: 34px;
    padding-bottom: 24px;
  }

  .portal-cases-screen__heading > p {
    margin-top: 10px;
    padding: 0;
    text-align: left;
  }

  .portal-cases-screen__heading h1 {
    font-size: 40px;
  }

  .portal-cases-screen__grid {
    grid-template-columns: 1fr;
  }
}
</style>
