<script setup lang="ts">
import type { TeamGraphPayload, TeamNode } from '~/types/organization'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Zespoły — OpenExpert CRM' })

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const search = ref('')
const createOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', slug: '', kind: 'team', description: '' })
const kindItems = [
  { label: 'Zespół', value: 'team' },
  { label: 'Dział', value: 'department' },
  { label: 'Dywizja', value: 'division' },
  { label: 'Inny', value: 'other' },
]

const emptyGraph: TeamGraphPayload = {
  organization: { id: '', name: '', slug: '', role: 'expert', isDefault: false },
  teams: [],
  edges: [],
  memberships: [],
  members: [],
}

const { data: graph, status, error, refresh } = await useFetch<TeamGraphPayload>(
  () => orgApiPath('/teams'),
  { default: () => emptyGraph },
)

const isAdmin = computed(() => graph.value.organization.role === 'admin')
const rootTeamIds = computed(() => {
  const childIds = new Set(graph.value.edges.map(edge => edge.child_team_id))
  return new Set(graph.value.teams.filter(team => !childIds.has(team.id)).map(team => team.id))
})
const memberCountByTeam = computed(() => {
  const counts = new Map<string, number>()
  for (const membership of graph.value.memberships) {
    counts.set(membership.team_id, (counts.get(membership.team_id) ?? 0) + 1)
  }
  return counts
})
const childCountByTeam = computed(() => {
  const counts = new Map<string, number>()
  for (const edge of graph.value.edges) {
    counts.set(edge.parent_team_id, (counts.get(edge.parent_team_id) ?? 0) + 1)
  }
  return counts
})
const visibleTeams = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')
  if (!query) return graph.value.teams
  return graph.value.teams.filter(team => [team.name, team.slug, team.description, team.kind]
    .some(value => String(value ?? '').toLocaleLowerCase('pl').includes(query)))
})

function kindLabel(team: TeamNode) {
  return kindItems.find(item => item.value === team.kind)?.label ?? 'Inny'
}

function openCreate() {
  Object.assign(form, { name: '', slug: '', kind: 'team', description: '' })
  createOpen.value = true
}

async function createTeam() {
  if (!isAdmin.value || !form.name.trim()) return
  saving.value = true
  try {
    const result = await $fetch<{ data: TeamNode }>(orgApiPath('/teams'), {
      method: 'POST',
      body: {
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        kind: form.kind,
        description: form.description.trim() || undefined,
      },
    })
    createOpen.value = false
    await refresh()
    toast.add({ title: 'Zespół został utworzony', color: 'success', icon: 'i-lucide-network' })
    await navigateTo(orgPath(`/teams/${result.data.id}`))
  } catch (createError: unknown) {
    toast.add({
      title: 'Nie udało się utworzyć zespołu',
      description: apiErrorMessage(createError),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CrmShell title="Zespoły" eyebrow="Administracja organizacji · struktura zespołów">
    <template #actions>
      <UButton v-if="isAdmin" icon="i-lucide-plus" @click="openCreate">Nowy zespół</UButton>
    </template>

    <section class="team-index">
      <div class="team-index__summary">
        <article><span>Zespoły i działy</span><strong>{{ graph.teams.length }}</strong><small>Węzły struktury organizacji</small></article>
        <article><span>Zespoły główne</span><strong>{{ rootTeamIds.size }}</strong><small>Bez zespołu nadrzędnego</small></article>
        <article><span>Przypisania</span><strong>{{ graph.memberships.length }}</strong><small>Bezpośrednie członkostwa</small></article>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać zespołów"
        :description="apiErrorMessage(error)"
        :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
      />

      <UCard>
        <template #header>
          <div class="team-index__toolbar">
            <div><h2>Lista zespołów</h2><p>Wybierz zespół, aby edytować jego dane, członków i relacje w strukturze.</p></div>
            <UInput v-model="search" icon="i-lucide-search" placeholder="Szukaj zespołu" aria-label="Szukaj zespołów" />
          </div>
        </template>

        <div v-if="status === 'pending'" class="team-index__rows">
          <USkeleton v-for="index in 5" :key="index" class="h-20 w-full" />
        </div>
        <div v-else-if="visibleTeams.length" class="team-index__rows">
          <NuxtLink v-for="team in visibleTeams" :key="team.id" :to="orgPath(`/teams/${team.id}`)" class="team-row">
            <span class="team-row__icon"><UIcon :name="team.kind === 'department' ? 'i-lucide-building' : 'i-lucide-users-round'" /></span>
            <span class="team-row__identity">
              <strong>{{ team.name }}</strong>
              <small>{{ team.description || team.slug }}</small>
            </span>
            <UBadge color="neutral" variant="subtle">{{ kindLabel(team) }}</UBadge>
            <span class="team-row__metric"><strong>{{ memberCountByTeam.get(team.id) ?? 0 }}</strong><small>członków</small></span>
            <span class="team-row__metric"><strong>{{ childCountByTeam.get(team.id) ?? 0 }}</strong><small>podrzędnych</small></span>
            <UBadge v-if="rootTeamIds.has(team.id)" color="info" variant="outline">Główny</UBadge>
            <span v-else />
            <UIcon name="i-lucide-chevron-right" class="team-row__arrow" />
          </NuxtLink>
        </div>
        <div v-else class="team-index__empty">
          <UIcon name="i-lucide-network" />
          <h3>{{ graph.teams.length ? 'Brak wyników' : 'Nie ma jeszcze zespołów' }}</h3>
          <p>{{ graph.teams.length ? 'Zmień wyszukiwaną frazę.' : 'Utwórz pierwszy zespół i przypisz do niego członków organizacji.' }}</p>
          <UButton v-if="isAdmin && !graph.teams.length" icon="i-lucide-plus" @click="openCreate">Utwórz zespół</UButton>
        </div>
      </UCard>
    </section>

    <UModal v-model:open="createOpen" title="Nowy zespół" description="Po utworzeniu przejdziesz do jego członków i relacji." :ui="{ footer: 'justify-end' }">
      <template #body>
        <form id="team-create-form" class="team-create-form" @submit.prevent="createTeam">
          <UFormField label="Nazwa" required><UInput v-model="form.name" class="w-full" autofocus /></UFormField>
          <UFormField label="Slug" description="Opcjonalny — wygeneruje się z nazwy."><UInput v-model="form.slug" class="w-full" /></UFormField>
          <UFormField label="Typ"><USelect v-model="form.kind" :items="kindItems" class="w-full" /></UFormField>
          <UFormField label="Opis"><UTextarea v-model="form.description" class="w-full" :rows="3" /></UFormField>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton type="submit" form="team-create-form" icon="i-lucide-network" :disabled="!form.name.trim()" :loading="saving">Utwórz zespół</UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.team-index { display: grid; gap: 22px; }
.team-index__summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.team-index__summary article { display: grid; gap: 4px; padding: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.team-index__summary span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.team-index__summary strong { color: var(--ui-text-highlighted); font-size: 30px; line-height: 1; }
.team-index__summary small { color: var(--ui-text-muted); }
.team-index__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.team-index__toolbar h2 { margin: 0; }
.team-index__toolbar p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.team-index__toolbar > :last-child { width: min(340px, 100%); }
.team-index__rows { display: grid; gap: 8px; }
.team-row { display: grid; grid-template-columns: 42px minmax(220px, 1.5fr) auto 72px 82px 72px 20px; align-items: center; gap: 14px; padding: 14px; border: 1px solid transparent; border-radius: var(--ui-radius); color: inherit; text-decoration: none; transition: background var(--oe-motion-fast), border-color var(--oe-motion-fast); }
.team-row:hover { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.team-row__icon { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--ui-border); border-radius: 11px; background: var(--ui-bg-muted); }
.team-row__identity { display: grid; gap: 3px; min-width: 0; }
.team-row__identity strong, .team-row__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.team-row__identity small, .team-row__metric small { color: var(--ui-text-muted); font-size: 12px; }
.team-row__metric { display: grid; text-align: right; }
.team-row__metric strong { color: var(--ui-text-highlighted); }
.team-row__arrow { color: var(--ui-text-muted); }
.team-index__empty { display: grid; place-items: center; gap: 10px; min-height: 280px; text-align: center; }
.team-index__empty > .iconify { width: 34px; height: 34px; color: var(--ui-text-muted); }
.team-index__empty h3, .team-index__empty p { margin: 0; }
.team-index__empty p { color: var(--ui-text-muted); }
.team-create-form { display: grid; gap: 14px; }
@media (max-width: 900px) {
  .team-index__summary { grid-template-columns: 1fr; }
  .team-index__toolbar { align-items: stretch; flex-direction: column; }
  .team-index__toolbar > :last-child { width: 100%; }
  .team-row { grid-template-columns: 42px minmax(0, 1fr) auto; }
  .team-row__metric, .team-row > .badge, .team-row > span:empty { display: none; }
}
</style>
