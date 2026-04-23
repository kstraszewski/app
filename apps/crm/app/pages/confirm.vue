<script setup lang="ts">
const user = useSupabaseUser()
watch(user, (val) => {
  if (val) navigateTo('/dashboard')
}, { immediate: true })

useHead({ title: 'Potwierdzanie logowania — OpenExpert CRM' })
</script>

<template>
  <main class="confirm-page oe-grid-bg">
    <UCard class="confirm-card oe-animate-in">
      <div class="confirm-state">
        <UIcon name="i-lucide-loader-circle" class="confirm-state__icon" />
        <h1>Logowanie</h1>
        <p>Potwierdzamy sesję i za chwilę przeniesiemy Cię do dashboardu.</p>
      </div>
    </UCard>
  </main>
</template>

<style scoped>
.confirm-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
}

.confirm-card {
  width: min(100%, 420px);
}

.confirm-state {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 24px 0;
  text-align: center;
}

.confirm-state__icon {
  width: 28px;
  height: 28px;
  color: var(--ui-text-muted);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.confirm-state h1 {
  color: var(--ui-text-highlighted);
  font-size: 28px;
  font-weight: 300;
}

.confirm-state p {
  max-width: 300px;
  color: var(--ui-text-toned);
  line-height: 1.6;
}
</style>
