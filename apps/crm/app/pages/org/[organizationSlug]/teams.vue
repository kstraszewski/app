<script setup lang="ts">
import type {
  OrganizationMember,
  TeamEdge,
  TeamGraphPayload,
  TeamMembership,
  TeamNode,
} from '~/types/organization'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Zespoły — OpenExpert CRM' })

const { orgApiPath } = useOrganizationContext()
const toast = useToast()
const currentUser = useSupabaseUser()
const saving = ref(false)
const teamForm = reactive({ name: '', kind: 'team', description: '' })
const edgeForm = reactive({ parent_team_id: '', child_team_id: '' })
const membershipForm = reactive({ team_id: '', user_id: '', role: 'member' })
const organizationMemberForm = reactive({ email: '', role: 'expert' })
const teamRoleItems = [
  { label: 'Administrator', value: 'admin' },
  { label: 'Członek', value: 'member' },
]

const emptyGraph: TeamGraphPayload = {
  organization: { id: '', name: '', slug: '', role: 'expert', isDefault: false },
  teams: [],
  edges: [],
  memberships: [],
  members: [],
}

const { data: graph, pending, error, refresh } = await useFetch<TeamGraphPayload>(
  () => orgApiPath('/teams'),
  { default: () => emptyGraph },
)

const isAdmin = computed(() => graph.value.organization.role === 'admin')
const teamItems = computed(() => graph.value.teams.map((team) => ({ label: team.name, value: team.id })))
const teamAdminIds = computed(() => new Set(
  graph.value.memberships
    .filter(membership => membership.user_id === currentUser.value?.sub && membership.role === 'admin')
    .map(membership => membership.team_id),
))
const canManageMemberships = computed(() => isAdmin.value || teamAdminIds.value.size > 0)
const manageableTeamItems = computed(() => isAdmin.value
  ? teamItems.value
  : teamItems.value.filter(team => teamAdminIds.value.has(team.value)))
const memberItems = computed(() => graph.value.members.map((member) => ({
  label: member.fullName || member.email,
  value: member.userId,
})))

const teamById = computed(() => new Map(graph.value.teams.map((team) => [team.id, team])))
const memberById = computed(() => new Map(graph.value.members.map((member) => [member.userId, member])))

const parentsByTeam = computed(() => groupEdges(graph.value.edges, 'child_team_id', 'parent_team_id'))
const childrenByTeam = computed(() => groupEdges(graph.value.edges, 'parent_team_id', 'child_team_id'))
const membersByTeam = computed(() => {
  const grouped = new Map<string, TeamMembership[]>()
  for (const membership of graph.value.memberships) {
    grouped.set(membership.team_id, [...(grouped.get(membership.team_id) ?? []), membership])
  }
  return grouped
})

const graphLevels = computed(() => {
  const teams = graph.value.teams
  const indegree = new Map(teams.map((team) => [team.id, 0]))
  for (const edge of graph.value.edges) indegree.set(edge.child_team_id, (indegree.get(edge.child_team_id) ?? 0) + 1)

  const remaining = new Set(teams.map((team) => team.id))
  const levels: TeamNode[][] = []
  let frontier = teams.filter((team) => indegree.get(team.id) === 0).map((team) => team.id)

  while (frontier.length) {
    const currentIds = [...frontier]
    const currentTeams = currentIds.map((id) => teamById.value.get(id)).filter(Boolean) as TeamNode[]
    levels.push(currentTeams)
    frontier = []

    for (const id of currentIds) {
      remaining.delete(id)
      for (const childId of childrenByTeam.value.get(id) ?? []) {
        const nextDegree = (indegree.get(childId) ?? 1) - 1
        indegree.set(childId, nextDegree)
        if (nextDegree === 0) frontier.push(childId)
      }
    }
  }

  if (remaining.size) {
    levels.push([...remaining].map((id) => teamById.value.get(id)).filter(Boolean) as TeamNode[])
  }
  return levels
})

function groupEdges(edges: TeamEdge[], key: 'parent_team_id' | 'child_team_id', value: 'parent_team_id' | 'child_team_id') {
  const grouped = new Map<string, string[]>()
  for (const edge of edges) grouped.set(edge[key], [...(grouped.get(edge[key]) ?? []), edge[value]])
  return grouped
}

function memberLabel(member?: OrganizationMember) {
  return member?.fullName || member?.email || 'Nieznany użytkownik'
}

async function createTeam() {
  if (!teamForm.name.trim()) return
  saving.value = true
  try {
    await $fetch(orgApiPath('/teams'), { method: 'POST', body: teamForm })
    Object.assign(teamForm, { name: '', kind: 'team', description: '' })
    await refresh()
    toast.add({ title: 'Dodano zespół', color: 'success' })
  } finally {
    saving.value = false
  }
}

async function addEdge() {
  if (!edgeForm.parent_team_id || !edgeForm.child_team_id) return
  saving.value = true
  try {
    await $fetch(orgApiPath('/team-edges'), { method: 'POST', body: edgeForm })
    Object.assign(edgeForm, { parent_team_id: '', child_team_id: '' })
    await refresh()
    toast.add({ title: 'Dodano relację w DAG', color: 'success' })
  } finally {
    saving.value = false
  }
}

async function removeEdge(edge: TeamEdge) {
  await $fetch(orgApiPath(`/team-edges/${edge.parent_team_id}/${edge.child_team_id}`), { method: 'DELETE' })
  await refresh()
}

async function addMembership() {
  if (!membershipForm.team_id || !membershipForm.user_id) return
  saving.value = true
  try {
    await $fetch(orgApiPath('/team-memberships'), { method: 'POST', body: membershipForm })
    Object.assign(membershipForm, { team_id: '', user_id: '', role: 'member' })
    await refresh()
    toast.add({ title: 'Dodano bezpośrednie członkostwo', color: 'success' })
  } finally {
    saving.value = false
  }
}

async function addOrganizationMember() {
  if (!organizationMemberForm.email.trim()) return
  saving.value = true
  try {
    await $fetch(orgApiPath('/members'), { method: 'POST', body: organizationMemberForm })
    Object.assign(organizationMemberForm, { email: '', role: 'expert' })
    await refresh()
    toast.add({ title: 'Dodano użytkownika do organizacji', color: 'success' })
  } finally {
    saving.value = false
  }
}

async function removeMembership(membership: TeamMembership) {
  await $fetch(orgApiPath(`/team-memberships/${membership.team_id}/${membership.user_id}`), { method: 'DELETE' })
  await refresh()
}

async function updateMembershipRole(membership: TeamMembership, role: unknown) {
  if (role !== 'admin' && role !== 'member') return
  if (role === membership.role) return
  await $fetch(orgApiPath(`/team-memberships/${membership.team_id}/${membership.user_id}`), {
    method: 'PATCH',
    body: { role },
  })
  await refresh()
  toast.add({ title: 'Rola w zespole została zmieniona', color: 'success' })
}

async function removeTeam(team: TeamNode) {
  await $fetch(orgApiPath(`/teams/${team.id}`), { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <CrmShell title="Zespoły" eyebrow="Struktura organizacji">
    <template #actions>
      <UBadge color="primary" variant="subtle" icon="i-lucide-network">
        DAG · {{ graph.teams.length }} węzłów
      </UBadge>
    </template>

    <UAlert
      class="teams-block"
      color="info"
      variant="subtle"
      icon="i-lucide-git-fork"
      title="Wiele poziomów i wielu rodziców"
      description="Zespół może mieć kilku rodziców. Członkostwa są wyłącznie bezpośrednie i nie dziedziczą się przez graf."
    />

    <UAlert
      v-if="error"
      class="teams-block"
      color="error"
      variant="subtle"
      title="Nie udało się pobrać struktury"
    >
      <template #actions><UButton variant="ghost" @click="refresh()">Ponów</UButton></template>
    </UAlert>

    <div v-if="pending" class="teams-loading"><USkeleton v-for="index in 6" :key="index" class="h-40 w-full" /></div>

    <template v-else>
      <div v-if="isAdmin || canManageMemberships" class="teams-forms teams-block">
        <UCard v-if="isAdmin">
          <template #header><h2>Nowy węzeł</h2></template>
          <form class="teams-form" @submit.prevent="createTeam">
            <UFormField label="Nazwa"><UInput v-model="teamForm.name" required /></UFormField>
            <UFormField label="Typ">
              <USelect v-model="teamForm.kind" :items="[
                { label: 'Zespół', value: 'team' },
                { label: 'Dział', value: 'department' },
                { label: 'Dywizja', value: 'division' },
                { label: 'Inny', value: 'other' },
              ]" />
            </UFormField>
            <UFormField label="Opis"><UInput v-model="teamForm.description" /></UFormField>
            <UButton type="submit" icon="i-lucide-plus" :loading="saving">Dodaj</UButton>
          </form>
        </UCard>

        <UCard v-if="isAdmin">
          <template #header><h2>Nowa krawędź</h2></template>
          <form class="teams-form" @submit.prevent="addEdge">
            <UFormField label="Rodzic"><USelect v-model="edgeForm.parent_team_id" :items="teamItems" /></UFormField>
            <UFormField label="Dziecko"><USelect v-model="edgeForm.child_team_id" :items="teamItems" /></UFormField>
            <UButton type="submit" icon="i-lucide-git-branch-plus" :loading="saving">Połącz</UButton>
          </form>
        </UCard>

        <UCard v-if="canManageMemberships">
          <template #header><h2>Bezpośredni członek</h2></template>
          <form class="teams-form" @submit.prevent="addMembership">
            <UFormField label="Zespół"><USelect v-model="membershipForm.team_id" :items="manageableTeamItems" /></UFormField>
            <UFormField label="Użytkownik"><USelect v-model="membershipForm.user_id" :items="memberItems" /></UFormField>
            <UFormField label="Rola">
              <USelect v-model="membershipForm.role" :items="[
                { label: 'Członek', value: 'member' },
                { label: 'Administrator zespołu', value: 'admin' },
              ]" />
            </UFormField>
            <UButton type="submit" icon="i-lucide-user-plus" :loading="saving">Przypisz</UButton>
          </form>
        </UCard>

        <UCard v-if="isAdmin">
          <template #header><h2>Użytkownik organizacji</h2></template>
          <form class="teams-form" @submit.prevent="addOrganizationMember">
            <UFormField label="Email istniejącego konta">
              <UInput v-model="organizationMemberForm.email" type="email" required />
            </UFormField>
            <UFormField label="Rola w organizacji">
              <USelect v-model="organizationMemberForm.role" :items="[
                { label: 'Ekspert', value: 'expert' },
                { label: 'Administrator', value: 'admin' },
              ]" />
            </UFormField>
            <UButton type="submit" icon="i-lucide-building-2" :loading="saving">Dodaj do organizacji</UButton>
          </form>
        </UCard>
      </div>

      <UCard class="teams-block">
        <template #header>
          <div>
            <h2>Graf organizacji</h2>
            <p>Kolumny pokazują topologiczne poziomy DAG; węzeł może mieć wielu rodziców.</p>
          </div>
        </template>

        <div v-if="graph.teams.length" class="dag-board">
          <section v-for="(level, levelIndex) in graphLevels" :key="levelIndex" class="dag-level">
            <p class="dag-level__label">Poziom {{ levelIndex + 1 }}</p>
            <article v-for="team in level" :key="team.id" class="team-card">
              <div class="team-card__heading">
                <div>
                  <UBadge color="neutral" variant="outline">{{ team.kind }}</UBadge>
                  <h3>{{ team.name }}</h3>
                  <code>{{ team.slug }}</code>
                </div>
                <UButton
                  v-if="isAdmin"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  square
                  aria-label="Usuń zespół"
                  @click="removeTeam(team)"
                />
              </div>

              <p v-if="team.description" class="team-card__description">{{ team.description }}</p>

              <div class="team-card__section">
                <span>Rodzice</span>
                <div class="team-card__badges">
                  <UBadge
                    v-for="parentId in parentsByTeam.get(team.id) ?? []"
                    :key="parentId"
                    color="info"
                    variant="subtle"
                  >{{ teamById.get(parentId)?.name }}</UBadge>
                  <small v-if="!(parentsByTeam.get(team.id)?.length)">korzeń</small>
                </div>
              </div>

              <div class="team-card__section">
                <span>Bezpośredni członkowie</span>
                <div class="team-members">
                  <div v-for="membership in membersByTeam.get(team.id) ?? []" :key="membership.user_id" class="team-member">
                    <div>
                      <strong>{{ memberLabel(memberById.get(membership.user_id)) }}</strong>
                      <USelect
                        v-if="isAdmin || teamAdminIds.has(team.id)"
                        :model-value="membership.role"
                        :items="teamRoleItems"
                        value-key="value"
                        size="xs"
                        aria-label="Rola w zespole"
                        @update:model-value="role => updateMembershipRole(membership, role)"
                      />
                      <small v-else>{{ membership.role === 'admin' ? 'Administrator' : 'Członek' }}</small>
                    </div>
                    <UButton
                      v-if="isAdmin || teamAdminIds.has(team.id)"
                      icon="i-lucide-x"
                      variant="ghost"
                      square
                      aria-label="Usuń członkostwo"
                      @click="removeMembership(membership)"
                    />
                  </div>
                  <small v-if="!(membersByTeam.get(team.id)?.length)">brak przypisań</small>
                </div>
              </div>
            </article>
          </section>
        </div>

        <div v-else class="teams-empty">
          <UIcon name="i-lucide-network" />
          <h3>Brak zespołów</h3>
          <p>Administrator może dodać pierwszy węzeł struktury.</p>
        </div>
      </UCard>

      <UCard v-if="isAdmin && graph.edges.length" class="teams-block">
        <template #header><h2>Krawędzie DAG</h2></template>
        <div class="edge-list">
          <div v-for="edge in graph.edges" :key="`${edge.parent_team_id}-${edge.child_team_id}`" class="edge-row">
            <span>{{ teamById.get(edge.parent_team_id)?.name }}</span>
            <UIcon name="i-lucide-arrow-right" />
            <span>{{ teamById.get(edge.child_team_id)?.name }}</span>
            <UButton icon="i-lucide-unlink" variant="ghost" square aria-label="Usuń krawędź" @click="removeEdge(edge)" />
          </div>
        </div>
      </UCard>
    </template>
  </CrmShell>
</template>

<style scoped>
.teams-block { margin-bottom: 22px; }
.teams-loading,
.teams-forms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.teams-form { display: grid; gap: 14px; }
.teams-forms h2,
.dag-board h3 { margin: 0; }
.dag-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(270px, 1fr); gap: 18px; overflow-x: auto; padding-bottom: 12px; }
.dag-level { display: grid; align-content: start; gap: 12px; }
.dag-level__label { margin: 0; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; }
.team-card { display: grid; gap: 16px; padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg-muted); }
.team-card__heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.team-card h3 { margin: 8px 0 2px; }
.team-card code { color: var(--ui-text-muted); font-size: 11px; }
.team-card__description { margin: 0; color: var(--ui-text-muted); font-size: 13px; }
.team-card__section { display: grid; gap: 8px; }
.team-card__section > span { color: var(--ui-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
.team-card__badges { display: flex; flex-wrap: wrap; gap: 6px; }
.team-members { display: grid; gap: 6px; }
.team-member { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.team-member strong,
.team-member small { display: block; }
.team-member small,
.team-card small { color: var(--ui-text-muted); }
.edge-list { display: grid; gap: 8px; }
.edge-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); }
.teams-empty { padding: 48px; text-align: center; }
.teams-empty > .icon { font-size: 34px; }
@media (max-width: 1000px) {
  .teams-forms,
  .teams-loading { grid-template-columns: 1fr; }
}
</style>
