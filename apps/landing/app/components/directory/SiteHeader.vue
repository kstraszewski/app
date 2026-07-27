<script setup lang="ts">
withDefaults(defineProps<{
  active?: 'experts' | 'facilities' | 'about'
  ctaHref?: string
  ctaLabel?: string
}>(), {
  ctaHref: '/placowki#katalog-placowek',
  ctaLabel: 'Umów konsultację',
})
</script>

<template>
  <header class="directory-header">
    <a class="skip-link" href="#directory-content">Przejdź do treści</a>

    <div class="directory-header__inner">
      <NuxtLink to="/" class="directory-brand" aria-label="OpenExpert — strona główna">
        <img src="/assets/logo-light.svg" alt="" width="30" height="30">
        <span>OpenExpert</span>
      </NuxtLink>

      <nav class="directory-nav" aria-label="Katalog OpenExpert">
        <NuxtLink class="directory-nav__secondary" to="/">
          Strona główna
        </NuxtLink>
        <NuxtLink
          to="/eksperci"
          :aria-current="active === 'experts' ? 'page' : undefined"
        >
          Eksperci
        </NuxtLink>
        <NuxtLink
          to="/placowki"
          :aria-current="active === 'facilities' ? 'page' : undefined"
        >
          Placówki
        </NuxtLink>
        <NuxtLink
          to="/o-nas"
          :aria-current="active === 'about' ? 'page' : undefined"
        >
          O nas
        </NuxtLink>
      </nav>

      <NuxtLink :to="ctaHref" class="directory-header__cta">
        {{ ctaLabel }}
        <Icon name="lucide:arrow-right" aria-hidden="true" />
      </NuxtLink>
    </div>
  </header>
</template>

<style scoped>
.directory-header {
  position: relative;
  z-index: 20;
  border-bottom: 1px solid #deded9;
  background: #fafaf8;
  color: #111;
}

.directory-header__inner {
  display: grid;
  width: min(1440px, calc(100% - 80px));
  min-height: 88px;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  margin: 0 auto;
}

.directory-brand {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 13px;
  color: #111;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.025em;
  text-decoration: none;
}

.directory-brand img {
  flex: 0 0 auto;
}

.directory-nav {
  display: flex;
  align-items: center;
  gap: clamp(22px, 3vw, 42px);
}

.directory-nav a {
  position: relative;
  padding: 10px 0;
  color: #484844;
  font-size: 14px;
  text-decoration: none;
  transition: color var(--transition-fast);
}

.directory-nav a:hover,
.directory-nav a[aria-current='page'] {
  color: #111;
}

.directory-nav a[aria-current='page']::after {
  position: absolute;
  right: 0;
  bottom: 3px;
  left: 0;
  height: 1px;
  background: currentColor;
  content: '';
}

.directory-header__cta {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-self: end;
  gap: 10px;
  border: 1px solid #111;
  border-radius: 4px;
  padding: 9px 15px;
  background: #111;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.directory-header__cta:hover {
  background: #363636;
}

.directory-header__cta :deep(svg) {
  width: 16px;
  height: 16px;
}

.skip-link {
  position: absolute;
  top: 10px;
  left: 16px;
  z-index: 2;
  padding: 9px 13px;
  background: #111;
  color: #fff;
  text-decoration: none;
  transform: translateY(-150%);
}

.skip-link:focus {
  transform: translateY(0);
}

.directory-header :is(a):focus-visible {
  outline-color: #111;
  outline-offset: 4px;
}

@media (max-width: 760px) {
  .directory-header__inner {
    width: min(100% - 40px, 620px);
    min-height: auto;
    grid-template-columns: 1fr auto;
    gap: 8px 18px;
    padding: 18px 0 14px;
  }

  .directory-brand {
    font-size: 19px;
  }

  .directory-brand img {
    width: 26px;
    height: 26px;
  }

  .directory-nav {
    grid-column: 1 / -1;
    grid-row: 2;
    gap: 24px;
  }

  .directory-nav a {
    padding: 8px 0;
  }

  .directory-header__cta {
    min-height: 38px;
    padding: 8px 12px;
    font-size: 12px;
  }
}

@media (max-width: 520px) {
  .directory-nav__secondary,
  .directory-nav a:last-child {
    display: none;
  }
}

@media (max-width: 359px) {
  .directory-brand span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
