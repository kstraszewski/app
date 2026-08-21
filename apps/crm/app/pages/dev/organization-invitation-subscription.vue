<script setup lang="ts">
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono strony.' })
}

definePageMeta({ layout: false })

useHead({
  title: 'Podgląd subskrypcji zaproszenia — OpenExpert CRM',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ],
})
</script>

<template>
  <AuthShell
    badge="Rejestracja organizacji"
    icon="i-lucide-building-2"
    title="Kancelaria Nowak"
    description="Ostatnim krokiem jest uruchomienie miesięcznej subskrypcji w bezpiecznym formularzu Stripe."
  >
    <div class="organization-subscription-preview">
      <div class="organization-subscription-preview__success">
        <span aria-hidden="true"><UIcon name="i-lucide-building-2" /></span>
        <div>
          <strong>Kancelaria Nowak</strong>
          <small>Rola administratora została przypisana</small>
        </div>
      </div>

      <OrganizationSubscriptionSummary
        monthly-total="200 zł"
        plan-label="Indywidualny"
        price-qualifier="netto + 23% VAT"
        gross-monthly-total="246 zł"
        seat-assignment="Administrator zajmuje wybrane miejsce."
      />

      <UButton
        block
        size="lg"
        icon="i-lucide-lock-keyhole"
        trailing-icon="i-lucide-arrow-up-right"
      >
        Przejdź do Stripe Checkout
      </UButton>

      <UButton block color="neutral" variant="ghost">
        Dokończ później w ustawieniach
      </UButton>
    </div>

    <template #footer>
      Mock używa tego samego komponentu co prawdziwy widok zaproszenia.
    </template>
  </AuthShell>
</template>

<style scoped>
.organization-subscription-preview {
  display: grid;
  gap: 16px;
}

.organization-subscription-preview__success {
  display: flex;
  align-items: center;
  gap: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  padding: 14px;
  background: var(--ui-bg-elevated);
}

.organization-subscription-preview__success > span {
  display: grid;
  flex: 0 0 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg));
  color: var(--ui-success);
  font-size: 20px;
}

.organization-subscription-preview__success > div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.organization-subscription-preview__success strong,
.organization-subscription-preview__success small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-subscription-preview__success strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.organization-subscription-preview__success small {
  color: var(--ui-text-muted);
  font-size: 11px;
}
</style>
