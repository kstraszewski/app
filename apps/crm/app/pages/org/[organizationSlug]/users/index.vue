<script setup lang="ts">
import type { FormError, FormSubmitEvent, TableColumn } from '@nuxt/ui'
import type {
  OrganizationMemberInvitation,
  OrganizationMemberInvitationIssueResponse,
} from '#shared/types/organization-member-invitations'
import type {
  OrganizationMemberBillingSummary,
  OrganizationPendingSeatChange,
  OrganizationSeatChangeResponse,
  OrganizationSeatQuote,
} from '#shared/types/organization-seat-billing'
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
  invitedName: string
  email: string
  role: 'expert' | 'admin'
}

type MembersPayload = OrganizationMembersPayload & {
  billing: OrganizationMemberBillingSummary
}

type InviteStep = 'details' | 'quote' | 'result'

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()

const search = ref('')
const statusFilter = ref<DirectoryFilter<UserStatus>>('all')
const adminRoleFilter = ref<DirectoryFilter<AdminRoleKey>>('all')
const inviteOpen = ref(false)
const inviting = ref(false)
const quoteLoading = ref(false)
const reconcileLoading = ref(false)
const memberInvitationActionId = ref('')
const inviteStep = ref<InviteStep>('details')
const inviteQuote = ref<OrganizationSeatQuote | null>(null)
const seatChange = ref<OrganizationSeatChangeResponse | null>(null)
const quoteError = ref('')
const idempotencyKey = ref('')
const inviteForm = reactive<InviteForm>({
  invitedName: '',
  email: '',
  role: 'expert',
})

const emptyBilling = (): OrganizationMemberBillingSummary => ({
  perSeat: false,
  canManageSeats: false,
  billingPlanCode: null,
  canUpgradeToTeam: false,
  licensedSeats: 0,
  activeMembers: 0,
  reservedSeats: 0,
  unitAmount: 0,
  currency: 'pln',
  monthlyListAmount: 0,
  renewalAt: null,
  pendingChanges: [],
  pendingInvitations: [],
})

const emptyDirectory = (): MembersPayload => ({
  currentUserId: '',
  role: 'expert',
  canAssignOthers: false,
  members: [],
  billing: emptyBilling(),
})

const {
  data: directory,
  status,
  error,
  refresh,
} = await useFetch<MembersPayload>(
  () => orgApiPath('/members'),
  { default: emptyDirectory },
)

const canViewUsers = computed(() => directory.value.canAssignOthers)
const canManageUsers = computed(() => (
  directory.value.canAssignOthers
  && (!directory.value.billing.perSeat || directory.value.billing.canManageSeats)
))
const individualUpgradeRequired = computed(() => (
  directory.value.billing.perSeat
  && directory.value.billing.billingPlanCode === 'individual'
))
const canInviteUsers = computed(() => canManageUsers.value && !individualUpgradeRequired.value)
const seatManagementRestricted = computed(() => (
  canViewUsers.value
  && directory.value.billing.perSeat
  && !directory.value.billing.canManageSeats
))
const pendingSeatChanges = computed(() => directory.value.billing.pendingChanges)
const pendingMemberInvitations = computed(() => directory.value.billing.pendingInvitations)
const availablePaidSeats = computed(() => Math.max(
  0,
  directory.value.billing.licensedSeats
  - directory.value.billing.activeMembers
  - directory.value.billing.reservedSeats,
))
const inviteIntoPaidCapacity = computed(() => (
  directory.value.billing.perSeat && availablePaidSeats.value > 0
))
const capacityHeldByInvitations = computed(() => (
  directory.value.billing.perSeat
  && directory.value.billing.reservedSeats > 0
  && directory.value.billing.activeMembers < directory.value.billing.licensedSeats
  && availablePaidSeats.value === 0
))
const inviteModalTitle = computed(() => {
  if (inviteStep.value === 'quote') {
    return inviteQuote.value?.billingRequired
      ? 'Potwierdź koszt użytkownika'
      : 'Potwierdź wykorzystanie miejsca'
  }
  if (inviteStep.value === 'result') return 'Zmiana liczby użytkowników'
  return inviteIntoPaidCapacity.value ? 'Zaproś użytkownika' : 'Dodaj użytkownika'
})
const inviteModalDescription = computed(() => {
  if (inviteStep.value === 'quote') {
    return inviteQuote.value?.billingRequired
      ? 'Sprawdź dopłatę za bieżący okres i nowy miesięczny koszt przed obciążeniem zapisanej karty.'
      : 'Ta osoba zajmie jedno z opłaconych miejsc. Karta nie zostanie ponownie obciążona.'
  }
  if (inviteStep.value === 'result') {
    return 'Płatne miejsce zostanie aktywowane po potwierdzeniu płatności.'
  }
  if (inviteIntoPaidCapacity.value) {
    return 'Wyślij bezpieczne zaproszenie email. Opłacone miejsce zostanie zarezerwowane bez obciążania karty.'
  }
  if (capacityHeldByInvitations.value) {
    return 'Wszystkie wolne opłacone miejsca są już zarezerwowane przez oczekujące zaproszenia.'
  }
  return 'Wskaż istniejące, zweryfikowane konto. Dodanie kolejnego miejsca zwiększy subskrypcję.'
})

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

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.()
    ?? `seat-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function resetInviteFlow() {
  inviteStep.value = 'details'
  inviteQuote.value = null
  seatChange.value = null
  quoteError.value = ''
  idempotencyKey.value = newIdempotencyKey()
}

function openInvite() {
  if (!canInviteUsers.value) return

  inviteForm.invitedName = ''
  inviteForm.email = ''
  inviteForm.role = 'expert'
  resetInviteFlow()
  inviteOpen.value = true
}

function closeInvite() {
  inviteOpen.value = false
}

function editInviteDetails() {
  inviteStep.value = 'details'
  inviteQuote.value = null
  seatChange.value = null
  quoteError.value = ''
  idempotencyKey.value = newIdempotencyKey()
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

async function requestInviteQuote(event: FormSubmitEvent<InviteForm>) {
  quoteLoading.value = true
  quoteError.value = ''
  inviteQuote.value = null

  try {
    inviteForm.invitedName = event.data.invitedName?.trim() ?? ''
    inviteForm.email = event.data.email.trim().toLocaleLowerCase('pl')
    inviteForm.role = event.data.role
    if (inviteIntoPaidCapacity.value) {
      const result = await $fetch<OrganizationMemberInvitationIssueResponse>(
        orgApiPath('/member-invitations'),
        {
          method: 'POST',
          body: {
            invitedName: inviteForm.invitedName || undefined,
            email: inviteForm.email,
            role: inviteForm.role,
          },
        },
      )
      await refresh()
      inviteOpen.value = false
      toast.add({
        title: result.delivery.status === 'sent'
          ? 'Zaproszenie zostało wysłane'
          : 'Miejsce zarezerwowano, ale email nie został wysłany',
        description: result.delivery.status === 'sent'
          ? `${inviteForm.email} otrzyma bezpieczny link. Karta nie została obciążona.`
          : 'Ponów wysyłkę z listy oczekujących zaproszeń albo zwolnij miejsce.',
        color: result.delivery.status === 'sent' ? 'success' : 'warning',
        icon: result.delivery.status === 'sent' ? 'i-lucide-mail-check' : 'i-lucide-mail-warning',
      })
      return
    }
    inviteQuote.value = await $fetch<OrganizationSeatQuote>(orgApiPath('/members/quote'), {
      method: 'POST',
      body: {
        email: inviteForm.email,
        role: inviteForm.role,
      },
    })
    idempotencyKey.value = newIdempotencyKey()
    inviteStep.value = 'quote'
  }
  catch (caught: unknown) {
    quoteError.value = apiErrorMessage(caught)
    await refresh()
  }
  finally {
    quoteLoading.value = false
  }
}

async function confirmInvite() {
  if (!inviteQuote.value) return

  inviting.value = true
  try {
    const result = await $fetch<OrganizationSeatChangeResponse>(orgApiPath('/members'), {
      method: 'POST',
      body: {
        email: inviteForm.email,
        role: inviteForm.role,
        idempotencyKey: idempotencyKey.value,
        quotedBillingRequired: inviteQuote.value.billingRequired,
        expectedActiveMembers: inviteQuote.value.expectedActiveMembers,
        expectedReservedSeats: inviteQuote.value.expectedReservedSeats,
        expectedOccupiedSeats: inviteQuote.value.expectedOccupiedSeats,
        expectedCurrentSeats: inviteQuote.value.currentSeats,
        prorationDate: inviteQuote.value.prorationDate,
      },
    })

    seatChange.value = result
    await refresh()

    if (result.status === 'succeeded') {
      inviteOpen.value = false
      toast.add({
        title: 'Użytkownik został dodany',
        description: inviteForm.role === 'admin'
          ? 'Płatne miejsce jest aktywne. Użytkownik otrzymał ogólną rolę administratora organizacji.'
          : 'Płatne miejsce jest aktywne. Użytkownik nie otrzymał dostępu administracyjnego.',
        color: 'success',
        icon: 'i-lucide-user-round-check',
      })
      return
    }

    inviteStep.value = 'result'
    toast.add({
      title: result.status === 'requires_action'
        ? 'Płatność wymaga potwierdzenia'
        : 'Płatność jest przetwarzana',
      description: 'Użytkownik otrzyma dostęp dopiero po potwierdzeniu płatności.',
      color: result.status === 'requires_action' ? 'warning' : 'info',
      icon: result.status === 'requires_action' ? 'i-lucide-credit-card' : 'i-lucide-loader-circle',
    })
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

async function resendMemberInvitation(invitation: OrganizationMemberInvitation) {
  memberInvitationActionId.value = invitation.id
  try {
    const result = await $fetch<OrganizationMemberInvitationIssueResponse>(
      orgApiPath(`/member-invitations/${encodeURIComponent(invitation.id)}/resend`),
      { method: 'POST', body: {} },
    )
    await refresh()
    toast.add({
      title: result.delivery.status === 'sent' ? 'Zaproszenie wysłane ponownie' : 'Wysyłka nie powiodła się',
      description: result.delivery.status === 'sent'
        ? `Nowy link trafił na ${invitation.email}.`
        : 'Opłacone miejsce nadal jest zarezerwowane. Możesz ponowić próbę lub unieważnić zaproszenie.',
      color: result.delivery.status === 'sent' ? 'success' : 'warning',
    })
  }
  catch (error: unknown) {
    toast.add({ title: 'Nie udało się ponowić zaproszenia', description: apiErrorMessage(error), color: 'error' })
  }
  finally {
    memberInvitationActionId.value = ''
  }
}

async function revokeMemberInvitation(invitation: OrganizationMemberInvitation) {
  memberInvitationActionId.value = invitation.id
  try {
    await $fetch(orgApiPath(`/member-invitations/${encodeURIComponent(invitation.id)}/revoke`), {
      method: 'POST',
      body: {},
    })
    await refresh()
    toast.add({
      title: 'Zaproszenie unieważnione',
      description: 'Zarezerwowane opłacone miejsce jest ponownie dostępne.',
      color: 'success',
    })
  }
  catch (error: unknown) {
    toast.add({ title: 'Nie udało się unieważnić zaproszenia', description: apiErrorMessage(error), color: 'error' })
  }
  finally {
    memberInvitationActionId.value = ''
  }
}

function memberInvitationDescription(invitation: OrganizationMemberInvitation) {
  if (invitation.status === 'expired') return 'Link wygasł i miejsce jest wolne. Możesz wysłać nowy link, jeśli miejsce nadal jest dostępne.'
  if (invitation.deliveryFailed) return 'Miejsce jest zarezerwowane, ale wiadomość nie została dostarczona. Ponów wysyłkę lub zwolnij miejsce.'
  return `Miejsce jest zarezerwowane do ${formatBillingDate(invitation.expiresAt)}. Przyjęcie linku nie obciąży karty.`
}

async function reconcilePendingPayment(change: OrganizationPendingSeatChange) {
  if (reconcileLoading.value) return

  reconcileLoading.value = true
  try {
    await $fetch(orgApiPath('/billing/reconcile'), {
      method: 'POST',
      body: {},
    })
    await refresh()

    const stillPending = directory.value.billing.pendingChanges.some(item => item.id === change.id)
    toast.add({
      title: stillPending ? 'Płatność nadal czeka na potwierdzenie' : 'Płatność została potwierdzona',
      description: stillPending
        ? 'Stripe nie potwierdził jeszcze obciążenia. Spróbuj ponownie za chwilę.'
        : `Dostęp użytkownika ${change.email} został zaktualizowany.`,
      color: stillPending ? 'warning' : 'success',
      icon: stillPending ? 'i-lucide-clock-3' : 'i-lucide-circle-check',
    })
  }
  catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się sprawdzić płatności',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    reconcileLoading.value = false
  }
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100)
}

function formatBillingDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long' }).format(new Date(value))
}

function pendingSeatPresentation(change: OrganizationPendingSeatChange) {
  if (change.status === 'requires_action') {
    return {
      color: 'warning' as const,
      icon: 'i-lucide-credit-card',
      title: `Dokończ płatność za użytkownika ${change.email}`,
      description: 'Dodatkowe miejsce i dostęp użytkownika czekają na potwierdzenie płatności.',
    }
  }

  return {
    color: 'info' as const,
    icon: 'i-lucide-loader-circle',
    title: `Dodanie użytkownika ${change.email} jest przetwarzane`,
    description: 'Dostęp zostanie aktywowany automatycznie po zaksięgowaniu płatności.',
  }
}

watch(inviteOpen, (open) => {
  if (!open && !inviting.value) resetInviteFlow()
})
</script>

<template>
  <CrmShell
    title="Użytkownicy"
    eyebrow="Administracja organizacji"
    description="Rejestr osób, ich ról administracyjnych i miejsca w strukturze organizacji. Uprawnienia eksperckie są zarządzane osobno w module akredytacji."
  >
    <template #meta>
      <div v-if="canViewUsers" class="users-page__meta">
        <UBadge color="neutral" variant="outline" icon="i-lucide-building-2">
          Cała organizacja
        </UBadge>
        <span>{{ users.length }} {{ users.length === 1 ? 'użytkownik' : 'użytkowników' }}</span>
      </div>
    </template>

    <template #actions>
      <UButton
        v-if="canInviteUsers"
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
        v-else-if="!canViewUsers"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Widok tylko dla administratorów organizacji"
        description="Ten rejestr zawiera konfigurację dostępów administracyjnych. Skontaktuj się z administratorem organizacji, jeśli potrzebujesz dostępu."
      />

      <template v-else>
        <UAlert
          v-if="individualUpgradeRequired"
          color="primary"
          variant="subtle"
          icon="i-lucide-users-round"
          title="Plan Indywidualny obejmuje 1 użytkownika"
          description="Aby zaprosić kolejne osoby, przejdź na plan Zespół. Zobaczysz dokładną proporcjonalną dopłatę przed obciążeniem karty."
        >
          <template #actions>
            <UButton :to="orgPath('/settings/billing')" trailing-icon="i-lucide-arrow-right">
              Przejdź na plan Zespół
            </UButton>
          </template>
        </UAlert>

        <UAlert
          v-if="seatManagementRestricted"
          color="warning"
          variant="subtle"
          icon="i-lucide-credit-card"
          title="Dodawanie użytkowników wymaga dostępu do rozliczeń"
          description="Jako administrator dostępów możesz przeglądać użytkowników i role, ale tylko administrator organizacji może zwiększyć liczbę płatnych miejsc i obciążyć kartę."
        />

        <UAlert
          v-for="change in pendingSeatChanges"
          :key="change.id"
          :color="pendingSeatPresentation(change).color"
          variant="subtle"
          :icon="pendingSeatPresentation(change).icon"
          :title="pendingSeatPresentation(change).title"
          :description="pendingSeatPresentation(change).description"
        >
          <template v-if="canManageUsers" #actions>
            <UButton
              v-if="change.paymentUrl"
              :to="change.paymentUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="outline"
              trailing-icon="i-lucide-external-link"
            >
              Dokończ płatność
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-refresh-cw"
              :loading="reconcileLoading"
              @click="reconcilePendingPayment(change)"
            >
              Sprawdź płatność
            </UButton>
          </template>
        </UAlert>

        <UAlert
          v-for="invitation in pendingMemberInvitations"
          :key="invitation.id"
          :color="invitation.deliveryFailed || invitation.status === 'expired' ? 'warning' : 'info'"
          variant="subtle"
          :icon="invitation.deliveryFailed ? 'i-lucide-mail-warning' : 'i-lucide-mail-clock'"
          :title="invitation.status === 'expired'
            ? `Zaproszenie dla ${invitation.email} wygasło`
            : `Oczekuje zaproszenie dla ${invitation.email}`"
          :description="memberInvitationDescription(invitation)"
        >
          <template v-if="canManageUsers" #actions>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-send"
              :loading="memberInvitationActionId === invitation.id"
              @click="resendMemberInvitation(invitation)"
            >
              Wyślij ponownie
            </UButton>
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-x"
              :loading="memberInvitationActionId === invitation.id"
              @click="revokeMemberInvitation(invitation)"
            >
              Zwolnij miejsce
            </UButton>
          </template>
        </UAlert>

        <div v-if="directory.billing.perSeat" class="users-billing-summary">
          <UCard>
            <span>Aktywni użytkownicy</span>
            <strong>{{ directory.billing.activeMembers }}</strong>
            <small>
              {{ directory.billing.licensedSeats }} opłaconych ·
              {{ directory.billing.reservedSeats }} zarezerwowanych ·
              {{ availablePaidSeats }} wolnych
            </small>
          </UCard>
          <UCard>
            <span>Cena za użytkownika</span>
            <strong>{{ formatMoney(directory.billing.unitAmount, directory.billing.currency) }}</strong>
            <small>{{ directory.billing.billingPlanCode === 'legacy_per_seat' ? 'brutto' : 'netto + VAT' }} miesięcznie za opłacone miejsce</small>
          </UCard>
          <UCard>
            <span>Koszt miesięczny</span>
            <strong>{{ formatMoney(directory.billing.monthlyListAmount, directory.billing.currency) }}</strong>
            <small>
              {{ directory.billing.licensedSeats }} ×
              {{ formatMoney(directory.billing.unitAmount, directory.billing.currency) }}
              {{ directory.billing.billingPlanCode === 'legacy_per_seat' ? 'brutto' : 'netto + VAT' }}
            </small>
          </UCard>
          <UCard>
            <span>Następne odnowienie</span>
            <strong class="users-billing-summary__date">
              {{ formatBillingDate(directory.billing.renewalAt) }}
            </strong>
            <small>zgodnie z okresem rozliczeniowym</small>
          </UCard>
        </div>

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

          <OeEmptyState
            v-else
            :kind="users.length ? 'filtered' : 'empty'"
            :icon="users.length ? 'i-lucide-user-round-search' : 'i-lucide-user-plus'"
            :title="users.length ? 'Brak pasujących użytkowników' : 'Brak użytkowników w organizacji'"
            :description="users.length
              ? 'Zmień wyszukiwaną frazę lub usuń część filtrów.'
              : 'Dodaj pierwszą osobę, aby przydzielić jej zespoły i uprawnienia.'"
          >
            <template #actions>
              <UButton
                v-if="users.length && hasActiveFilters"
                color="neutral"
                variant="outline"
                icon="i-lucide-x"
                @click="resetFilters"
              >
                Wyczyść filtry
              </UButton>
              <UButton
                v-if="!users.length && canInviteUsers"
                icon="i-lucide-user-plus"
                @click="openInvite"
              >
                Dodaj użytkownika
              </UButton>
            </template>
          </OeEmptyState>
        </UCard>
      </template>
    </section>

    <UModal
      v-model:open="inviteOpen"
      :title="inviteModalTitle"
      :description="inviteModalDescription"
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
    >
      <template #body>
        <UForm
          v-if="inviteStep === 'details'"
          id="user-invite-form"
          :state="inviteForm"
          :validate="validateInvite"
          class="user-invite-form"
          @submit="requestInviteQuote"
        >
          <div class="invite-progress">
            <UBadge color="primary" variant="subtle">
              {{ inviteIntoPaidCapacity ? 'Zaproszenie bez płatności' : 'Krok 1 z 2' }}
            </UBadge>
            <span>{{ inviteIntoPaidCapacity ? 'Nowe lub istniejące konto' : 'Istniejące konto' }}</span>
          </div>

          <UAlert
            v-if="capacityHeldByInvitations"
            color="warning"
            variant="subtle"
            icon="i-lucide-users-round"
            title="Brak wolnego miejsca do dodania"
            description="Oczekujące zaproszenia zajmują wszystkie wolne opłacone miejsca. Poczekaj na ich przyjęcie albo unieważnij jedno z nich nad listą użytkowników."
          />

          <UFormField
            v-if="inviteIntoPaidCapacity"
            name="invitedName"
            label="Imię i nazwisko"
            description="Opcjonalnie — pomoże rozpoznać osobę na liście oczekujących."
          >
            <UInput
              v-model="inviteForm.invitedName"
              class="w-full"
              maxlength="200"
              placeholder="Anna Kowalska"
              icon="i-lucide-user-round"
              autofocus
            />
          </UFormField>

          <UFormField
            name="email"
            label="Adres email"
            :description="inviteIntoPaidCapacity
              ? 'Osoba może założyć konto bezpośrednio z bezpiecznego linku.'
              : 'Użytkownik musi już posiadać zweryfikowane konto powiązane z tym adresem.'"
            required
          >
            <UInput
              v-model="inviteForm.email"
              class="w-full"
              type="email"
              placeholder="imie.nazwisko@firma.pl"
              icon="i-lucide-mail"
              :autofocus="!inviteIntoPaidCapacity"
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

          <UAlert
            v-if="quoteError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="inviteIntoPaidCapacity ? 'Nie udało się wysłać zaproszenia' : 'Nie udało się wyliczyć kosztu'"
            :description="quoteError"
          />
        </UForm>

        <div v-else-if="inviteStep === 'quote' && inviteQuote" class="seat-quote">
          <div class="invite-progress">
            <UBadge color="primary" variant="subtle">Krok 2 z 2</UBadge>
            <span>Podsumowanie i płatność</span>
          </div>

          <div class="seat-quote__identity">
            <span class="seat-quote__identity-icon"><UIcon name="i-lucide-user-plus" /></span>
            <div>
              <strong>{{ inviteForm.email }}</strong>
              <span>{{ inviteForm.role === 'admin' ? 'Administrator organizacji' : 'Bez dostępu administracyjnego' }}</span>
            </div>
          </div>

          <div
            class="seat-quote__seats"
            :aria-label="inviteQuote.billingRequired ? 'Zmiana liczby płatnych miejsc' : 'Zmiana liczby członków'"
          >
            <div>
              <span>Teraz</span>
              <strong>{{ inviteQuote.currentSeats }}</strong>
              <small>miejsc</small>
            </div>
            <UIcon name="i-lucide-arrow-right" />
            <div class="seat-quote__seats-next">
              <span>Po dodaniu</span>
              <strong>{{ inviteQuote.nextSeats }}</strong>
              <small>miejsc</small>
            </div>
          </div>

          <div v-if="inviteQuote.billingRequired" class="seat-quote__monthly">
            <div>
              <span>Obecny koszt miesięczny</span>
              <strong>{{ formatMoney(inviteQuote.currentMonthlySubtotal, directory.billing.currency) }}</strong>
            </div>
            <UIcon name="i-lucide-arrow-right" />
            <div>
              <span>Nowy koszt miesięczny</span>
              <strong>{{ formatMoney(inviteQuote.nextMonthlySubtotal, directory.billing.currency) }}</strong>
            </div>
          </div>

          <div v-if="inviteQuote.billingRequired" class="seat-quote__charge">
            <div class="seat-quote__charge-heading">
              <div>
                <span>Do zapłaty dzisiaj</span>
                <small>
                  Dopłata za bieżący okres:
                  {{ formatMoney(inviteQuote.immediateAmount, directory.billing.currency) }}
                </small>
              </div>
              <strong>{{ formatMoney(inviteQuote.immediateAmount, directory.billing.currency) }}</strong>
            </div>
            <dl>
              <div>
                <dt>Wartość netto</dt>
                <dd>{{ formatMoney(inviteQuote.subtotal, directory.billing.currency) }}</dd>
              </div>
              <div v-if="inviteQuote.discountAmount">
                <dt>Rabat</dt>
                <dd>−{{ formatMoney(inviteQuote.discountAmount, directory.billing.currency) }}</dd>
              </div>
              <div v-if="inviteQuote.taxAmount">
                <dt>Podatek</dt>
                <dd>{{ formatMoney(inviteQuote.taxAmount, directory.billing.currency) }}</dd>
              </div>
            </dl>
          </div>

          <UAlert
            v-else
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            title="Wolne opłacone miejsce"
            description="Użytkownik zajmie jedno z miejsc kupionych wcześniej. Dodanie nie wymaga płatności kartą."
          />

          <p v-if="inviteQuote.billingRequired" class="seat-quote__renewal">
            <UIcon name="i-lucide-calendar-clock" />
            Nowa miesięczna kwota będzie obowiązywać przy odnowieniu
            <strong>{{ formatBillingDate(inviteQuote.renewalAt) }}</strong>.
          </p>
        </div>

        <div v-else-if="inviteStep === 'result' && seatChange" class="seat-change-result">
          <UAlert
            v-if="seatChange.status === 'requires_action'"
            color="warning"
            variant="subtle"
            icon="i-lucide-credit-card"
            title="Potwierdź płatność, aby aktywować miejsce"
            description="Bank wymaga dodatkowego potwierdzenia płatności. Użytkownik nie ma jeszcze dostępu do organizacji."
          >
            <template v-if="seatChange.paymentUrl" #actions>
              <UButton
                :to="seatChange.paymentUrl"
                target="_blank"
                rel="noopener noreferrer"
                trailing-icon="i-lucide-external-link"
              >
                Dokończ płatność
              </UButton>
            </template>
          </UAlert>

          <UAlert
            v-else
            color="info"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Płatność jest przetwarzana"
            description="Nie dodawaj użytkownika ponownie. Dostęp zostanie aktywowany automatycznie po potwierdzeniu płatności."
          />

          <p>
            Status tej zmiany pozostanie widoczny nad listą użytkowników. Możesz bezpiecznie zamknąć to okno.
          </p>
        </div>
      </template>

      <template #footer>
        <UButton color="neutral" variant="ghost" @click="closeInvite">
          {{ inviteStep === 'result' ? 'Zamknij' : 'Anuluj' }}
        </UButton>
        <UButton
          v-if="inviteStep === 'details'"
          type="submit"
          form="user-invite-form"
          trailing-icon="i-lucide-arrow-right"
          :loading="quoteLoading"
          :disabled="capacityHeldByInvitations"
        >
          {{ inviteIntoPaidCapacity ? 'Wyślij zaproszenie' : 'Sprawdź koszt' }}
        </UButton>
        <template v-else-if="inviteStep === 'quote' && inviteQuote">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-arrow-left"
            :disabled="inviting"
            @click="editInviteDetails"
          >
            Wróć
          </UButton>
          <UButton
            :icon="inviteQuote.billingRequired ? 'i-lucide-credit-card' : 'i-lucide-user-plus'"
            :loading="inviting"
            @click="confirmInvite"
          >
            {{ inviteQuote.billingRequired ? 'Dodaj i obciąż kartę' : 'Dodaj użytkownika' }}
          </UButton>
        </template>
        <UButton
          v-else-if="inviteStep === 'result' && seatChange?.paymentUrl"
          :to="seatChange.paymentUrl"
          target="_blank"
          rel="noopener noreferrer"
          trailing-icon="i-lucide-external-link"
        >
          Dokończ płatność
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

.users-billing-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.users-billing-summary :deep(.card) {
  height: 100%;
}

.users-billing-summary :deep(.card > div) {
  display: grid;
  gap: 5px;
}

.users-billing-summary span,
.users-billing-summary small {
  color: var(--ui-text-muted);
}

.users-billing-summary span {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.users-billing-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 24px;
  line-height: 1.15;
}

.users-billing-summary strong.users-billing-summary__date {
  font-size: 17px;
}

.users-billing-summary small {
  font-size: 11px;
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

.invite-progress {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.seat-quote,
.seat-change-result {
  display: grid;
  gap: 16px;
}

.seat-quote__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.seat-quote__identity-icon {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
}

.seat-quote__identity > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.seat-quote__identity strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-quote__identity div span,
.seat-quote__seats span,
.seat-quote__seats small,
.seat-quote__monthly span,
.seat-quote__charge small,
.seat-change-result p {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.seat-quote__seats {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 14px;
}

.seat-quote__seats > div {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 7px;
  padding: 13px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.seat-quote__seats > .seat-quote__seats-next {
  border-color: color-mix(in srgb, var(--ui-primary) 40%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg));
}

.seat-quote__seats strong {
  justify-self: end;
  color: var(--ui-text-highlighted);
  font-size: 24px;
}

.seat-quote__seats > :deep(svg),
.seat-quote__monthly > :deep(svg) {
  color: var(--ui-text-muted);
}

.seat-quote__monthly {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
}

.seat-quote__monthly > div {
  display: grid;
  gap: 3px;
}

.seat-quote__monthly > div:last-child {
  text-align: right;
}

.seat-quote__monthly strong {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.seat-quote__charge {
  display: grid;
  gap: 12px;
  padding: 15px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border));
  border-radius: 13px;
  background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg));
}

.seat-quote__charge-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.seat-quote__charge-heading > div {
  display: grid;
  gap: 2px;
}

.seat-quote__charge-heading span {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.seat-quote__charge-heading strong {
  color: var(--ui-text-highlighted);
  font-size: 24px;
  white-space: nowrap;
}

.seat-quote__charge dl {
  display: grid;
  gap: 5px;
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
}

.seat-quote__charge dl > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.seat-quote__charge dd {
  margin: 0;
  color: var(--ui-text);
  font-weight: 600;
}

.seat-quote__renewal {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.seat-quote__renewal :deep(svg) {
  flex: 0 0 auto;
  margin-top: 2px;
}

.seat-quote__renewal strong {
  color: var(--ui-text);
}

.seat-change-result p {
  margin: 0;
  line-height: 1.5;
}

@media (max-width: 820px) {
  .users-billing-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .users-toolbar__filters {
    grid-template-columns: 1fr 1fr 40px;
  }

  .users-toolbar__search {
    grid-column: 1 / -1;
  }
}

@media (max-width: 620px) {
  .users-billing-summary {
    grid-template-columns: 1fr;
  }

  .users-toolbar__filters {
    grid-template-columns: 1fr 40px;
  }

  .users-toolbar__filters > :nth-child(2),
  .users-toolbar__filters > :nth-child(3) {
    grid-column: 1 / -1;
  }

  .seat-quote__seats,
  .seat-quote__monthly {
    grid-template-columns: 1fr;
  }

  .seat-quote__seats > :deep(svg),
  .seat-quote__monthly > :deep(svg) {
    justify-self: center;
    rotate: 90deg;
  }

  .seat-quote__monthly > div:last-child {
    text-align: left;
  }
}
</style>
