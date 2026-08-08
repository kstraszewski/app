<script setup lang="ts">
import type { TeamGraphPayload, TeamNode } from '~/types/organization'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Zespoły — OpenExpert CRM' })

type TeamAccessLevel = 'organization_admin' | 'team_admin' | 'inherited'
type TeamListNode = TeamNode & { accessLevel?: TeamAccessLevel }
type TeamGraphListPayload = Omit<TeamGraphPayload, 'teams'> & {
  teams: TeamListNode[]
  access: {
    canCreate: boolean
    managedTeamIds: string[]
    directAdminTeamIds: string[]
  }
}

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

const emptyGraph: TeamGraphListPayload = {
  organization: {
    id: '',
    name: '',
    slug: '',
    role: 'expert',
    isDefault: false,
    capabilities: {
      organizationAdmin: false,
      teamAdmin: false,
      facilityAdmin: false,
      canManageTeams: false,
      canUseExperiments: false,
    },
  },
  teams: [],
  edges: [],
  memberships: [],
  members: [],
  access: {
    canCreate: false,
    managedTeamIds: [],
    directAdminTeamIds: [],
  },
}

const { data: graph, status, error, refresh } = await useFetch<TeamGraphListPayload>(
  () => orgApiPath('/teams'),
  { default: () => emptyGraph },
)

const isOrganizationScope = computed(() => graph.value.organization.role === 'admin')
const pageTitle = computed(() => isOrganizationScope.value ? 'Zespoły' : 'Moje zespoły')
const pageDescription = computed(() => isOrganizationScope.value
  ? 'Struktura organizacji, odpowiedzialność liderów oraz wyniki zespołów w jednym miejscu.'
  : 'Zespoły, którymi zarządzasz bezpośrednio lub przez ich strukturę podrzędną.')
const managedTeamIds = computed(() => new Set(graph.value.access.managedTeamIds))
const directAdminTeamIds = computed(() => new Set(graph.value.access.directAdminTeamIds))
const rootTeamIds = computed(() => {
  const teamIds = new Set(graph.value.teams.map(team => team.id))
  const childIds = new Set(
    graph.value.edges
      .filter(edge => teamIds.has(edge.parent_team_id) && teamIds.has(edge.child_team_id))
      .map(edge => edge.child_team_id),
  )
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
const uniqueMemberCount = computed(() => new Set(
  graph.value.memberships.map(membership => membership.user_id),
).size)
const memberSearchByTeam = computed(() => {
  const memberById = new Map(graph.value.members.map(member => [
    member.userId,
    `${member.fullName} ${member.email}`.toLocaleLowerCase('pl'),
  ]))
  const index = new Map<string, string[]>()

  for (const membership of graph.value.memberships) {
    const searchValue = memberById.get(membership.user_id)
    if (!searchValue) continue
    index.set(membership.team_id, [...(index.get(membership.team_id) ?? []), searchValue])
  }

  return index
})
const visibleTeams = computed(() => {
  const queryTokens = search.value
    .trim()
    .toLocaleLowerCase('pl')
    .split(/\s+/)
    .filter(Boolean)

  if (!queryTokens.length) return graph.value.teams

  return graph.value.teams.filter((team) => {
    const haystack = [
      team.name,
      team.slug,
      team.description,
      team.kind,
      kindLabel(team),
      ...(memberSearchByTeam.value.get(team.id) ?? []),
    ].join(' ').toLocaleLowerCase('pl')

    return queryTokens.every(token => haystack.includes(token))
  })
})

function kindLabel(team: TeamNode) {
  return kindItems.find(item => item.value === team.kind)?.label ?? 'Inny'
}

function teamIcon(team: TeamNode) {
  if (team.kind === 'department') return 'i-lucide-panels-top-left'
  if (team.kind === 'division') return 'i-lucide-blocks'
  return 'i-lucide-users-round'
}

function teamInitials(team: TeamNode) {
  return team.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toLocaleUpperCase('pl')
}

function accessLevel(team: TeamListNode): TeamAccessLevel {
  if (team.accessLevel) return team.accessLevel
  if (isOrganizationScope.value) return 'organization_admin'
  if (directAdminTeamIds.value.has(team.id)) return 'team_admin'
  return 'inherited'
}

function accessBadge(team: TeamListNode) {
  const level = accessLevel(team)
  if (level === 'organization_admin') {
    return { label: 'Pełny dostęp', color: 'neutral' as const, icon: 'i-lucide-shield-check' }
  }
  if (level === 'team_admin') {
    return { label: 'Zarządzasz', color: 'success' as const, icon: 'i-lucide-user-round-cog' }
  }
  return { label: 'Zakres dziedziczony', color: 'info' as const, icon: 'i-lucide-git-branch' }
}

function openCreate() {
  Object.assign(form, { name: '', slug: '', kind: 'team', description: '' })
  createOpen.value = true
}

async function createTeam() {
  if (!graph.value.access.canCreate || !form.name.trim()) return
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
    toast.add({ title: 'Zespół został utworzony', color: 'success', icon: 'i-lucide-users-round' })
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
  <CrmShell
    :title="pageTitle"
    eyebrow="Administracja zespołu"
    :description="pageDescription"
  >
    <template #meta>
      <div class="team-index__scope">
        <UBadge
          color="neutral"
          variant="outline"
          :icon="isOrganizationScope ? 'i-lucide-building-2' : 'i-lucide-shield-check'"
        >
          {{ isOrganizationScope ? 'Cała organizacja' : 'Twój zakres zarządzania' }}
        </UBadge>
        <span>{{ graph.teams.length }} {{ graph.teams.length === 1 ? 'dostępny zespół' : 'dostępnych zespołów' }}</span>
      </div>
    </template>

    <template #actions>
      <UButton v-if="graph.access.canCreate" icon="i-lucide-plus" @click="openCreate">
        Nowy zespół
      </UButton>
    </template>

    <section class="team-index">
      <div class="team-index__summary">
        <article class="team-stat">
          <span class="team-stat__icon"><UIcon name="i-lucide-users-round" /></span>
          <div>
            <small>Dostępne zespoły</small>
            <strong>{{ graph.teams.length }}</strong>
            <p>{{ isOrganizationScope ? 'w całej organizacji' : 'w Twoim zakresie' }}</p>
          </div>
        </article>
        <article class="team-stat">
          <span class="team-stat__icon"><UIcon name="i-lucide-user-round-check" /></span>
          <div>
            <small>Unikalni członkowie</small>
            <strong>{{ uniqueMemberCount }}</strong>
            <p>osoby w strukturze</p>
          </div>
        </article>
        <article class="team-stat">
          <span class="team-stat__icon"><UIcon name="i-lucide-git-fork" /></span>
          <div>
            <small>Zespoły główne</small>
            <strong>{{ rootTeamIds.size }}</strong>
            <p>bez nadrzędnego zespołu</p>
          </div>
        </article>
        <article class="team-stat">
          <span class="team-stat__icon"><UIcon name="i-lucide-user-round-cog" /></span>
          <div>
            <small>W zarządzaniu</small>
            <strong>{{ managedTeamIds.size }}</strong>
            <p>{{ directAdminTeamIds.size }} bezpośrednio</p>
          </div>
        </article>
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

      <UCard class="team-index__card">
        <template #header>
          <div class="team-index__toolbar">
            <div class="team-index__toolbar-copy">
              <span>Struktura operacyjna</span>
              <h2>Dostępne zespoły</h2>
              <p>Wyszukuj po nazwie, opisie lub członku i przejdź do wyników całego zespołu.</p>
            </div>
            <UInput
              v-model="search"
              icon="i-lucide-search"
              placeholder="Nazwa, członek lub opis zespołu"
              aria-label="Szukaj zespołów"
            />
          </div>
        </template>

        <div v-if="status === 'pending'" class="team-index__rows">
          <USkeleton v-for="index in 5" :key="index" class="h-24 w-full" />
        </div>

        <div v-else-if="visibleTeams.length" class="team-index__rows">
          <NuxtLink
            v-for="team in visibleTeams"
            :key="team.id"
            :to="orgPath(`/teams/${team.id}`)"
            class="team-row"
          >
            <span class="team-row__avatar" aria-hidden="true">
              {{ teamInitials(team) }}
            </span>
            <span class="team-row__identity">
              <span class="team-row__title">
                <strong>{{ team.name }}</strong>
                <UBadge color="neutral" variant="subtle" size="sm">
                  <UIcon :name="teamIcon(team)" />
                  {{ kindLabel(team) }}
                </UBadge>
              </span>
              <small>{{ team.description || `Identyfikator: ${team.slug}` }}</small>
            </span>
            <span class="team-row__metrics">
              <span>
                <strong>{{ memberCountByTeam.get(team.id) ?? 0 }}</strong>
                <small>członków</small>
              </span>
              <span>
                <strong>{{ childCountByTeam.get(team.id) ?? 0 }}</strong>
                <small>podzespołów</small>
              </span>
            </span>
            <span class="team-row__badges">
              <UBadge
                :color="accessBadge(team).color"
                variant="subtle"
                :icon="accessBadge(team).icon"
              >
                {{ accessBadge(team).label }}
              </UBadge>
              <UBadge v-if="rootTeamIds.has(team.id)" color="neutral" variant="outline">
                Zespół główny
              </UBadge>
            </span>
            <span class="team-row__open">
              Otwórz
              <UIcon name="i-lucide-arrow-right" />
            </span>
          </NuxtLink>
        </div>

        <OeEmptyState
          v-else
          :kind="graph.teams.length ? 'filtered' : 'empty'"
          :icon="graph.teams.length ? 'i-lucide-search-x' : 'i-lucide-users-round'"
          :title="graph.teams.length ? 'Brak pasujących zespołów' : 'Nie masz jeszcze dostępnych zespołów'"
          :description="graph.teams.length
            ? 'Spróbuj wyszukać inną nazwę, osobę lub słowo z opisu.'
            : graph.access.canCreate
              ? 'Utwórz pierwszy zespół, przypisz jego lidera i dodaj członków.'
              : 'Poproś administratora organizacji o przypisanie Cię do zespołu.'"
        >
          <template #actions>
            <UButton v-if="graph.teams.length" color="neutral" variant="outline" icon="i-lucide-x" @click="search = ''">
              Wyczyść wyszukiwanie
            </UButton>
            <UButton
              v-if="graph.access.canCreate && !graph.teams.length"
              icon="i-lucide-plus"
              @click="openCreate"
            >
              Utwórz zespół
            </UButton>
          </template>
        </OeEmptyState>
      </UCard>
    </section>

    <UModal
      v-model:open="createOpen"
      title="Nowy zespół"
      description="Po utworzeniu przejdziesz do jego członków, placówek i ustawień."
      :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }"
    >
      <template #body>
        <form id="team-create-form" class="team-create-form" @submit.prevent="createTeam">
          <div class="team-create-form__grid">
            <UFormField label="Nazwa" required>
              <UInput v-model="form.name" class="w-full" autofocus />
            </UFormField>
            <UFormField label="Slug" description="Opcjonalny — wygeneruje się z nazwy.">
              <UInput v-model="form.slug" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Typ zespołu">
            <USelect v-model="form.kind" :items="kindItems" class="w-full" />
          </UFormField>
          <UFormField label="Opis" description="Krótko opisz odpowiedzialność i obszar działania zespołu.">
            <UTextarea v-model="form.description" class="w-full" :rows="4" />
          </UFormField>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="team-create-form"
          icon="i-lucide-users-round"
          :disabled="!form.name.trim()"
          :loading="saving"
        >
          Utwórz zespół
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.team-index {
  display: grid;
  gap: 22px;
}

.team-index__scope {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.team-index__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.team-stat {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
  padding: 17px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.team-stat__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
}

.team-stat > div {
  display: grid;
  min-width: 0;
}

.team-stat small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .07em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.team-stat strong {
  margin-top: 5px;
  color: var(--ui-text-highlighted);
  font-size: 26px;
  line-height: 1;
}

.team-stat p {
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-index__card {
  overflow: hidden;
}

.team-index__toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.team-index__toolbar-copy > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.team-index__toolbar h2 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.team-index__toolbar p {
  max-width: 650px;
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.team-index__toolbar > :last-child {
  width: min(380px, 100%);
}

.team-index__rows {
  display: grid;
  gap: 8px;
}

.team-row {
  display: grid;
  grid-template-columns: 46px minmax(240px, 1.5fr) minmax(150px, .6fr) minmax(150px, auto) 72px;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  color: inherit;
  text-decoration: none;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.team-row:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
  transform: translateY(-1px);
}

.team-row__avatar {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-accented);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .04em;
}

.team-row__identity {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.team-row__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.team-row__title > strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-row__identity > small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-row__metrics {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 22px;
}

.team-row__metrics > span {
  display: grid;
  gap: 2px;
  min-width: 52px;
  text-align: right;
}

.team-row__metrics strong {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 13px;
}

.team-row__metrics small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.team-row__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.team-row__open {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.team-row:hover .team-row__open {
  color: var(--ui-text-highlighted);
}

.team-index__empty {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 290px;
  padding: 28px;
  text-align: center;
}

.team-index__empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
}

.team-index__empty-icon :deep(.iconify) {
  width: 22px;
  height: 22px;
}

.team-index__empty h3,
.team-index__empty p {
  margin: 0;
}

.team-index__empty p {
  max-width: 480px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.team-create-form {
  display: grid;
  gap: 16px;
}

.team-create-form__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 1180px) {
  .team-index__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-row {
    grid-template-columns: 46px minmax(220px, 1fr) minmax(140px, auto) 70px;
  }

  .team-row__metrics {
    display: none;
  }
}

@media (max-width: 760px) {
  .team-index__summary {
    grid-template-columns: 1fr;
  }

  .team-index__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .team-index__toolbar > :last-child {
    width: 100%;
  }

  .team-row {
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: 12px;
  }

  .team-row__avatar {
    width: 42px;
    height: 42px;
  }

  .team-row__badges {
    display: none;
  }

  .team-row__open {
    width: 20px;
    font-size: 0;
  }

  .team-create-form__grid {
    grid-template-columns: 1fr;
  }
}
</style>
