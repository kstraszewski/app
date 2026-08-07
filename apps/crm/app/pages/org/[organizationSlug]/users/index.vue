<script setup lang="ts">
import type { FormError, FormSubmitEvent, TableColumn } from '@nuxt/ui'
import type { OrganizationMember } from '~/types/organization'
import type { OrganizationMembersPayload } from '~/types/scheduling'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Użytkownicy — OpenExpert CRM' })

type AdminRoleKey =
  | 'organization_admin'
  | 'access_admin'
  | 'structure_admin'
  | 'consents_admin'
  | 'forum_admin'
  | 'crm_config_admin'
  | 'experiments_access'
  | 'none'
type AssignedAdminRoleKey = Exclude<AdminRoleKey, 'none'>
type UserStatus = 'active' | 'pending' | 'inactive'
type DirectoryFilter<T extends string> = T | 'all'

interface EnrichedMember extends OrganizationMember {
  adminRole: AdminRoleKey
  adminRoles: AssignedAdminRoleKey[]
  status: UserStatus
  teams: string[]
  lastActivity: string
  isCurrentUser: boolean
}

interface InviteForm {
  email: string
  role: 'expert' | 'admin'
}

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()

const search = ref('')
const statusFilter = ref<DirectoryFilter<UserStatus>>('all')
const adminRoleFilter = ref<DirectoryFilter<AdminRoleKey>>('all')
const inviteOpen = ref(false)
const inviting = ref(false)
const inviteForm = reactive<InviteForm>({
  email: '',
  role: 'expert',
})

const emptyDirectory = (): OrganizationMembersPayload => ({
  currentUserId: '',
  role: 'expert',
  canAssignOthers: false,
  members: [],
})

const {
  data: directory,
  status,
  error,
  refresh,
} = await useFetch<OrganizationMembersPayload>(
  () => orgApiPath('/members'),
  { default: emptyDirectory },
)

const canManageUsers = computed(() =>
  directory.value.canAssignOthers,
)

const accessProfiles: Record<AdminRoleKey, {
  label: string
  summary: string
  icon: string
  color: 'primary' | 'neutral' | 'info' | 'success' | 'warning'
}> = {
  organization_admin: {
    label: 'Administrator organizacji',
    summary: 'Administracja ogólna bez zarządzania zgodami',
    icon: 'i-lucide-shield-check',
    color: 'primary',
  },
  access_admin: {
    label: 'Administrator dostępów',
    summary: 'Użytkownicy, role i historia zmian',
    icon: 'i-lucide-network',
    color: 'info',
  },
  structure_admin: {
    label: 'Administrator struktury',
    summary: 'Zespoły, hierarchia i placówki',
    icon: 'i-lucide-git-fork',
    color: 'success',
  },
  consents_admin: {
    label: 'Administrator zgód',
    summary: 'Definicje, wersje i audyt zgód',
    icon: 'i-lucide-file-check-2',
    color: 'warning',
  },
  forum_admin: {
    label: 'Administrator forum',
    summary: 'Moderacja tematów, odpowiedzi i kategorii',
    icon: 'i-lucide-messages-square',
    color: 'success',
  },
  crm_config_admin: {
    label: 'Administrator ustawień operacyjnych',
    summary: 'Założenia zdolności i parametry usług',
    icon: 'i-lucide-sliders-horizontal',
    color: 'info',
  },
  experiments_access: {
    label: 'Dostęp do eksperymentów',
    summary: 'Prototypowe narzędzia wspierane przez Eve',
    icon: 'i-lucide-flask-conical',
    color: 'primary',
  },
  none: {
    label: 'Brak roli administracyjnej',
    summary: 'Brak modułów administracyjnych',
    icon: 'i-lucide-shield-minus',
    color: 'neutral',
  },
}

const statusItems = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Aktywni', value: 'active' },
  { label: 'Oczekujący', value: 'pending' },
  { label: 'Nieaktywni', value: 'inactive' },
]

const inviteRoleItems = [
  {
    label: 'Bez dostępu administracyjnego',
    value: 'expert',
  },
  {
    label: 'Administrator organizacji',
    value: 'admin',
  },
]

function enrichMember(member: OrganizationMember): EnrichedMember {
  const adminRoles = (member.adminRoles ?? []) as AssignedAdminRoleKey[]
  const adminRole = adminRoles[0] ?? 'none'
  const memberStatus = member.status ?? 'active'
  const lastActivity = member.lastActivityAt
    ? new Intl.DateTimeFormat('pl-PL', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(member.lastActivityAt))
    : 'Brak danych o aktywności'

  return {
    ...member,
    adminRole,
    adminRoles,
    status: memberStatus,
    teams: member.teams ?? [],
    isCurrentUser: member.userId === directory.value.currentUserId,
    lastActivity,
  }
}

const users = computed(() => directory.value.members.map(enrichMember))

const adminRoleItems = computed(() => [
  { label: 'Wszystkie role administracyjne', value: 'all' },
  ...Object.entries(accessProfiles).map(([value, profile]) => ({
    label: profile.label,
    value,
  })),
])

const filteredUsers = computed(() => {
  const tokens = search.value
    .trim()
    .toLocaleLowerCase('pl')
    .split(/\s+/)
    .filter(Boolean)

  return users.value.filter((user) => {
    if (statusFilter.value !== 'all' && user.status !== statusFilter.value) return false
    if (adminRoleFilter.value !== 'all') {
      if (adminRoleFilter.value === 'none' && user.adminRoles.length) return false
      if (adminRoleFilter.value !== 'none' && !user.adminRoles.includes(adminRoleFilter.value)) return false
    }
    if (!tokens.length) return true

    const profiles = user.adminRoles.length
      ? user.adminRoles.map(role => accessProfiles[role])
      : [accessProfiles.none]
    const haystack = [
      user.fullName,
      user.email,
      ...profiles.flatMap(profile => [profile.label, profile.summary]),
      ...user.teams,
    ].join(' ').toLocaleLowerCase('pl')

    return tokens.every(token => haystack.includes(token))
  })
})

const columns: TableColumn<EnrichedMember>[] = [
  { accessorKey: 'fullName', header: 'Użytkownik' },
  { id: 'team', header: 'Zespół' },
  { id: 'adminAccess', header: 'Dostęp administracyjny' },
  { id: 'status', header: 'Status' },
  { id: 'actions', header: '' },
]

const hasActiveFilters = computed(() =>
  Boolean(search.value.trim())
  || statusFilter.value !== 'all'
  || adminRoleFilter.value !== 'all',
)

function displayName(user: OrganizationMember) {
  return user.fullName?.trim() || user.email || 'Użytkownik'
}

function initials(user: OrganizationMember) {
  const source = user.fullName?.trim() || user.email.split('@')[0] || 'U'
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toLocaleUpperCase('pl')
}

function teamSummary(user: EnrichedMember) {
  if (!user.teams.length) return 'Bez zespołu'
  if (user.teams.length === 1) return user.teams[0]
  return `${user.teams[0]} +${user.teams.length - 1}`
}

function statusDetails(user: EnrichedMember) {
  if (user.status === 'active') {
    return { label: 'Aktywny', color: 'success' as const }
  }
  if (user.status === 'pending') {
    return { label: 'Oczekuje', color: 'warning' as const }
  }
  return { label: 'Nieaktywny', color: 'neutral' as const }
}

function resetFilters() {
  search.value = ''
  statusFilter.value = 'all'
  adminRoleFilter.value = 'all'
}

function openInvite() {
  inviteForm.email = ''
  inviteForm.role = 'expert'
  inviteOpen.value = true
}

function validateInvite(state: Partial<InviteForm>): FormError[] {
  const inviteErrors: FormError[] = []
  const email = state.email?.trim() ?? ''
  if (!email) {
    inviteErrors.push({ name: 'email', message: 'Podaj adres email użytkownika.' })
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    inviteErrors.push({ name: 'email', message: 'Podaj poprawny adres email.' })
  }
  return inviteErrors
}

async function inviteUser(event: FormSubmitEvent<InviteForm>) {
  inviting.value = true
  try {
    await $fetch(orgApiPath('/members'), {
      method: 'POST',
      body: {
        email: event.data.email.trim().toLocaleLowerCase('pl'),
        role: event.data.role,
      },
    })
    inviteOpen.value = false
    toast.add({
      title: 'Użytkownik został dodany',
      description: event.data.role === 'admin'
        ? 'Otrzymał ogólną rolę administratora organizacji. Dostęp do zgód nadaj osobno.'
        : 'Nie otrzymał dostępu do modułów administracyjnych.',
      color: 'success',
      icon: 'i-lucide-user-round-check',
    })
    await refresh()
  } catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się dodać użytkownika',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    inviting.value = false
  }
}
</script>

<template>
  <CrmShell
    title="Użytkownicy"
    eyebrow="Administracja organizacji"
    description="Rejestr osób, ich ról administracyjnych i miejsca w strukturze organizacji. Uprawnienia eksperckie są zarządzane osobno w module akredytacji."
  >
    <template #meta>
      <div v-if="canManageUsers" class="users-page__meta">
        <UBadge color="neutral" variant="outline" icon="i-lucide-building-2">
          Cała organizacja
        </UBadge>
        <span>{{ users.length }} {{ users.length === 1 ? 'użytkownik' : 'użytkowników' }}</span>
      </div>
    </template>

    <template #actions>
      <UButton
        v-if="canManageUsers"
        icon="i-lucide-user-plus"
        @click="openInvite"
      >
        Dodaj użytkownika
      </UButton>
    </template>

    <section class="users-page">
      <template v-if="status === 'pending'">
        <UCard class="users-registry">
          <div class="users-loading">
            <USkeleton class="h-10 w-full" />
            <USkeleton v-for="item in 6" :key="item" class="h-14 w-full" />
          </div>
        </UCard>
      </template>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać użytkowników"
        :description="apiErrorMessage(error)"
        :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
      />

      <UAlert
        v-else-if="!canManageUsers"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Widok tylko dla administratorów organizacji"
        description="Ten rejestr zawiera konfigurację dostępów administracyjnych. Skontaktuj się z administratorem organizacji, jeśli potrzebujesz dostępu."
      />

      <template v-else>
        <UCard class="users-registry">
          <template #header>
            <div class="users-toolbar">
              <div class="users-toolbar__copy">
                <span>Rejestr organizacji</span>
                <h2>Lista użytkowników</h2>
                <p>Wyszukaj osobę albo przejdź do jej profilu, aby zarządzać dostępem administracyjnym.</p>
              </div>

              <div class="users-toolbar__filters">
                <UInput
                  v-model="search"
                  icon="i-lucide-search"
                  placeholder="Imię, email, zespół lub dostęp"
                  aria-label="Szukaj użytkowników"
                  class="users-toolbar__search"
                />
                <USelect
                  v-model="statusFilter"
                  :items="statusItems"
                  value-key="value"
                  aria-label="Filtruj po statusie"
                />
                <USelect
                  v-model="adminRoleFilter"
                  :items="adminRoleItems"
                  value-key="value"
                  aria-label="Filtruj po roli administracyjnej"
                />
                <UButton
                  v-if="hasActiveFilters"
                  color="neutral"
                  variant="ghost"
                  square
                  icon="i-lucide-x"
                  aria-label="Wyczyść filtry"
                  title="Wyczyść filtry"
                  @click="resetFilters"
                />
              </div>
            </div>
          </template>

          <div class="users-registry__count">
            <span>
              {{ filteredUsers.length }}
              {{ filteredUsers.length === 1 ? 'wynik' : 'wyników' }}
            </span>
            <span v-if="hasActiveFilters">z {{ users.length }} użytkowników</span>
          </div>

          <div v-if="filteredUsers.length" class="users-table">
            <UTable
              :data="filteredUsers"
              :columns="columns"
              :ui="{
                root: 'overflow-x-auto',
                base: 'min-w-[860px]',
                th: 'px-4 py-3 text-xs font-semibold text-muted',
                td: 'px-4 py-3 align-middle',
                tr: 'transition-colors hover:bg-elevated/50',
              }"
            >
              <template #fullName-cell="{ row }">
                <div class="user-cell">
                  <UAvatar
                    :src="row.original.avatarUrl || undefined"
                    :alt="displayName(row.original)"
                    :text="initials(row.original)"
                    size="md"
                  />
                  <div class="user-cell__identity">
                    <span>
                      <NuxtLink :to="orgPath(`/users/${row.original.userId}`)">
                        {{ displayName(row.original) }}
                      </NuxtLink>
                      <UBadge
                        v-if="row.original.isCurrentUser"
                        color="neutral"
                        variant="outline"
                        size="xs"
                      >
                        Ty
                      </UBadge>
                    </span>
                    <small>{{ row.original.email }}</small>
                  </div>
                </div>
              </template>

              <template #team-cell="{ row }">
                <span class="team-cell">
                  <UIcon name="i-lucide-users-round" />
                  {{ teamSummary(row.original) }}
                </span>
              </template>

              <template #adminAccess-cell="{ row }">
                <div class="access-cell">
                  <UBadge
                    :color="accessProfiles[row.original.adminRole].color"
                    variant="subtle"
                    :icon="accessProfiles[row.original.adminRole].icon"
                    size="sm"
                  >
                    {{ accessProfiles[row.original.adminRole].label }}
                  </UBadge>
                  <UBadge
                    v-if="row.original.adminRoles.length > 1"
                    color="neutral"
                    variant="outline"
                    size="xs"
                  >
                    +{{ row.original.adminRoles.length - 1 }}
                  </UBadge>
                </div>
              </template>

              <template #status-cell="{ row }">
                <div class="status-cell">
                  <UBadge :color="statusDetails(row.original).color" variant="subtle" size="sm">
                    {{ statusDetails(row.original).label }}
                  </UBadge>
                  <small>{{ row.original.lastActivity }}</small>
                </div>
              </template>

              <template #actions-cell="{ row }">
                <UButton
                  :to="orgPath(`/users/${row.original.userId}`)"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-chevron-right"
                  :aria-label="`Otwórz profil użytkownika ${displayName(row.original)}`"
                />
              </template>
            </UTable>
          </div>

          <div v-else class="users-empty">
            <span class="users-empty__icon"><UIcon name="i-lucide-user-round-search" /></span>
            <h3>{{ users.length ? 'Brak pasujących użytkowników' : 'Brak użytkowników w organizacji' }}</h3>
            <p>
              {{ users.length
                ? 'Zmień wyszukiwaną frazę lub usuń część filtrów.'
                : 'Dodaj pierwszą osobę przyciskiem w nagłówku strony.'
              }}
            </p>
            <UButton
              v-if="users.length && hasActiveFilters"
              color="neutral"
              variant="outline"
              icon="i-lucide-x"
              @click="resetFilters"
            >
              Wyczyść filtry
            </UButton>
          </div>
        </UCard>
      </template>
    </section>

    <UModal
      v-model:open="inviteOpen"
      title="Dodaj użytkownika"
      description="Dodaj osobę do organizacji i zdecyduj, czy od razu otrzyma ogólną rolę administratora."
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
    >
      <template #body>
        <UForm
          id="user-invite-form"
          :state="inviteForm"
          :validate="validateInvite"
          class="user-invite-form"
          @submit="inviteUser"
        >
          <UFormField
            name="email"
            label="Adres email"
            description="Użytkownik musi posiadać konto powiązane z tym adresem."
            required
          >
            <UInput
              v-model="inviteForm.email"
              class="w-full"
              type="email"
              placeholder="imie.nazwisko@firma.pl"
              icon="i-lucide-mail"
              autofocus
            />
          </UFormField>

          <UFormField
            name="role"
            label="Dostęp administracyjny"
            description="Uprawnienia eksperckie będą konfigurowane osobno w module akredytacji."
          >
            <USelect
              v-model="inviteForm.role"
              :items="inviteRoleItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="inviteForm.role === 'admin'"
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="Szeroki dostęp administracyjny"
            description="Ta osoba będzie mogła zarządzać użytkownikami, rolami, strukturą organizacji i konfiguracją CRM. Edycja oraz publikacja zgód wymagają osobnej roli lub wyjątku."
          />
        </UForm>
      </template>

      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="user-invite-form"
          icon="i-lucide-send"
          :loading="inviting"
        >
          Dodaj użytkownika
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.users-page {
  display: grid;
  gap: 22px;
}

.users-page__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.users-registry {
  overflow: hidden;
}

.users-toolbar {
  display: grid;
  gap: 18px;
}

.users-toolbar__copy > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.users-toolbar__copy h2 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.users-toolbar__copy p {
  max-width: 680px;
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.users-toolbar__filters {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(160px, 190px) minmax(230px, 280px) 40px;
  gap: 10px;
  align-items: center;
}

.users-toolbar__search {
  width: 100%;
}

.users-registry__count {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 10px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.users-registry__count span:first-child {
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.users-table {
  min-width: 0;
  margin: 0 -24px -24px;
  border-top: 1px solid var(--ui-border);
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 240px;
}

.user-cell__identity {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.user-cell__identity > span {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.user-cell__identity a {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-weight: 600;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-cell__identity a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.user-cell__identity small {
  overflow: hidden;
  max-width: 260px;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-cell {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 190px;
  overflow: hidden;
  color: var(--ui-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-cell :deep(.iconify) {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.access-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 225px;
}

.status-cell {
  display: grid;
  justify-items: start;
  gap: 4px;
  min-width: 130px;
}

.status-cell small {
  color: var(--ui-text-muted);
  font-size: 9px;
  white-space: nowrap;
}

.users-empty {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 300px;
  padding: 30px;
  text-align: center;
}

.users-empty__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
}

.users-empty__icon :deep(.iconify) {
  width: 22px;
  height: 22px;
}

.users-empty h3,
.users-empty p {
  margin: 0;
}

.users-empty h3 {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.users-empty p {
  max-width: 460px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.users-loading,
.user-invite-form {
  display: grid;
  gap: 14px;
}

@media (max-width: 820px) {
  .users-toolbar__filters {
    grid-template-columns: 1fr 1fr 40px;
  }

  .users-toolbar__search {
    grid-column: 1 / -1;
  }
}

@media (max-width: 620px) {
  .users-toolbar__filters {
    grid-template-columns: 1fr 40px;
  }

  .users-toolbar__filters > :nth-child(2),
  .users-toolbar__filters > :nth-child(3) {
    grid-column: 1 / -1;
  }
}
</style>
