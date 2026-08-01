<script setup lang="ts">
definePageMeta({ middleware: 'client-auth' })

const route = useRoute()
const { errorMessage, safeRedirect } = usePortalAuth()
const appointmentId = computed(() => typeof route.query.appointmentId === 'string'
  ? route.query.appointmentId
  : '')
const nextPath = computed(() => safeRedirect(route.query.next, '/?claimed=1'))
const status = ref<'claiming' | 'success' | 'error'>('claiming')
const error = ref('')

useHead({ title: 'Dodawanie konsultacji — OpenExpert' })

async function claim() {
  if (!appointmentId.value) {
    status.value = 'error'
    error.value = 'Ten link nie zawiera identyfikatora konsultacji.'
    return
  }
  status.value = 'claiming'
  error.value = ''
  try {
    await $fetch('/api/client/appointments/claim', {
      method: 'POST',
      body: { appointmentId: appointmentId.value },
    })
    status.value = 'success'
    window.setTimeout(() => navigateTo(nextPath.value), 1200)
  }
  catch (claimError: unknown) {
    const candidate = claimError as { statusCode?: number, status?: number }
    status.value = 'error'
    error.value = candidate.statusCode === 403 || candidate.status === 403
      ? 'Adres email tego konta nie zgadza się z adresem użytym podczas rezerwacji.'
      : candidate.statusCode === 409 || candidate.status === 409
        ? 'Ta konsultacja jest już przypisana do innego konta.'
        : errorMessage(claimError as { message?: string, statusCode?: number })
  }
}

onMounted(claim)
</script>

<template>
  <PortalAuthShell
    eyebrow="POTWIERDZENIE REZERWACJI"
    :title="status === 'claiming'
      ? 'Dodajemy konsultację do Twojego panelu'
      : status === 'success' ? 'Konsultacja została dodana' : 'Nie udało się dodać konsultacji'"
    description="Nie musisz tworzyć drugiego konta. Używamy tej samej, zweryfikowanej tożsamości OpenExpert."
  >
    <div class="claim-state">
      <div v-if="status === 'claiming'" class="claim-state__progress">
        <UIcon name="i-lucide-loader-circle" />
        <p>Sprawdzamy adres z rezerwacji i bezpiecznie łączymy konsultację…</p>
      </div>

      <template v-else-if="status === 'success'">
        <UAlert
          color="success"
          variant="subtle"
          icon="i-lucide-calendar-check-2"
          title="Gotowe"
          description="Za chwilę przejdziemy do Twojego panelu."
        />
        <UButton :to="nextPath" block variant="solid" trailing icon="i-lucide-arrow-right">
          Przejdź teraz
        </UButton>
      </template>

      <template v-else>
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się potwierdzić konsultacji"
          :description="error"
        />
        <UButton color="neutral" variant="outline" block icon="i-lucide-refresh-cw" @click="claim">
          Spróbuj ponownie
        </UButton>
        <UButton to="/" color="neutral" variant="ghost" block>
          Wróć do panelu
        </UButton>
      </template>
    </div>
  </PortalAuthShell>
</template>

<style scoped>
.claim-state {
  display: grid;
  gap: 18px;
}

.claim-state__progress {
  display: grid;
  justify-items: center;
  gap: 18px;
  padding: 38px 24px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  text-align: center;
}

.claim-state__progress svg {
  width: 40px;
  height: 40px;
  color: var(--ui-text-highlighted);
  animation: spin 1s linear infinite;
}

.claim-state__progress p {
  max-width: 370px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.6;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
