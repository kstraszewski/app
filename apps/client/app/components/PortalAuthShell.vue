<script setup lang="ts">
withDefaults(defineProps<{
  eyebrow?: string
  title: string
  description?: string
}>(), {
  eyebrow: 'PANEL KLIENTA',
  description: '',
})
</script>

<template>
  <div class="auth-shell">
    <header class="auth-shell__header">
      <NuxtLink to="/" aria-label="OpenExpert — strona panelu klienta">
        <OpenExpertLogo />
      </NuxtLink>
      <span><UIcon name="i-lucide-shield-check" /> Bezpieczne połączenie</span>
    </header>

    <main class="auth-shell__main">
      <aside class="auth-shell__story" aria-label="Informacje o panelu">
        <p class="auth-shell__story-eyebrow">WSPÓLNIE PRZEZ CAŁY PROCES</p>
        <h2>Twoja sprawa.<br>Twój ekspert.<br>Jeden bezpieczny panel.</h2>
        <ul>
          <li><UIcon name="i-lucide-check" /> Aktualny postęp sprawy</li>
          <li><UIcon name="i-lucide-check" /> Dokumenty i formularze w jednym miejscu</li>
          <li><UIcon name="i-lucide-check" /> Dostęp wyłącznie po udostępnieniu przez eksperta</li>
        </ul>
      </aside>

      <section class="auth-shell__form-column">
        <div class="auth-shell__form-heading">
          <p>{{ eyebrow }}</p>
          <h1>{{ title }}</h1>
          <div v-if="description">{{ description }}</div>
        </div>
        <slot />
      </section>
    </main>

    <footer class="auth-shell__footer">
      <span>© {{ new Date().getFullYear() }} OpenExpert</span>
      <span>Twoje dane są chronione zgodnie z RODO.</span>
    </footer>
  </div>
</template>

<style scoped>
.auth-shell {
  display: grid;
  grid-template-rows: 82px 1fr 52px;
  min-height: 100dvh;
  background: #fff;
}

.auth-shell__header,
.auth-shell__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-inline: clamp(22px, 4vw, 56px);
}

.auth-shell__header {
  border-bottom: 1px solid var(--portal-line);
}

.auth-shell__header a {
  text-decoration: none;
}

.auth-shell__header > span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.auth-shell__header svg {
  width: 17px;
  height: 17px;
  color: var(--ui-text-highlighted);
}

.auth-shell__main {
  display: grid;
  grid-template-columns: minmax(340px, 0.95fr) minmax(480px, 1.05fr);
  min-height: 670px;
}

.auth-shell__story {
  display: flex;
  justify-content: center;
  flex-direction: column;
  padding: clamp(48px, 7vw, 110px);
  border-right: 1px solid var(--portal-line);
  background: var(--ui-bg-muted);
}

.auth-shell__story-eyebrow {
  margin: 0 0 22px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.13em;
}

.auth-shell__story h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(36px, 4vw, 58px);
  font-weight: 350;
  line-height: 1.08;
}

.auth-shell__story ul {
  display: grid;
  gap: 14px;
  margin: 45px 0 0;
  padding: 0;
  list-style: none;
}

.auth-shell__story li {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--ui-text-toned);
  font-size: 14px;
}

.auth-shell__story li svg {
  width: 22px;
  height: 22px;
  padding: 4px;
  border-radius: 999px;
  background: var(--ui-success);
  color: #fff;
}

.auth-shell__form-column {
  display: flex;
  width: min(100%, 590px);
  justify-content: center;
  flex-direction: column;
  padding: 55px clamp(28px, 6vw, 95px);
}

.auth-shell__form-heading {
  margin-bottom: 30px;
}

.auth-shell__form-heading > p {
  margin: 0 0 10px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.13em;
}

.auth-shell__form-heading h1 {
  margin: 0;
  font-size: clamp(32px, 3.2vw, 44px);
  font-weight: 400;
  line-height: 1.17;
}

.auth-shell__form-heading div {
  max-width: 460px;
  margin-top: 10px;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.6;
}

.auth-shell__footer {
  border-top: 1px solid var(--portal-line);
  color: var(--ui-text-muted);
  font-size: 11px;
}

@media (max-width: 900px) {
  .auth-shell {
    grid-template-rows: 68px 1fr auto;
  }

  .auth-shell__main {
    display: block;
    min-height: 0;
  }

  .auth-shell__story {
    display: none;
  }

  .auth-shell__form-column {
    margin: 0 auto;
    padding: 64px 28px 80px;
  }

  .auth-shell__footer {
    gap: 16px;
    padding-block: 16px;
  }
}

@media (max-width: 540px) {
  .auth-shell__header > span {
    display: none;
  }

  .auth-shell__form-column {
    padding: 42px 20px 60px;
  }

  .auth-shell__footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
