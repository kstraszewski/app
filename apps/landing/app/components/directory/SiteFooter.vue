<template>
  <footer class="directory-footer">
    <div class="directory-footer__inner">
      <NuxtLink to="/" class="directory-footer__brand" aria-label="OpenExpert — strona główna">
        <img src="/assets/logo-dark.svg" alt="" width="24" height="24">
        <span>OpenExpert</span>
      </NuxtLink>

      <p>Znajdź eksperta i umów konsultację w sprawie, która jest dla Ciebie ważna.</p>

      <nav aria-label="Linki w stopce">
        <NuxtLink to="/eksperci">Eksperci</NuxtLink>
        <NuxtLink to="/placowki">Placówki</NuxtLink>
        <NuxtLink to="/o-nas">O OpenExpert</NuxtLink>
        <a href="mailto:hello@openexpert.app">Kontakt</a>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.directory-footer {
  border-top: 1px solid #292929;
  background: #030303;
  color: #f7f7f7;
}

.directory-footer__inner {
  display: grid;
  width: min(1440px, calc(100% - 80px));
  min-height: 132px;
  grid-template-columns: 1fr minmax(280px, 1.2fr) 1fr;
  align-items: center;
  gap: 32px;
  margin: 0 auto;
}

.directory-footer__brand {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 11px;
  color: #f7f7f7;
  font-size: 18px;
  font-weight: 500;
  text-decoration: none;
}

.directory-footer p {
  max-width: 460px;
  color: #888;
  font-size: 13px;
  line-height: 1.55;
  text-align: center;
}

.directory-footer nav {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 22px;
}

.directory-footer nav a {
  color: #aaa;
  font-size: 13px;
  text-decoration: none;
  transition: color var(--transition-fast);
}

.directory-footer nav a:hover {
  color: #fff;
}

.directory-footer :is(a):focus-visible {
  outline-color: #fff;
  outline-offset: 4px;
}

@media (max-width: 840px) {
  .directory-footer__inner {
    width: min(100% - 40px, 620px);
    min-height: auto;
    grid-template-columns: 1fr;
    justify-items: start;
    gap: 22px;
    padding: 36px 0;
  }

  .directory-footer p {
    max-width: 520px;
    text-align: left;
  }

  .directory-footer nav {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
