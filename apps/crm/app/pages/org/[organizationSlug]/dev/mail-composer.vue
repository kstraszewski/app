<script setup lang="ts">
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono strony.' })
}

definePageMeta({
  middleware: ['auth', 'organization'],
})

useHead({
  title: 'Podgląd composera poczty — OpenExpert CRM',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const open = ref(true)
const previewCases = [
  {
    id: '9427198c-bf6c-4b2d-8530-68a5117c5679',
    label: 'E2E Multiwniosek 2026-08-07',
    closedAt: null,
  },
  {
    id: '6a3a86c3-4081-5480-b849-0c13c3caeb71',
    label: 'Zakup mieszkania — Warszewo',
    closedAt: null,
  },
]
const previewProviderSuggestions = [{
  email: 'decyzje@pkobp.pl',
  label: 'PKO Bank Polski',
  source: 'provider' as const,
  providerId: 'google:decyzje@pkobp.pl',
}, {
  email: 'anna.kowalska@example.local',
  label: 'Anna Kowalska',
  source: 'provider' as const,
  providerId: 'google:anna.kowalska@example.local',
}]
</script>

<template>
  <div>
    <main class="mail-composer-preview">
      <div>
        <p>OpenExpert Mail · podgląd deweloperski</p>
        <h1>Composer powiązany z CRM</h1>
        <span>Ta strona nie wysyła wiadomości i jest dostępna wyłącznie lokalnie.</span>
        <UButton icon="i-lucide-pen-line" size="lg" @click="open = true">
          Otwórz composer
        </UButton>
      </div>
    </main>

    <MailComposerSlideover
      v-if="open"
      v-model:open="open"
      endpoint="/api/dev/mail-preview"
      connection-id="00000000-0000-4000-8000-000000000001"
      provider="google"
      provider-label="Gmail"
      provider-icon="i-lucide-mail"
      account-email="ekspert@openexpert.local"
      initial-to="anna.kowalska@example.local; decyzje@pkobp.pl"
      initial-subject="Dokumenty do wniosku kredytowego"
      :initial-body="'Dzień dobry,\n\nprzesyłam podsumowanie dokumentów dotyczących wniosku.'"
      context-type="client"
      context-id="3cd952e9-376a-4b88-8a46-25dd2569ba66"
      context-label="Anna Kowalska"
      :context-cases="previewCases"
      :provider-suggestions="previewProviderSuggestions"
      preview
    />
  </div>
</template>

<style scoped>
.mail-composer-preview {
  display: grid;
  min-height: 100dvh;
  place-items: center;
  padding: 24px;
  background: var(--ui-bg-muted);
}

.mail-composer-preview > div {
  display: grid;
  width: min(560px, 100%);
  justify-items: start;
  gap: 14px;
  padding: 32px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-panel);
  background: var(--ui-bg);
}

.mail-composer-preview p,
.mail-composer-preview h1,
.mail-composer-preview span {
  margin: 0;
}

.mail-composer-preview p {
  color: var(--ui-success);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mail-composer-preview h1 {
  color: var(--ui-text-highlighted);
  font-size: clamp(28px, 5vw, 44px);
  letter-spacing: -0.04em;
}

.mail-composer-preview span {
  color: var(--ui-text-muted);
  line-height: 1.6;
}
</style>
