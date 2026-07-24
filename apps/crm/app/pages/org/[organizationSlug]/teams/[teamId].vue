<script setup lang="ts">
import type {
  OrganizationMember,
  TeamEdge,
  TeamGraphPayload,
  TeamMembership,
  TeamNode,
} from '~/types/organization'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const teamId = computed(() => Array.isArray(route.params.teamId)
  ? String(route.params.teamId[0] ?? '')
  : String(route.params.teamId ?? ''))
const saving = ref(false)
const deleteOpen = ref(false)
const relationForm = reactive({ direction: 'child' as 'parent' | 'child', teamId: '' })
const membershipUserId = ref('')
const organizationMemberForm = reactive({ email: '', role: 'expert' as 'expert' | 'admin' })
const teamForm = reactive({ name: '', slug: '', kind: 'team', description: '' })

const kindItems = [
  { label: 'Zespół', value: 'team' },
  { label: 'Dział', value: 'department' },
  { label: 'Dywizja', value: 'division' },
  { label: 'Inny', value: 'other' },
]
const directionItems = [
  { label: 'Zespół podrzędny', value: 'child' },
  { label: 'Zespół nadrzędny', value: 'parent' },
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

const team = computed(() => graph.value.teams.find(item => item.id === teamId.value) ?? null)
const isAdmin = computed(() => graph.value.organization.role === 'admin')
const teamById = computed(() => new Map(graph.value.teams.map(item => [item.id, item])))
const memberById = computed(() => new Map(graph.value.members.map(member => [member.userId, member])))
const parentEdges = computed(() => graph.value.edges.filter(edge => edge.child_team_id === teamId.value))
const childEdges = computed(() => graph.value.edges.filter(edge => edge.parent_team_id === teamId.value))
const directMemberships = computed(() => graph.value.memberships.filter(item => item.team_id === teamId.value))
const directUserIds = computed(() => new Set(directMemberships.value.map(item => item.user_id)))
const memberItems = computed(() => graph.value.members
  .filter(member => !directUserIds.value.has(member.userId))
  .map(member => ({ label: memberLabel(member), value: member.userId })))
const relationTeamItems = computed(() => {
  const linkedIds = new Set(relationForm.direction === 'child'
    ? childEdges.value.map(edge => edge.child_team_id)
    : parentEdges.value.map(edge => edge.parent_team_id))
  return graph.value.teams
    .filter(item => item.id !== teamId.value && !linkedIds.has(item.id))
    .map(item => ({ label: item.name, value: item.id }))
})

useHead(() => ({ title: `${team.value?.name || 'Szczegóły zespołu'} — OpenExpert CRM` }))

watch(team, (value) => {
  if (!value) return
  Object.assign(teamForm, {
    name: value.name,
    slug: value.slug,
    kind: value.kind,
    description: value.description ?? '',
  })
}, { immediate: true })

watch(() => relationForm.direction, () => {
  relationForm.teamId = ''
})

function memberLabel(member?: OrganizationMember) {
  return member?.fullName || member?.email || 'Nieznany użytkownik'
}

function teamLabel(id: string) {
  return teamById.value.get(id)?.name ?? 'Nieznany zespół'
}

function showMutationError(title: string, mutationError: unknown) {
  toast.add({
    title,
    description: apiErrorMessage(mutationError),
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
}

function openDeleteDialog() {
  deleteOpen.value = true
}

async function saveTeam() {
  if (!isAdmin.value || !team.value || !teamForm.name.trim()) return
  saving.value = true
  try {
    await $fetch(orgApiPath(`/teams/${team.value.id}`), {
      method: 'PATCH',
      body: {
        name: teamForm.name.trim(),
        slug: teamForm.slug.trim(),
        kind: teamForm.kind,
        description: teamForm.description.trim() || null,
      },
    })
    await refresh()
    toast.add({ title: 'Zapisano dane zespołu', color: 'success', icon: 'i-lucide-check' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się zapisać zespołu', mutationError)
  } finally {
    saving.value = false
  }
}

async function addRelation() {
  if (!isAdmin.value || !team.value || !relationForm.teamId) return
  saving.value = true
  const body = relationForm.direction === 'child'
    ? { parent_team_id: team.value.id, child_team_id: relationForm.teamId }
    : { parent_team_id: relationForm.teamId, child_team_id: team.value.id }
  try {
    await $fetch(orgApiPath('/team-edges'), { method: 'POST', body })
    relationForm.teamId = ''
    await refresh()
    toast.add({ title: 'Dodano relację zespołów', color: 'success', icon: 'i-lucide-git-branch-plus' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się dodać relacji', mutationError)
  } finally {
    saving.value = false
  }
}

async function removeRelation(edge: TeamEdge) {
  if (!isAdmin.value) return
  try {
    await $fetch(orgApiPath(`/team-edges/${edge.parent_team_id}/${edge.child_team_id}`), { method: 'DELETE' })
    await refresh()
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się usunąć relacji', mutationError)
  }
}

async function addMembership() {
  if (!isAdmin.value || !team.value || !membershipUserId.value) return
  saving.value = true
  try {
    await $fetch(orgApiPath('/team-memberships'), {
      method: 'POST',
      body: { team_id: team.value.id, user_id: membershipUserId.value },
    })
    membershipUserId.value = ''
    await refresh()
    toast.add({ title: 'Dodano członka zespołu', color: 'success', icon: 'i-lucide-user-plus' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się dodać członka', mutationError)
  } finally {
    saving.value = false
  }
}

async function removeMembership(membership: TeamMembership) {
  if (!isAdmin.value) return
  try {
    await $fetch(orgApiPath(`/team-memberships/${membership.team_id}/${membership.user_id}`), { method: 'DELETE' })
    await refresh()
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się usunąć członka', mutationError)
  }
}

async function addOrganizationMember() {
  if (!isAdmin.value || !organizationMemberForm.email.trim()) return
  saving.value = true
  try {
    await $fetch(orgApiPath('/members'), {
      method: 'POST',
      body: { email: organizationMemberForm.email.trim(), role: organizationMemberForm.role },
    })
    Object.assign(organizationMemberForm, { email: '', role: 'expert' })
    await refresh()
    toast.add({ title: 'Dodano konto do organizacji', color: 'success', icon: 'i-lucide-user-check' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się dodać konta', mutationError)
  } finally {
    saving.value = false
  }
}

async function deleteTeam() {
  if (!isAdmin.value || !team.value) return
  saving.value = true
  try {
    await $fetch(orgApiPath(`/teams/${team.value.id}`), { method: 'DELETE' })
    deleteOpen.value = false
    toast.add({ title: 'Zespół został usunięty', color: 'success', icon: 'i-lucide-trash-2' })
    await navigateTo(orgPath('/teams'))
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się usunąć zespołu', mutationError)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CrmShell
    :title="team?.name || 'Szczegóły zespołu'"
    eyebrow="Administracja organizacji"
    description="Członkowie, relacje i zakres odpowiedzialności zespołu."
    :back-to="orgPath('/teams')"
    back-label="Wróć do zespołów"
  >

    <div v-if="status === 'pending'" class="team-detail__loading">
      <USkeleton class="h-28 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać zespołu"
      :description="apiErrorMessage(error)"
    />

    <UAlert
      v-else-if="!team"
      color="warning"
      icon="i-lucide-network"
      title="Nie znaleziono zespołu"
      description="Zespół nie istnieje albo nie masz do niego dostępu."
      :actions="[{ label: 'Wróć do listy', to: orgPath('/teams') }]"
    />

    <section v-else class="team-detail">
      <header class="team-detail__hero">
        <span class="team-detail__icon"><UIcon name="i-lucide-network" /></span>
        <div>
          <div class="team-detail__title">
            <h2>{{ team.name }}</h2>
            <UBadge color="neutral" variant="subtle">{{ kindItems.find(item => item.value === team?.kind)?.label }}</UBadge>
          </div>
          <p>{{ team.description || 'Opis zespołu nie został jeszcze uzupełniony.' }}</p>
        </div>
        <code>{{ team.slug }}</code>
      </header>

      <div class="team-detail__grid">
        <UCard>
          <template #header>
            <div class="team-detail__section-heading">
              <div><h3>Dane zespołu</h3><p>Nazwa i miejsce w strukturze organizacji.</p></div>
              <UBadge :color="isAdmin ? 'primary' : 'neutral'" variant="outline">
                {{ isAdmin ? 'Możesz edytować' : 'Tylko odczyt' }}
              </UBadge>
            </div>
          </template>
          <form class="team-detail__form" @submit.prevent="saveTeam">
            <UFormField label="Nazwa" required><UInput v-model="teamForm.name" class="w-full" :disabled="!isAdmin" /></UFormField>
            <UFormField label="Slug"><UInput v-model="teamForm.slug" class="w-full" :disabled="!isAdmin" /></UFormField>
            <UFormField label="Typ"><USelect v-model="teamForm.kind" :items="kindItems" class="w-full" :disabled="!isAdmin" /></UFormField>
            <UFormField label="Opis"><UTextarea v-model="teamForm.description" class="w-full" :rows="4" :disabled="!isAdmin" /></UFormField>
            <UButton v-if="isAdmin" type="submit" icon="i-lucide-save" :loading="saving">Zapisz zmiany</UButton>
          </form>
        </UCard>

        <UCard>
          <template #header><div><h3>Członkowie</h3><p>Bezpośrednie przypisania do tego zespołu.</p></div></template>
          <div class="team-detail__stack">
            <form v-if="isAdmin" class="team-detail__inline" @submit.prevent="addMembership">
              <USelectMenu v-model="membershipUserId" :items="memberItems" value-key="value" placeholder="Wybierz osobę" class="w-full" />
              <UButton type="submit" icon="i-lucide-user-plus" :disabled="!membershipUserId" :loading="saving">Dodaj</UButton>
            </form>
            <div v-if="directMemberships.length" class="team-detail__list">
              <div v-for="membership in directMemberships" :key="membership.user_id" class="team-detail__list-row">
                <span class="team-detail__avatar"><UIcon name="i-lucide-user-round" /></span>
                <span><strong>{{ memberLabel(memberById.get(membership.user_id)) }}</strong><small>Członek zespołu</small></span>
                <UButton v-if="isAdmin" icon="i-lucide-x" color="neutral" variant="ghost" square aria-label="Usuń członka" @click="removeMembership(membership)" />
              </div>
            </div>
            <p v-else class="team-detail__empty-copy">Ten zespół nie ma jeszcze bezpośrednich członków.</p>

            <details v-if="isAdmin" class="team-detail__add-account">
              <summary>Nie ma tej osoby na liście? Dodaj konto do organizacji</summary>
              <form class="team-detail__account-form" @submit.prevent="addOrganizationMember">
                <UInput v-model="organizationMemberForm.email" type="email" placeholder="email@firma.pl" required />
                <USelect v-model="organizationMemberForm.role" :items="[{ label: 'Ekspert', value: 'expert' }, { label: 'Administrator', value: 'admin' }]" />
                <UButton type="submit" color="neutral" variant="outline" :loading="saving">Dodaj konto</UButton>
              </form>
            </details>
          </div>
        </UCard>
      </div>

      <UCard>
        <template #header><div><h3>Relacje w strukturze</h3><p>Zespoły nadrzędne i podrzędne. System nie pozwoli utworzyć cyklu.</p></div></template>
        <div class="team-relations">
          <section>
            <span class="team-relations__label">Nadrzędne</span>
            <div v-if="parentEdges.length" class="team-relations__items">
              <div v-for="edge in parentEdges" :key="edge.parent_team_id" class="team-relation">
                <NuxtLink :to="orgPath(`/teams/${edge.parent_team_id}`)">{{ teamLabel(edge.parent_team_id) }}</NuxtLink>
                <UButton v-if="isAdmin" icon="i-lucide-unlink" variant="ghost" square aria-label="Usuń relację" @click="removeRelation(edge)" />
              </div>
            </div>
            <p v-else>To zespół najwyższego poziomu.</p>
          </section>
          <section>
            <span class="team-relations__label">Podrzędne</span>
            <div v-if="childEdges.length" class="team-relations__items">
              <div v-for="edge in childEdges" :key="edge.child_team_id" class="team-relation">
                <NuxtLink :to="orgPath(`/teams/${edge.child_team_id}`)">{{ teamLabel(edge.child_team_id) }}</NuxtLink>
                <UButton v-if="isAdmin" icon="i-lucide-unlink" variant="ghost" square aria-label="Usuń relację" @click="removeRelation(edge)" />
              </div>
            </div>
            <p v-else>Brak zespołów podrzędnych.</p>
          </section>
        </div>
        <form v-if="isAdmin" class="team-detail__relation-form" @submit.prevent="addRelation">
          <USelect v-model="relationForm.direction" :items="directionItems" />
          <USelectMenu v-model="relationForm.teamId" :items="relationTeamItems" value-key="value" placeholder="Wybierz zespół" class="w-full" />
          <UButton type="submit" icon="i-lucide-git-branch-plus" :disabled="!relationForm.teamId" :loading="saving">Połącz</UButton>
        </form>
      </UCard>

      <UCard v-if="isAdmin" class="team-detail__danger">
        <div><h3>Usuń zespół</h3><p>Usunięte zostaną również jego relacje i bezpośrednie członkostwa.</p></div>
        <UButton color="error" variant="outline" icon="i-lucide-trash-2" @click="openDeleteDialog">Usuń zespół</UButton>
      </UCard>
    </section>

    <UModal v-model:open="deleteOpen" title="Usunąć zespół?" description="Tej operacji nie można cofnąć." :ui="{ footer: 'justify-end' }">
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="saving" @click="deleteTeam">Usuń zespół</UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.team-detail, .team-detail__loading, .team-detail__stack, .team-detail__form { display: grid; gap: 20px; }
.team-detail__hero { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 22px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.team-detail__icon, .team-detail__avatar { display: grid; place-items: center; flex: none; border: 1px solid var(--ui-border); border-radius: 11px; background: var(--ui-bg-muted); }
.team-detail__icon { width: 52px; height: 52px; font-size: 21px; }
.team-detail__title, .team-detail__section-heading, .team-detail__inline, .team-detail__list-row, .team-detail__danger, .team-detail__relation-form { display: flex; align-items: center; gap: 12px; }
.team-detail__title h2, .team-detail h3 { margin: 0; }
.team-detail__hero p, .team-detail__section-heading p, .team-detail__danger p, .team-detail__empty-copy, .team-relations p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.team-detail__hero code { color: var(--ui-text-muted); }
.team-detail__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.team-detail__section-heading, .team-detail__danger { justify-content: space-between; }
.team-detail__inline > :first-child { flex: 1; }
.team-detail__list { display: grid; gap: 7px; }
.team-detail__list-row { padding: 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); }
.team-detail__avatar { width: 36px; height: 36px; }
.team-detail__list-row > span:nth-child(2) { display: grid; flex: 1; min-width: 0; }
.team-detail__list-row small { color: var(--ui-text-muted); }
.team-detail__add-account { padding-top: 14px; border-top: 1px solid var(--ui-border); }
.team-detail__add-account summary { color: var(--ui-text-muted); cursor: pointer; font-size: 13px; }
.team-detail__account-form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; margin-top: 12px; }
.team-relations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.team-relations > section { display: grid; align-content: start; gap: 10px; min-height: 130px; padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg-muted); }
.team-relations__label { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.team-relations__items { display: grid; gap: 6px; }
.team-relation { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.team-relation a { color: var(--ui-text-highlighted); text-decoration: none; }
.team-detail__relation-form { padding-top: 18px; border-top: 1px solid var(--ui-border); }
.team-detail__relation-form > :nth-child(2) { flex: 1; }
.team-detail__danger { border-color: color-mix(in srgb, var(--ui-error) 35%, var(--ui-border)); }
@media (max-width: 900px) {
  .team-detail__grid, .team-relations { grid-template-columns: 1fr; }
  .team-detail__hero { grid-template-columns: 44px minmax(0, 1fr); }
  .team-detail__hero code { grid-column: 2; }
  .team-detail__account-form, .team-detail__relation-form { display: grid; grid-template-columns: 1fr; }
}
</style>
