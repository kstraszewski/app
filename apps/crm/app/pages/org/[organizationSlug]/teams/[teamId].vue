<script setup lang="ts">
import type {
  TeamDetailPayload,
  TeamGraphPayload,
  TeamMembership,
  TeamNode,
} from '~/types/organization'
import type { OrganizationMembersPayload, Facility } from '~/types/scheduling'
import type { SalesPayload, SalesRangeKey, SalesRecentWin } from '~/types/sales'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })

type TeamView = 'overview' | 'calendar' | 'sales' | 'members' | 'facilities' | 'settings'

const route = useRoute()
const router = useRouter()
const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()

const teamId = computed(() => Array.isArray(route.params.teamId)
  ? String(route.params.teamId[0] ?? '')
  : String(route.params.teamId ?? ''))
const activeView = computed<TeamView>(() => {
  const raw = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  return raw === 'calendar' || raw === 'sales' || raw === 'members' || raw === 'facilities' || raw === 'settings'
    ? raw
    : 'overview'
})
const selectedRange = computed<SalesRangeKey>(() => {
  const raw = Array.isArray(route.query.range) ? route.query.range[0] : route.query.range
  return raw === '30d' || raw === '12m' ? raw : '90d'
})
const requestedCurrency = computed(() => {
  const raw = Array.isArray(route.query.currency) ? route.query.currency[0] : route.query.currency
  return typeof raw === 'string' && /^[a-z]{3}$/i.test(raw) ? raw.toUpperCase() : undefined
})

const {
  data: detail,
  status,
  error,
  refresh,
} = await useFetch<TeamDetailPayload>(() => orgApiPath(`/teams/${teamId.value}`))

const { data: memberDirectory } = await useFetch<OrganizationMembersPayload>(
  () => orgApiPath('/members'),
  {
    default: (): OrganizationMembersPayload => ({
      currentUserId: '',
      role: 'expert',
      canAssignOthers: false,
      members: [],
    }),
  },
)

const {
  data: graph,
  refresh: refreshGraph,
} = await useFetch<TeamGraphPayload>(() => orgApiPath('/teams'))

const {
  data: teamSalesPayload,
  status: salesStatus,
  error: salesError,
  refresh: refreshSales,
} = await useFetch<SalesPayload>(() => orgApiPath(`/teams/${teamId.value}/sales`), {
  query: {
    range: selectedRange,
    currency: requestedCurrency,
  },
  lazy: true,
})

const team = computed(() => detail.value?.data.team ?? null)
const members = computed(() => detail.value?.data.members ?? [])
const facilities = computed(() => detail.value?.data.facilities ?? [])
const parents = computed(() => detail.value?.data.parents ?? [])
const children = computed(() => detail.value?.data.children ?? [])
const stats = computed(() => detail.value?.data.stats ?? {
  memberCount: 0,
  adminCount: 0,
  facilityCount: 0,
  childTeamCount: 0,
})
const access = computed(() => detail.value?.access ?? {
  canView: false,
  canManage: false,
  canDelete: false,
  canManageStructure: false,
})
const isOrganizationAdmin = computed(() => detail.value?.organization.role === 'admin')

const kindItems = [
  { label: 'Zespół', value: 'team' },
  { label: 'Dział', value: 'department' },
  { label: 'Dywizja', value: 'division' },
  { label: 'Inny', value: 'other' },
]
const membershipRoleItems = [
  { label: 'Członek', value: 'member' },
  { label: 'Administrator zespołu', value: 'admin' },
]
const directionItems = [
  { label: 'Zespół podrzędny', value: 'child' },
  { label: 'Zespół nadrzędny', value: 'parent' },
]

const teamForm = reactive({ name: '', slug: '', kind: 'team', description: '' })
const memberForm = reactive({ userId: '', role: 'member' as TeamMembership['role'] })
const relationForm = reactive({ direction: 'child' as 'parent' | 'child', teamId: '' })
const saving = ref(false)
const memberModalOpen = ref(false)
const deleteModalOpen = ref(false)

const directUserIds = computed(() => new Set(members.value.map(item => item.membership.user_id)))
const availableMemberItems = computed(() => memberDirectory.value.members
  .filter(member => !directUserIds.value.has(member.userId))
  .map(member => ({
    label: memberLabel(member),
    description: member.email,
    value: member.userId,
  })))
const relationTeamItems = computed(() => {
  if (!graph.value) return []
  const linkedIds = new Set(relationForm.direction === 'child'
    ? children.value.map(child => child.id)
    : parents.value.map(parent => parent.id))
  return graph.value.teams
    .filter(item => item.id !== teamId.value && !linkedIds.has(item.id))
    .map(item => ({ label: item.name, value: item.id }))
})
const tabs = computed(() => [
  {
    label: 'Podsumowanie',
    icon: 'i-lucide-layout-dashboard',
    to: { path: route.path },
    active: activeView.value === 'overview',
  },
  {
    label: 'Kalendarz',
    icon: 'i-lucide-calendar-range',
    to: { path: route.path, query: { view: 'calendar' } },
    active: activeView.value === 'calendar',
  },
  {
    label: 'Sprzedaż',
    icon: 'i-lucide-chart-no-axes-combined',
    to: { path: route.path, query: { view: 'sales' } },
    active: activeView.value === 'sales',
  },
  {
    label: 'Członkowie',
    icon: 'i-lucide-users-round',
    count: stats.value.memberCount,
    to: { path: route.path, query: { view: 'members' } },
    active: activeView.value === 'members',
  },
  {
    label: 'Placówki',
    icon: 'i-lucide-building-2',
    count: stats.value.facilityCount,
    to: { path: route.path, query: { view: 'facilities' } },
    active: activeView.value === 'facilities',
  },
  {
    label: 'Ustawienia',
    icon: 'i-lucide-settings-2',
    to: { path: route.path, query: { view: 'settings' } },
    active: activeView.value === 'settings',
  },
])
const accessLabel = computed(() => {
  if (isOrganizationAdmin.value) return 'Pełny dostęp organizacji'
  if (access.value.canManage) return 'Zarządzasz zespołem'
  return 'Dostęp przez strukturę'
})

useHead(() => ({ title: `${team.value?.name || 'Zespół'} — OpenExpert CRM` }))

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

function kindLabel(value?: TeamNode['kind']) {
  return kindItems.find(item => item.value === value)?.label ?? 'Inny'
}

function memberLabel(member?: { email?: string | null, fullName?: string | null } | null) {
  return member?.fullName || member?.email || 'Nieznany użytkownik'
}

function memberInitials(member?: { email?: string | null, fullName?: string | null } | null) {
  const name = memberLabel(member)
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('')
}

function facilityAddress(facility: Facility) {
  return [
    facility.address_line1,
    [facility.postal_code, facility.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
}

function showMutationError(title: string, mutationError: unknown) {
  toast.add({
    title,
    description: apiErrorMessage(mutationError),
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
}

function updateQuery(patch: Record<string, string | undefined>) {
  const query = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) delete query[key]
  }
  return router.replace({ query })
}

function selectRange(range: SalesRangeKey) {
  void updateQuery({ range: range === '90d' ? undefined : range })
}

function selectCurrency(currency: string) {
  void updateQuery({ currency })
}

function caseLink(item: SalesRecentWin) {
  return orgPath(`/cases/${item.caseId}`)
}

function openMemberModal() {
  Object.assign(memberForm, { userId: '', role: 'member' })
  memberModalOpen.value = true
}

async function addMembership() {
  if (!access.value.canManage || !memberForm.userId) return
  saving.value = true
  try {
    await $fetch(orgApiPath('/team-memberships'), {
      method: 'POST',
      body: {
        team_id: teamId.value,
        user_id: memberForm.userId,
        role: memberForm.role,
      },
    })
    memberModalOpen.value = false
    await Promise.all([refresh(), refreshSales()])
    toast.add({ title: 'Dodano osobę do zespołu', color: 'success', icon: 'i-lucide-user-plus' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się dodać osoby', mutationError)
  } finally {
    saving.value = false
  }
}

async function updateMembershipRole(membership: TeamMembership, role: unknown) {
  if (!access.value.canManage || (role !== 'member' && role !== 'admin') || membership.role === role) return
  try {
    await $fetch(orgApiPath(`/team-memberships/${membership.team_id}/${membership.user_id}`), {
      method: 'PATCH',
      body: { role },
    })
    await refresh()
    toast.add({ title: 'Zmieniono rolę w zespole', color: 'success', icon: 'i-lucide-shield-check' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się zmienić roli', mutationError)
  }
}

async function removeMembership(membership: TeamMembership) {
  if (!access.value.canManage) return
  try {
    await $fetch(orgApiPath(`/team-memberships/${membership.team_id}/${membership.user_id}`), {
      method: 'DELETE',
    })
    await Promise.all([refresh(), refreshSales()])
    toast.add({ title: 'Usunięto osobę z zespołu', color: 'success', icon: 'i-lucide-user-minus' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się usunąć osoby', mutationError)
  }
}

async function saveTeam() {
  if (!access.value.canManage || !team.value || !teamForm.name.trim()) return
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
    toast.add({ title: 'Zapisano ustawienia zespołu', color: 'success', icon: 'i-lucide-check' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się zapisać zespołu', mutationError)
  } finally {
    saving.value = false
  }
}

async function addRelation() {
  if (!access.value.canManageStructure || !relationForm.teamId) return
  saving.value = true
  const body = relationForm.direction === 'child'
    ? { parent_team_id: teamId.value, child_team_id: relationForm.teamId }
    : { parent_team_id: relationForm.teamId, child_team_id: teamId.value }
  try {
    await $fetch(orgApiPath('/team-edges'), { method: 'POST', body })
    relationForm.teamId = ''
    await Promise.all([refresh(), refreshGraph()])
    toast.add({ title: 'Połączono zespoły', color: 'success', icon: 'i-lucide-git-branch-plus' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się połączyć zespołów', mutationError)
  } finally {
    saving.value = false
  }
}

async function removeRelation(parentId: string, childId: string) {
  if (!access.value.canManageStructure) return
  try {
    await $fetch(orgApiPath(`/team-edges/${parentId}/${childId}`), { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Usunięto relację zespołów', color: 'success', icon: 'i-lucide-unlink' })
  } catch (mutationError: unknown) {
    showMutationError('Nie udało się usunąć relacji', mutationError)
  }
}

async function deleteTeam() {
  if (!access.value.canDelete || !team.value) return
  saving.value = true
  try {
    await $fetch(orgApiPath(`/teams/${team.value.id}`), { method: 'DELETE' })
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
    eyebrow="Administracja zespołu"
    :description="team?.description || 'Wyniki, ludzie i placówki należące do tego zespołu.'"
    :back-to="orgPath('/teams')"
    back-label="Wróć do zespołów"
    :tabs="team ? tabs : []"
  >
    <template v-if="team" #meta>
      <div class="team-meta">
        <UBadge color="neutral" variant="outline" icon="i-lucide-network">
          {{ kindLabel(team.kind) }}
        </UBadge>
        <UBadge
          :color="access.canManage ? 'success' : 'neutral'"
          variant="subtle"
          icon="i-lucide-shield-check"
        >
          {{ accessLabel }}
        </UBadge>
        <span>{{ stats.memberCount }} osób · {{ stats.facilityCount }} placówek</span>
      </div>
    </template>

    <template v-if="team" #actions>
      <UButton
        v-if="activeView === 'members' && access.canManage"
        icon="i-lucide-user-plus"
        @click="openMemberModal"
      >
        Dodaj osobę
      </UButton>
      <UButton
        v-else-if="activeView === 'overview' && access.canManage"
        :to="{ path: route.path, query: { view: 'settings' } }"
        color="neutral"
        variant="outline"
        icon="i-lucide-settings-2"
      >
        Ustawienia
      </UButton>
    </template>

    <div v-if="status === 'pending'" class="team-loading">
      <div class="team-kpis">
        <USkeleton v-for="index in 4" :key="index" class="h-32 w-full" />
      </div>
      <USkeleton class="h-96 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać zespołu"
      :description="apiErrorMessage(error)"
      :actions="[
        { label: 'Ponów', onClick: () => refresh() },
        { label: 'Wróć do listy', to: orgPath('/teams'), color: 'neutral', variant: 'ghost' },
      ]"
    />

    <UAlert
      v-else-if="!team"
      color="warning"
      variant="subtle"
      icon="i-lucide-users-round"
      title="Nie znaleziono zespołu"
      description="Zespół nie istnieje albo nie należy do Twojego zakresu zarządzania."
      :actions="[{ label: 'Wróć do zespołów', to: orgPath('/teams') }]"
    />

    <template v-else>
      <section v-if="activeView === 'overview'" class="team-overview">
        <div class="team-kpis">
          <article class="team-kpi">
            <span><UIcon name="i-lucide-users-round" /></span>
            <div><small>Członkowie</small><strong>{{ stats.memberCount }}</strong><p>bezpośrednio w zespole</p></div>
          </article>
          <article class="team-kpi">
            <span><UIcon name="i-lucide-shield-check" /></span>
            <div><small>Administratorzy</small><strong>{{ stats.adminCount }}</strong><p>osoby zarządzające</p></div>
          </article>
          <article class="team-kpi">
            <span><UIcon name="i-lucide-building-2" /></span>
            <div><small>Placówki</small><strong>{{ stats.facilityCount }}</strong><p>powiązane lokalizacje</p></div>
          </article>
          <article class="team-kpi">
            <span><UIcon name="i-lucide-git-fork" /></span>
            <div><small>Podzespoły</small><strong>{{ stats.childTeamCount }}</strong><p>w zakresie wyników</p></div>
          </article>
        </div>

        <div class="team-overview__grid">
          <UCard class="team-overview__identity">
            <template #header>
              <div class="section-heading">
                <div>
                  <span class="section-heading__eyebrow">Zakres odpowiedzialności</span>
                  <h2>O zespole</h2>
                </div>
                <UBadge color="neutral" variant="outline">{{ team.slug }}</UBadge>
              </div>
            </template>

            <p class="team-overview__description">
              {{ team.description || 'Dodaj opis, aby zespół miał jasno określony zakres odpowiedzialności.' }}
            </p>

            <div class="team-overview__structure">
              <section>
                <span>Zespoły nadrzędne</span>
                <div v-if="parents.length" class="team-chip-list">
                  <NuxtLink
                    v-for="parent in parents"
                    :key="parent.id"
                    :to="orgPath(`/teams/${parent.id}`)"
                    class="team-chip"
                  >
                    <UIcon name="i-lucide-corner-left-up" />
                    {{ parent.name }}
                  </NuxtLink>
                </div>
                <p v-else>Najwyższy poziom struktury.</p>
              </section>
              <section>
                <span>Podzespoły</span>
                <div v-if="children.length" class="team-chip-list">
                  <NuxtLink
                    v-for="child in children"
                    :key="child.id"
                    :to="orgPath(`/teams/${child.id}`)"
                    class="team-chip"
                  >
                    <UIcon name="i-lucide-corner-right-down" />
                    {{ child.name }}
                  </NuxtLink>
                </div>
                <p v-else>Brak podzespołów.</p>
              </section>
            </div>
          </UCard>

          <UCard class="team-overview__actions">
            <template #header>
              <div class="section-heading">
                <div>
                  <span class="section-heading__eyebrow">Skróty</span>
                  <h2>Przejdź do obszaru</h2>
                </div>
              </div>
            </template>
            <nav aria-label="Skróty zespołu">
              <NuxtLink :to="{ path: route.path, query: { view: 'calendar' } }">
                <span><UIcon name="i-lucide-calendar-range" /></span>
                <div><strong>Kalendarz zespołu</strong><small>Spotkania, obłożenie i nieobecności</small></div>
                <UIcon name="i-lucide-arrow-right" />
              </NuxtLink>
              <NuxtLink :to="{ path: route.path, query: { view: 'sales' } }">
                <span><UIcon name="i-lucide-chart-no-axes-combined" /></span>
                <div><strong>Sprzedaż zespołu</strong><small>Wyniki wszystkich ekspertów i podzespołów</small></div>
                <UIcon name="i-lucide-arrow-right" />
              </NuxtLink>
              <NuxtLink :to="{ path: route.path, query: { view: 'members' } }">
                <span><UIcon name="i-lucide-users-round" /></span>
                <div><strong>Ludzie i role</strong><small>{{ stats.memberCount }} bezpośrednich członków</small></div>
                <UIcon name="i-lucide-arrow-right" />
              </NuxtLink>
              <NuxtLink :to="{ path: route.path, query: { view: 'facilities' } }">
                <span><UIcon name="i-lucide-building-2" /></span>
                <div><strong>Placówki</strong><small>{{ stats.facilityCount }} powiązanych lokalizacji</small></div>
                <UIcon name="i-lucide-arrow-right" />
              </NuxtLink>
            </nav>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="section-heading">
              <div>
                <span class="section-heading__eyebrow">Bezpośredni skład</span>
                <h2>Ludzie w zespole</h2>
              </div>
              <UButton
                :to="{ path: route.path, query: { view: 'members' } }"
                color="neutral"
                variant="ghost"
                trailing-icon="i-lucide-arrow-right"
              >
                Zobacz wszystkich
              </UButton>
            </div>
          </template>
          <div v-if="members.length" class="member-preview">
            <article v-for="item in members.slice(0, 6)" :key="item.membership.user_id">
              <UAvatar
                :src="item.user.avatarUrl || undefined"
                :alt="memberLabel(item.user)"
                :text="memberInitials(item.user)"
                size="xl"
              />
              <div>
                <strong>{{ memberLabel(item.user) }}</strong>
                <small>{{ item.user.email }}</small>
              </div>
              <UBadge :color="item.membership.role === 'admin' ? 'primary' : 'neutral'" variant="subtle">
                {{ item.membership.role === 'admin' ? 'Administrator' : 'Członek' }}
              </UBadge>
            </article>
          </div>
          <OeEmptyState
            v-else
            size="compact"
            align="start"
            icon="i-lucide-user-round-plus"
            title="Brak członków"
            description="Dodaj pierwszą osobę i określ jej rolę w zespole."
          >
            <template #actions>
              <UButton v-if="access.canManage" color="neutral" variant="outline" @click="openMemberModal">
                Dodaj osobę
              </UButton>
            </template>
          </OeEmptyState>
        </UCard>
      </section>

      <section v-else-if="activeView === 'calendar'" class="team-calendar">
        <CalendarTeamCalendarDashboard :team-id="team.id" />
      </section>

      <section v-else-if="activeView === 'sales'" class="team-sales">
        <SalesDashboard
          :data="teamSalesPayload?.data"
          :status="salesStatus"
          :error="salesError"
          :range="selectedRange"
          context-label="Wyniki zespołu"
          :context-description="`Łączne wyniki ${team.name}, podzespołów i ${teamSalesPayload?.data.scope?.memberCount ?? 0} ekspertów.`"
          commissions-title="Prowizje zespołu"
          :cases-to="orgPath('/cases')"
          :case-to="caseLink"
          @update:range="selectRange"
          @update:currency="selectCurrency"
          @refresh="refreshSales"
        />
      </section>

      <section v-else-if="activeView === 'members'" class="team-members">
        <div class="view-intro">
          <div>
            <span class="section-heading__eyebrow">Bezpośrednie członkostwa</span>
            <h2>Członkowie i administratorzy</h2>
            <p>Administrator zespołu widzi wyniki całej struktury i może zarządzać jej bezpośrednim składem.</p>
          </div>
          <UButton v-if="access.canManage" icon="i-lucide-user-plus" @click="openMemberModal">
            Dodaj osobę
          </UButton>
        </div>

        <div v-if="members.length" class="member-directory">
          <article v-for="item in members" :key="item.membership.user_id" class="member-row">
            <UAvatar
              :src="item.user.avatarUrl || undefined"
              :alt="memberLabel(item.user)"
              :text="memberInitials(item.user)"
              size="xl"
            />
            <div class="member-row__identity">
              <strong>{{ memberLabel(item.user) }}</strong>
              <small>{{ item.user.email }}</small>
            </div>
            <div class="member-row__role">
              <USelect
                :model-value="item.membership.role"
                :items="membershipRoleItems"
                :disabled="!access.canManage"
                aria-label="Rola w zespole"
                @update:model-value="updateMembershipRole(item.membership, $event)"
              />
            </div>
            <span class="member-row__joined">
              <small>W zespole od</small>
              {{ new Date(item.membership.created_at).toLocaleDateString('pl-PL') }}
            </span>
            <UButton
              v-if="access.canManage"
              color="neutral"
              variant="ghost"
              square
              icon="i-lucide-user-minus"
              aria-label="Usuń z zespołu"
              @click="removeMembership(item.membership)"
            />
          </article>
        </div>
        <OeEmptyState
          v-else
          icon="i-lucide-users-round"
          title="Ten zespół nie ma jeszcze członków"
          description="Dodaj osoby z organizacji. Co najmniej jedna powinna mieć rolę administratora zespołu."
          surface="outline"
        >
          <template #actions>
            <UButton v-if="access.canManage" icon="i-lucide-user-plus" @click="openMemberModal">
              Dodaj pierwszą osobę
            </UButton>
          </template>
        </OeEmptyState>
      </section>

      <section v-else-if="activeView === 'facilities'" class="team-facilities">
        <div class="view-intro">
          <div>
            <span class="section-heading__eyebrow">Zakres operacyjny</span>
            <h2>Placówki zespołu</h2>
            <p>Lokalizacje, w których członkowie zespołu obsługują klientów, terminy i usługi.</p>
          </div>
          <UButton :to="orgPath('/facilities')" color="neutral" variant="outline" icon="i-lucide-building-2">
            Wszystkie placówki
          </UButton>
        </div>

        <div v-if="facilities.length" class="facility-grid">
          <NuxtLink
            v-for="facility in facilities"
            :key="facility.id"
            :to="orgPath(`/facilities/${facility.id}`)"
            class="facility-card"
          >
            <span class="facility-card__icon"><UIcon name="i-lucide-building-2" /></span>
            <div>
              <div class="facility-card__title">
                <strong>{{ facility.name }}</strong>
                <UBadge :color="facility.is_active ? 'success' : 'neutral'" variant="subtle">
                  {{ facility.is_active ? 'Aktywna' : 'Nieaktywna' }}
                </UBadge>
              </div>
              <p>{{ facilityAddress(facility) || 'Adres nie został uzupełniony' }}</p>
              <span><UIcon name="i-lucide-clock-3" /> {{ facility.timezone }}</span>
            </div>
            <UIcon name="i-lucide-arrow-right" />
          </NuxtLink>
        </div>
        <OeEmptyState
          v-else
          icon="i-lucide-building-2"
          title="Brak powiązanych placówek"
          description="Połącz zespół z placówką, aby wspólnie zarządzać grafikiem, usługami i spotkaniami."
          surface="outline"
        >
          <template #actions>
            <UButton :to="orgPath('/facilities')" color="neutral" variant="outline">
              Przejdź do placówek
            </UButton>
          </template>
        </OeEmptyState>
      </section>

      <section v-else class="team-settings">
        <div class="team-settings__grid">
          <UCard>
            <template #header>
              <div class="section-heading">
                <div>
                  <span class="section-heading__eyebrow">Dane podstawowe</span>
                  <h2>Ustawienia zespołu</h2>
                </div>
                <UBadge :color="access.canManage ? 'success' : 'neutral'" variant="outline">
                  {{ access.canManage ? 'Możesz edytować' : 'Tylko odczyt' }}
                </UBadge>
              </div>
            </template>
            <form class="team-form" @submit.prevent="saveTeam">
              <UFormField label="Nazwa zespołu" required>
                <UInput v-model="teamForm.name" class="w-full" :disabled="!access.canManage" />
              </UFormField>
              <div class="team-form__row">
                <UFormField label="Slug">
                  <UInput v-model="teamForm.slug" class="w-full" :disabled="!access.canManage" />
                </UFormField>
                <UFormField label="Typ">
                  <USelect v-model="teamForm.kind" :items="kindItems" class="w-full" :disabled="!access.canManage" />
                </UFormField>
              </div>
              <UFormField label="Opis" description="Krótko opisz zakres odpowiedzialności zespołu.">
                <UTextarea v-model="teamForm.description" class="w-full" :rows="5" :disabled="!access.canManage" />
              </UFormField>
              <UButton v-if="access.canManage" type="submit" icon="i-lucide-save" :loading="saving">
                Zapisz zmiany
              </UButton>
            </form>
          </UCard>

          <UCard>
            <template #header>
              <div class="section-heading">
                <div>
                  <span class="section-heading__eyebrow">Struktura organizacyjna</span>
                  <h2>Relacje zespołu</h2>
                </div>
              </div>
            </template>

            <div class="structure-list">
              <section>
                <span>Zespoły nadrzędne</span>
                <div v-if="parents.length">
                  <article v-for="parent in parents" :key="parent.id">
                    <NuxtLink :to="orgPath(`/teams/${parent.id}`)">
                      <UIcon name="i-lucide-corner-left-up" /> {{ parent.name }}
                    </NuxtLink>
                    <UButton
                      v-if="access.canManageStructure"
                      color="neutral"
                      variant="ghost"
                      square
                      icon="i-lucide-unlink"
                      aria-label="Usuń relację"
                      @click="removeRelation(parent.id, team.id)"
                    />
                  </article>
                </div>
                <p v-else>Najwyższy poziom struktury.</p>
              </section>
              <section>
                <span>Podzespoły</span>
                <div v-if="children.length">
                  <article v-for="child in children" :key="child.id">
                    <NuxtLink :to="orgPath(`/teams/${child.id}`)">
                      <UIcon name="i-lucide-corner-right-down" /> {{ child.name }}
                    </NuxtLink>
                    <UButton
                      v-if="access.canManageStructure"
                      color="neutral"
                      variant="ghost"
                      square
                      icon="i-lucide-unlink"
                      aria-label="Usuń relację"
                      @click="removeRelation(team.id, child.id)"
                    />
                  </article>
                </div>
                <p v-else>Brak zespołów podrzędnych.</p>
              </section>
            </div>

            <form v-if="access.canManageStructure" class="relation-form" @submit.prevent="addRelation">
              <USelect v-model="relationForm.direction" :items="directionItems" />
              <USelectMenu
                v-model="relationForm.teamId"
                :items="relationTeamItems"
                value-key="value"
                placeholder="Wybierz zespół"
                class="w-full"
              />
              <UButton
                type="submit"
                color="neutral"
                variant="outline"
                icon="i-lucide-git-branch-plus"
                :disabled="!relationForm.teamId"
                :loading="saving"
              >
                Połącz
              </UButton>
            </form>
          </UCard>
        </div>

        <UCard v-if="access.canDelete" class="danger-zone">
          <div class="danger-zone__content">
            <div>
              <span class="section-heading__eyebrow">Strefa niebezpieczna</span>
              <h2>Usuń zespół</h2>
              <p>Usunięte zostaną relacje, członkostwa oraz połączenia z placówkami.</p>
            </div>
            <UButton color="error" variant="outline" icon="i-lucide-trash-2" @click="deleteModalOpen = true">
              Usuń zespół
            </UButton>
          </div>
        </UCard>
      </section>
    </template>

    <UModal
      v-model:open="memberModalOpen"
      title="Dodaj osobę do zespołu"
      description="Wybierz istniejącego członka organizacji i określ jego uprawnienia."
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <form id="team-member-form" class="member-form" @submit.prevent="addMembership">
          <UFormField label="Osoba" required>
            <USelectMenu
              v-model="memberForm.userId"
              :items="availableMemberItems"
              value-key="value"
              label-key="label"
              class="w-full"
              placeholder="Wyszukaj po imieniu lub e-mailu"
            />
          </UFormField>
          <UFormField label="Rola w zespole" required>
            <USelect v-model="memberForm.role" :items="membershipRoleItems" class="w-full" />
          </UFormField>
          <UAlert
            v-if="!availableMemberItems.length"
            color="neutral"
            variant="subtle"
            icon="i-lucide-users-round"
            title="Wszyscy członkowie organizacji są już w tym zespole"
          />
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="team-member-form"
          icon="i-lucide-user-plus"
          :disabled="!memberForm.userId"
          :loading="saving"
        >
          Dodaj do zespołu
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteModalOpen"
      title="Usunąć zespół?"
      description="Tej operacji nie można cofnąć."
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="saving" @click="deleteTeam">
          Usuń zespół
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.team-meta,
.team-kpis,
.team-overview,
.team-loading,
.team-calendar,
.team-members,
.team-facilities,
.team-settings,
.team-form,
.member-form {
  display: grid;
}

.team-meta {
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  align-items: center;
  justify-content: start;
  gap: 8px;
}

.team-meta > span:last-child {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.team-loading,
.team-overview,
.team-calendar,
.team-members,
.team-facilities,
.team-settings {
  gap: 20px;
}

.team-kpis {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.team-kpi {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-height: 126px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.team-kpi > span,
.team-overview__actions nav > a > span:first-child,
.facility-card__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  color: var(--ui-text);
  background: var(--ui-bg-muted);
}

.team-kpi > div {
  display: grid;
  gap: 3px;
}

.team-kpi small,
.team-kpi p {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.team-kpi small {
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.team-kpi strong {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 28px;
  line-height: 1;
}

.team-kpi p {
  margin: 2px 0 0;
}

.team-overview__grid,
.team-settings__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, .8fr);
  gap: 20px;
}

.section-heading,
.view-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.section-heading h2,
.view-intro h2,
.danger-zone h2 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.section-heading__eyebrow {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.team-overview__description {
  margin: 0 0 24px;
  color: var(--ui-text);
  font-size: 15px;
  line-height: 1.7;
}

.team-overview__structure {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
  padding-top: 22px;
  border-top: 1px solid var(--ui-border);
}

.team-overview__structure section,
.structure-list section {
  display: grid;
  align-content: start;
  gap: 10px;
}

.team-overview__structure section > span,
.structure-list section > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.team-overview__structure p,
.structure-list p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.team-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.team-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text);
  background: var(--ui-bg-muted);
  font-size: 12px;
  text-decoration: none;
}

.team-chip:hover {
  border-color: var(--ui-border-accented);
  color: var(--ui-text-highlighted);
}

.team-overview__actions nav {
  display: grid;
  gap: 8px;
}

.team-overview__actions nav > a {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 12px;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: 11px;
  color: inherit;
  text-decoration: none;
}

.team-overview__actions nav > a:hover {
  border-color: var(--ui-border);
  background: var(--ui-bg-muted);
}

.team-overview__actions nav > a > div,
.member-preview article > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.team-overview__actions nav strong,
.member-preview strong,
.member-row__identity strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.team-overview__actions nav small,
.member-preview small,
.member-row__identity small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.member-preview article,
.member-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
}

.view-intro {
  align-items: end;
  padding: 2px 0 4px;
}

.view-intro h2 {
  font-size: 22px;
}

.view-intro p {
  max-width: 680px;
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.member-directory {
  display: grid;
  gap: 8px;
}

.member-row {
  grid-template-columns: 44px minmax(220px, 1fr) minmax(190px, .45fr) 120px 36px;
  padding: 15px 16px;
}

.member-row__identity {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.member-row__joined {
  display: grid;
  gap: 3px;
  color: var(--ui-text);
  font-size: 12px;
}

.member-row__joined small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.facility-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.facility-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  color: inherit;
  background: var(--ui-bg);
  text-decoration: none;
  transition: border-color var(--oe-motion-fast), background var(--oe-motion-fast);
}

.facility-card:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.facility-card__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.facility-card p {
  margin: 5px 0 10px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.facility-card div > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.team-form,
.member-form {
  gap: 16px;
}

.team-form__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.structure-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.structure-list section > div {
  display: grid;
  gap: 7px;
}

.structure-list article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
}

.structure-list a {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text);
  font-size: 12px;
  text-decoration: none;
}

.relation-form {
  display: grid;
  grid-template-columns: minmax(160px, .55fr) minmax(0, 1fr) auto;
  gap: 8px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--ui-border);
}

.danger-zone__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.danger-zone p {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.team-empty {
  display: grid;
  place-items: center;
  min-height: 320px;
  padding: 42px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--ui-radius);
  text-align: center;
}

.team-empty > .iconify {
  width: 36px;
  height: 36px;
  margin-bottom: 12px;
  color: var(--ui-text-muted);
}

.team-empty h3,
.team-empty p {
  margin: 0;
}

.team-empty p {
  max-width: 500px;
  margin-top: 7px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.team-empty:not(.team-empty--compact) :deep(button) {
  margin-top: 18px;
}

.team-empty--compact {
  grid-template-columns: auto minmax(0, 1fr) auto;
  place-items: center start;
  min-height: auto;
  padding: 20px;
  text-align: left;
}

.team-empty--compact > .iconify {
  margin: 0;
}

@media (max-width: 1100px) {
  .team-kpis,
  .member-preview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-overview__grid,
  .team-settings__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .team-meta {
    grid-auto-flow: row;
    grid-auto-columns: auto;
  }

  .team-kpis,
  .member-preview,
  .facility-grid,
  .team-overview__structure,
  .structure-list,
  .team-form__row {
    grid-template-columns: 1fr;
  }

  .section-heading,
  .view-intro,
  .danger-zone__content {
    align-items: stretch;
    flex-direction: column;
  }

  .member-row {
    grid-template-columns: 44px minmax(0, 1fr) 36px;
  }

  .member-row__role {
    grid-column: 2 / -1;
  }

  .member-row__joined {
    display: none;
  }

  .relation-form {
    grid-template-columns: 1fr;
  }

  .team-empty--compact {
    grid-template-columns: 1fr;
    place-items: center;
    text-align: center;
  }
}
</style>
