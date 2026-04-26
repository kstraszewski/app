<script setup lang="ts">
const props = defineProps<{
  status?: string | null
}>()

const labels: Record<string, string> = {
  lead: 'Lead',
  nowa: 'Nowa',
  analiza: 'Analiza',
  aktywna: 'Aktywna',
  czeka_na_klienta: 'Czeka na klienta',
  zakonczona: 'Zakonczona',
  utracona: 'Utracona',
  kwalifikacja: 'Kwalifikacja',
  dokumenty: 'Dokumenty',
  oferty: 'Oferty',
  wnioski_wyslane: 'Wnioski wyslane',
  decyzja: 'Decyzja',
  umowa: 'Umowa',
  uruchomiony: 'Uruchomiony',
  analiza_potrzeb: 'Analiza potrzeb',
  polisa_wystawiona: 'Polisa wystawiona',
  draft: 'Draft',
  wyslane: 'Wyslane',
  w_analizie: 'W analizie',
  braki: 'Braki',
  zaakceptowane: 'Zaakceptowane',
  odrzucone: 'Odrzucone',
  szacowane: 'Szacowane',
  oczekiwane: 'Oczekiwane',
  nalezne: 'Nalezne',
  zaplacone: 'Zaplacone',
}

const color = computed(() => {
  const status = props.status ?? ''
  if (['zakonczona', 'uruchomiony', 'aktywna', 'zaakceptowane', 'zaplacone'].includes(status)) return 'success'
  if (['czeka_na_klienta', 'dokumenty', 'decyzja', 'braki', 'nalezne'].includes(status)) return 'warning'
  if (['utracona', 'utracony', 'odrzucone', 'sporne'].includes(status)) return 'error'
  return 'neutral'
})

const label = computed(() => labels[props.status ?? ''] ?? props.status ?? 'Brak')
</script>

<template>
  <UBadge :color="color" variant="subtle">
    {{ label }}
  </UBadge>
</template>

