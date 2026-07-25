<script setup lang="ts">
definePageMeta({ middleware: 'client-auth', layout: false })

const route = useRoute()
const appointmentId = computed(() => (
  typeof route.query.appointmentId === 'string' ? route.query.appointmentId : ''
))
const redirectAfterClaim = computed(() => {
  const requested = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return requested.startsWith('/client/') && !requested.startsWith('//')
    ? requested
    : '/client?claimed=1'
})
const loading = ref(false)
const error = ref<string | null>(null)

useHead({
  title: 'Dodaj konsultację — OpenExpert',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

async function claimAppointment() {
  error.value = null
  if (!appointmentId.value) {
    error.value = 'Link nie zawiera identyfikatora konsultacji.'
    return
  }

  loading.value = true
  try {
    await $fetch('/api/client/appointments/claim', {
      method: 'POST',
      body: { appointmentId: appointmentId.value },
    })
    await navigateTo(redirectAfterClaim.value)
  } catch (claimError: unknown) {
    const candidate = claimError as {
      statusCode?: number
      data?: { statusMessage?: string }
    }
    error.value = candidate.statusCode === 403
      ? 'Potwierdzony adres tego konta nie zgadza się z adresem podanym przy rezerwacji.'
      : candidate.statusCode === 404
        ? 'Nie znaleźliśmy konsultacji powiązanej z tym linkiem.'
        : candidate.statusCode === 409
          ? 'Ta osoba jest już powiązana z innym kontem klienta.'
          : candidate.data?.statusMessage ?? 'Nie udało się dodać konsultacji. Spróbuj ponownie.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <ClientPortalShell
    compact
    :show-navigation="false"
    eyebrow="Potwierdzenie dostępu"
    title="Dodaj konsultację do konta"
    description="Dostęp przyznamy tylko wtedy, gdy potwierdzony kontakt na koncie odpowiada danym użytym podczas rezerwacji."
  >
    <UCard class="claim-card">
      <div class="claim-card__content">
        <span class="claim-card__icon" aria-hidden="true">
          <UIcon name="i-lucide-shield-check" />
        </span>
        <div>
          <h2>Bezpieczne powiązanie</h2>
          <p>
            Potwierdzony adres email musi być jednocześnie adresem z rezerwacji
            i adresem przypisanym do właściwej osoby w placówce. Dane wizyty
            pojawią się dopiero po poprawnej weryfikacji.
          </p>
        </div>
      </div>

      <UAlert
        v-if="!appointmentId"
        color="warning"
        variant="subtle"
        icon="i-lucide-link-2-off"
        title="Niepełny link"
        description="Wróć do potwierdzenia rezerwacji i użyj przycisku aktywacji panelu."
      />

      <UAlert
        v-if="error"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="error"
      />

      <UButton
        type="button"
        block
        size="lg"
        icon="i-lucide-badge-check"
        :disabled="!appointmentId"
        :loading="loading"
        @click="claimAppointment"
      >
        Potwierdź i dodaj konsultację
      </UButton>

      <NuxtLink to="/client" class="claim-card__back">
        Przejdź do moich konsultacji
      </NuxtLink>
    </UCard>
  </ClientPortalShell>
</template>

<style scoped>
.claim-card,
.claim-card :deep(.divide-y) {
  display: grid;
  gap: 22px;
}

.claim-card__content {
  display: flex;
  gap: 16px;
}

.claim-card__icon {
  display: grid;
  flex: 0 0 44px;
  height: 44px;
  place-items: center;
  border-radius: 13px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 21px;
}

.claim-card h2,
.claim-card p {
  margin: 0;
}

.claim-card h2 {
  margin-bottom: 7px;
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.claim-card p {
  color: var(--ui-text-toned);
  font-size: 14px;
  line-height: 1.55;
}

.claim-card__back {
  color: var(--ui-text-toned);
  font-size: 14px;
  text-align: center;
}
</style>
