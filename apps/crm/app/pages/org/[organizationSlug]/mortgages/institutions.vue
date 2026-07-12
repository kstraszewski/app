<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Instytucje finansowe — OpenExpert' })

type BankOverride = {
  id: string
  is_enabled: boolean
  custom_name: string | null
  custom_website_url: string | null
  logo_path: string | null
  notes: string | null
  revision: number
  updated_at: string
}
type Bank = {
  id: string
  slug: string
  name: string
  baseName: string
  websiteUrl: string
  baseWebsiteUrl: string
  baseLogoUrl: string | null
  logoBackground: string | null
  isEnabled: boolean
  logoUrl: string | null
  productCount: number
  override: BankOverride | null
}
type Payload = { banks: Bank[], role: 'admin' | 'expert' }
type HistoryEntry = {
  id: string
  revision: number
  action: 'created' | 'updated' | 'reset'
  changed_by: string
  created_at: string
  actor: null | { full_name: string, email: string }
}

const route = useRoute()
const toast = useToast()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const apiBase = computed(() => `/api/org/${organizationSlug.value}/mortgages/banks`)
const { data, pending, error, refresh } = await useFetch<Payload>(apiBase, {
  default: () => ({ banks: [], role: 'expert' as const }),
})

const selectedId = ref('')
const saving = ref(false)
const uploading = ref(false)
const removingLogo = ref(false)
const resetting = ref(false)
const resetArmed = ref(false)
const historyPending = ref(false)
const mounted = ref(false)
const logoFile = ref<File | null>(null)
const history = ref<HistoryEntry[]>([])
const selected = computed(() => data.value.banks.find(bank => bank.id === selectedId.value) ?? null)
const isAdmin = computed(() => data.value.role === 'admin')
const hasCustomLogo = computed(() => Boolean(selected.value?.override?.logo_path))

const form = reactive({
  is_enabled: true,
  custom_name: '',
  custom_website_url: '',
  notes: '',
})

function loadForm(bank: Bank) {
  form.is_enabled = bank.override?.is_enabled ?? true
  form.custom_name = bank.override?.custom_name ?? ''
  form.custom_website_url = bank.override?.custom_website_url ?? ''
  form.notes = bank.override?.notes ?? ''
  logoFile.value = null
}

async function loadHistory() {
  if (!mounted.value || !selectedId.value || !isAdmin.value) return
  historyPending.value = true
  try {
    const result = await $fetch<{ data: HistoryEntry[] }>(`${apiBase.value}/${selectedId.value}/history`)
    history.value = result.data
  } catch (caught: any) {
    history.value = []
    toast.add({
      title: 'Nie udało się pobrać historii',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    historyPending.value = false
  }
}

async function save() {
  if (!selected.value) return
  saving.value = true
  try {
    await $fetch(`${apiBase.value}/${selected.value.id}`, {
      method: 'PATCH',
      body: {
        is_enabled: Boolean(form.is_enabled),
        custom_name: form.custom_name.trim() || null,
        custom_website_url: form.custom_website_url.trim() || null,
        notes: form.notes.trim() || null,
      },
    })
    await refresh()
    await loadHistory()
    toast.add({ title: 'Zapisano instytucję finansową', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się zapisać',
      description: caught?.data?.statusMessage ?? caught?.message ?? 'Sprawdź dane formularza.',
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

async function uploadLogo() {
  if (!selected.value || !logoFile.value) return
  uploading.value = true
  try {
    const body = new FormData()
    body.append('logo', logoFile.value)
    await $fetch(`${apiBase.value}/${selected.value.id}/logo`, { method: 'POST', body })
    logoFile.value = null
    await refresh()
    await loadHistory()
    toast.add({ title: 'Logo zostało zapisane', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się przesłać logo',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    uploading.value = false
  }
}

async function removeLogo() {
  if (!selected.value?.logoUrl) return
  removingLogo.value = true
  try {
    await $fetch(`${apiBase.value}/${selected.value.id}/logo`, { method: 'DELETE' })
    await refresh()
    await loadHistory()
    toast.add({ title: 'Logo zostało usunięte', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się usunąć logo',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    removingLogo.value = false
  }
}

async function performReset() {
  if (!selected.value?.override) return
  resetting.value = true
  try {
    await $fetch(`${apiBase.value}/${selected.value.id}`, { method: 'DELETE' })
    await refresh()
    await loadHistory()
    toast.add({ title: 'Przywrócono dane źródłowe instytucji', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się przywrócić danych',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    resetting.value = false
    resetArmed.value = false
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function actionLabel(action: HistoryEntry['action']) {
  return ({ created: 'Utworzono', updated: 'Zmieniono', reset: 'Przywrócono źródło' })[action]
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function armReset() {
  resetArmed.value = true
}

function cancelReset() {
  resetArmed.value = false
}

watch(() => data.value.banks, (banks) => {
  if (!banks.some(bank => bank.id === selectedId.value)) selectedId.value = banks[0]?.id ?? ''
}, { immediate: true })
watch(selected, (bank) => {
  if (!bank) return
  resetArmed.value = false
  loadForm(bank)
  loadHistory()
}, { immediate: true })
onMounted(() => {
  mounted.value = true
  loadHistory()
})
</script>

<template>
  <CrmShell title="Instytucje finansowe" eyebrow="Panel administratora · prezentacja banków">
    <template #actions>
      <UButton :to="`/org/${organizationSlug}/mortgages/admin`" icon="i-lucide-package-open" variant="outline">Produkty</UButton>
      <UButton :to="`/org/${organizationSlug}/mortgages`" icon="i-lucide-arrow-left" variant="outline">Porównywarka</UButton>
    </template>

    <UAlert v-if="error" color="error" variant="subtle" title="Nie udało się pobrać instytucji" />
    <UAlert
      v-else-if="!pending && !isAdmin"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Panel tylko dla administratora organizacji"
      description="Edycja instytucji finansowych wymaga roli administratora."
    />

    <template v-else>
      <section class="admin-notice">
        <UIcon name="i-lucide-landmark" />
        <div>
          <strong>Ustawienia obowiązują tylko w tej organizacji.</strong>
          <p>Możesz zmienić nazwę, stronę i logo instytucji albo ukryć wszystkie jej produkty w porównywarce.</p>
        </div>
      </section>

      <div class="institution-layout">
        <aside class="institution-list">
          <div class="institution-list__header">
            <span>Instytucje</span>
            <UBadge color="neutral" variant="outline">{{ data.banks.length }}</UBadge>
          </div>
          <button
            v-for="bank in data.banks"
            :key="bank.id"
            type="button"
            :class="['institution-item', { active: bank.id === selectedId }]"
            @click="selectedId = bank.id"
          >
            <span class="institution-logo institution-logo--small" :style="bank.logoBackground ? { backgroundColor: bank.logoBackground } : undefined">
              <img v-if="bank.logoUrl" :src="bank.logoUrl" :alt="`Logo ${bank.name}`">
              <span v-else>{{ initials(bank.name) }}</span>
            </span>
            <span class="institution-item__copy">
              <strong>{{ bank.name }}</strong>
              <small>{{ bank.productCount }} {{ bank.productCount === 1 ? 'produkt' : 'produktów' }}</small>
            </span>
            <UBadge v-if="!bank.isEnabled" color="warning" variant="subtle">ukryta</UBadge>
            <UBadge v-else-if="bank.override" color="primary" variant="subtle">zmieniona</UBadge>
          </button>
        </aside>

        <main v-if="selected" class="editor">
          <form @submit.prevent="save">
            <UCard>
              <template #header>
                <div class="card-head">
                  <div class="institution-title">
                    <span class="institution-logo" :style="selected.logoBackground ? { backgroundColor: selected.logoBackground } : undefined">
                      <img v-if="selected.logoUrl" :src="selected.logoUrl" :alt="`Logo ${selected.name}`">
                      <span v-else>{{ initials(selected.name) }}</span>
                    </span>
                    <div><p>Instytucja finansowa</p><h2>{{ selected.name }}</h2></div>
                  </div>
                  <UBadge v-if="selected.override" color="primary" variant="outline">rewizja {{ selected.override.revision }}</UBadge>
                </div>
              </template>

              <div class="form-grid">
                <UFormField
                  label="Widoczna w porównywarce"
                  description="Wyłączenie ukrywa wszystkie produkty tej instytucji w organizacji."
                >
                  <USwitch v-model="form.is_enabled" />
                </UFormField>
                <UFormField label="Nazwa w organizacji" description="Puste pole zachowuje nazwę źródłową.">
                  <UInput v-model="form.custom_name" :placeholder="selected.baseName" />
                </UFormField>
                <UFormField class="full" label="Strona internetowa" description="Puste pole zachowuje adres źródłowy.">
                  <UInput v-model="form.custom_website_url" type="url" :placeholder="selected.baseWebsiteUrl" icon="i-lucide-globe" />
                </UFormField>
                <UFormField class="full" label="Notatka administratora">
                  <UTextarea v-model="form.notes" :rows="3" placeholder="Np. opiekun instytucji, zakres współpracy lub źródło zmiany" />
                </UFormField>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <div class="card-head"><div><p>Identyfikacja wizualna</p><h2>Logo instytucji</h2></div><small>PNG, JPEG lub WebP · maks. 2 MB</small></div>
              </template>
              <div class="logo-editor">
                <div class="logo-preview" :style="selected.logoBackground ? { backgroundColor: selected.logoBackground } : undefined">
                  <img v-if="selected.logoUrl" :src="selected.logoUrl" :alt="`Aktualne logo ${selected.name}`">
                  <div v-else><UIcon name="i-lucide-image" /><span>Brak własnego logo</span></div>
                </div>
                <div class="logo-upload">
                  <UFileUpload
                    v-model="logoFile"
                    accept="image/png,image/jpeg,image/webp"
                    icon="i-lucide-image-up"
                    label="Wybierz lub upuść logo"
                    description="Nowy plik zastąpi obecne logo po zatwierdzeniu."
                    :disabled="uploading"
                  />
                  <div class="logo-actions">
                    <UButton type="button" icon="i-lucide-upload" :disabled="!logoFile" :loading="uploading" @click="uploadLogo">Prześlij logo</UButton>
                    <UButton v-if="hasCustomLogo" type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :loading="removingLogo" @click="removeLogo">Przywróć logo źródłowe</UButton>
                  </div>
                </div>
              </div>
            </UCard>

            <div class="sticky-actions">
              <div>
                <strong>{{ selected.productCount }}</strong> {{ selected.productCount === 1 ? 'aktywny produkt' : 'aktywnych produktów' }}
                <span v-if="selected.override"> · aktualizacja {{ formatDateTime(selected.override.updated_at) }}</span>
              </div>
              <UButton v-if="resetArmed" type="button" color="neutral" variant="ghost" @click="cancelReset">Anuluj</UButton>
              <UButton v-if="selected.override && !resetArmed" type="button" color="error" variant="ghost" icon="i-lucide-rotate-ccw" @click="armReset">Przywróć źródło</UButton>
              <UButton v-else-if="selected.override" type="button" color="error" icon="i-lucide-rotate-ccw" :loading="resetting" @click="performReset">Potwierdź przywrócenie</UButton>
              <UButton type="submit" icon="i-lucide-save" :loading="saving">Zapisz instytucję</UButton>
            </div>
          </form>

          <UCard class="history-card">
            <template #header>
              <div class="card-head"><div><p>Audyt</p><h2>Historia zmian</h2></div><UButton aria-label="Odśwież historię" icon="i-lucide-refresh-cw" variant="ghost" :loading="historyPending" @click="loadHistory" /></div>
            </template>
            <div v-if="!history.length" class="empty-history">Nie zapisano jeszcze zmian dla tej instytucji.</div>
            <ol v-else class="history-list">
              <li v-for="entry in history" :key="entry.id">
                <span class="history-dot" />
                <div>
                  <strong>{{ actionLabel(entry.action) }} · rewizja {{ entry.revision }}</strong>
                  <p>{{ entry.actor?.full_name || entry.actor?.email || entry.changed_by }}</p>
                  <small>{{ formatDateTime(entry.created_at) }}</small>
                </div>
              </li>
            </ol>
          </UCard>
        </main>
      </div>
    </template>
  </CrmShell>
</template>

<style scoped>
.admin-notice { display: flex; gap: 14px; padding: 18px 20px; margin-bottom: 20px; border: 1px solid var(--ui-border); border-radius: 14px; background: var(--ui-bg); }
.admin-notice > svg { flex: 0 0 auto; width: 22px; height: 22px; color: var(--ui-primary); }
.admin-notice p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 14px; }
.institution-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; align-items: start; }
.institution-list { position: sticky; top: 20px; display: grid; gap: 6px; padding: 10px; border: 1px solid var(--ui-border); border-radius: 14px; background: var(--ui-bg); }
.institution-list__header { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 12px; color: var(--ui-text-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
.institution-item { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.institution-item:hover, .institution-item.active { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.institution-item.active { box-shadow: inset 3px 0 0 var(--ui-primary); }
.institution-item__copy { display: grid; min-width: 0; }
.institution-item__copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.institution-item__copy small { color: var(--ui-text-muted); }
.institution-logo { display: grid; place-items: center; flex: 0 0 auto; width: 56px; height: 56px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-bg-muted); color: var(--ui-text-muted); font-size: 14px; font-weight: 700; }
.institution-logo img { width: 100%; height: 100%; padding: 7px; object-fit: contain; }
.institution-logo--small { width: 38px; height: 38px; border-radius: 9px; font-size: 11px; }
.institution-logo--small img { padding: 5px; }
.editor, .editor form { display: grid; gap: 16px; min-width: 0; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.card-head p { margin: 0 0 3px; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.card-head h2 { margin: 0; font-size: 19px; }
.card-head small { color: var(--ui-text-muted); }
.institution-title { display: flex; align-items: center; gap: 14px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.form-grid :deep(input), .form-grid :deep(textarea) { width: 100%; }
.full { grid-column: 1 / -1; }
.logo-editor { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 20px; }
.logo-preview { display: grid; place-items: center; min-height: 180px; padding: 24px; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-bg-muted); }
.logo-preview img { width: 100%; max-height: 120px; object-fit: contain; }
.logo-preview div { display: grid; place-items: center; gap: 8px; color: var(--ui-text-muted); font-size: 13px; }
.logo-preview svg { width: 28px; height: 28px; }
.logo-upload { display: grid; align-content: start; gap: 12px; }
.logo-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.sticky-actions { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 12px 14px; border: 1px solid var(--ui-border-accented); border-radius: 14px; background: color-mix(in srgb, var(--ui-bg) 94%, transparent); box-shadow: 0 12px 30px rgb(0 0 0 / 9%); backdrop-filter: blur(14px); }
.sticky-actions > div { margin-right: auto; color: var(--ui-text-muted); font-size: 13px; }
.history-card { margin-top: 4px; }
.empty-history { padding: 12px 0; color: var(--ui-text-muted); }
.history-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.history-list li { position: relative; display: flex; gap: 12px; padding: 0 0 18px; }
.history-list li:not(:last-child)::before { position: absolute; top: 10px; bottom: 0; left: 4px; width: 1px; background: var(--ui-border); content: ''; }
.history-dot { z-index: 1; flex: 0 0 auto; width: 9px; height: 9px; margin-top: 5px; border-radius: 999px; background: var(--ui-primary); }
.history-list p { margin: 2px 0; color: var(--ui-text-muted); font-size: 13px; }
.history-list small { color: var(--ui-text-dimmed); }
@media (max-width: 1050px) { .institution-layout { grid-template-columns: 1fr; } .institution-list { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); } .institution-list__header { grid-column: 1 / -1; } }
@media (max-width: 700px) { .institution-list, .form-grid, .logo-editor { grid-template-columns: 1fr; } .sticky-actions { align-items: stretch; flex-direction: column; } .sticky-actions > div { margin-right: 0; } }
</style>
