<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, TableColumn } from '@nuxt/ui'
import type {
  CreateOrganizationInvitationBody,
  OrganizationInvitationBillingDiscount,
  OrganizationInvitationMutationResponse,
  SystemOrganizationInvitation,
  SystemOrganizationListItem,
  SystemOrganizationsResponse,
} from '#shared/types/system-organizations'
import type {
  PublicApplicationBillingPlanCode,
  BillingAccessState,
  OrganizationKind,
} from '#shared/organization-billing'
import { APPLICATION_BILLING_PLANS } from '#shared/organization-billing'
import { invitationBillingDiscountLabel } from '#shared/organization-invitation-discount'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/organizations',
})

useHead({ title: 'Organizacje — Administracja systemu — OpenExpert' })

type KindFilter = 'all' | OrganizationKind
type AccessFilter = 'all' | 'available' | 'payment_required' | 'attention'
type InviteDiscountKind = 'none' | 'percentage' | 'fixed_amount' | 'free_period'
type InviteDiscountDuration = OrganizationInvitationBillingDiscount['duration']

const emptyResponse = (): SystemOrganizationsResponse => ({
  data: [],
  invitations: [],
  stats: {
    totalOrganizations: 0,
    intermediaryOrganizations: 0,
    applicationOrganizations: 0,
    pendingInvitations: 0,
    subscriptionRequired: 0,
  },
})

const toast = useToast()
const search = ref('')
const kindFilter = ref<KindFilter>('all')
const accessFilter = ref<AccessFilter>('all')
const inviteOpen = ref(false)
const creating = ref(false)
const createdInvitation = ref<SystemOrganizationInvitation | null>(null)
const createdInviteUrl = ref('')
const busyInvitationIds = ref<string[]>([])
const revokeOpen = ref(false)
const revokeCandidate = ref<SystemOrganizationInvitation | null>(null)
const issuedInviteUrls = reactive<Record<string, string>>({})

const {
  data: payload,
  status,
  error,
  refresh,
} = await useFetch<SystemOrganizationsResponse>(
  '/api/system/organizations',
  { default: emptyResponse },
)

const inviteSchema = z.object({
  email: z.string().trim().email('Podaj poprawny adres email.').max(320),
  administratorName: z.string().trim().max(160, 'Imię i nazwisko może mieć maksymalnie 160 znaków.'),
  organizationName: z.string().trim().min(2, 'Nazwa musi mieć co najmniej 2 znaki.').max(160),
  organizationKind: z.enum(['intermediary', 'application']),
  billingPlan: z.enum(['individual', 'team']),
  initialSeatCount: z.number().int().min(1).max(100),
  billingDiscountKind: z.enum(['none', 'percentage', 'fixed_amount', 'free_period']),
  billingDiscountPercent: z.number().finite().nullish(),
  billingDiscountAmount: z.number().finite().nullish(),
  billingDiscountDuration: z.enum(['once', 'repeating', 'forever']),
  billingDiscountDurationMonths: z.number().int().nullish(),
}).superRefine((data, context) => {
  if (data.organizationKind === 'intermediary' && data.initialSeatCount !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['initialSeatCount'],
      message: 'Organizacja pośrednika rozpoczyna od jednego użytkownika.',
    })
  }
  if (data.organizationKind === 'application' && data.billingPlan === 'individual' && data.initialSeatCount !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['initialSeatCount'],
      message: 'Plan Indywidualny obejmuje dokładnie 1 użytkownika.',
    })
  }
  if (data.organizationKind === 'application' && data.billingPlan === 'team' && data.initialSeatCount < 3) {
    context.addIssue({
      code: 'custom',
      path: ['initialSeatCount'],
      message: 'Plan Zespół wymaga co najmniej 3 użytkowników.',
    })
  }
  if (data.organizationKind !== 'application' || data.billingDiscountKind === 'none') return

  if (data.billingDiscountKind === 'percentage') {
    if (typeof data.billingDiscountPercent !== 'number') {
      context.addIssue({
        code: 'custom',
        path: ['billingDiscountPercent'],
        message: 'Podaj wartość rabatu procentowego.',
      })
    }
    else if (data.billingDiscountPercent < 0.01 || data.billingDiscountPercent > 100) {
      context.addIssue({
        code: 'custom',
        path: ['billingDiscountPercent'],
        message: 'Podaj rabat od 0,01% do 100%.',
      })
    }
    else if (Math.abs(data.billingDiscountPercent * 100 - Math.round(data.billingDiscountPercent * 100)) > 1e-8) {
      context.addIssue({
        code: 'custom',
        path: ['billingDiscountPercent'],
        message: 'Rabat może mieć maksymalnie dwa miejsca po przecinku.',
      })
    }
  }

  if (data.billingDiscountKind === 'fixed_amount') {
    if (typeof data.billingDiscountAmount !== 'number') {
      context.addIssue({
        code: 'custom',
        path: ['billingDiscountAmount'],
        message: 'Podaj kwotę rabatu.',
      })
    }
    else if (data.billingDiscountAmount < 0.01 || data.billingDiscountAmount > 1_000_000) {
      context.addIssue({
        code: 'custom',
        path: ['billingDiscountAmount'],
        message: 'Podaj kwotę od 0,01 zł do 1 000 000 zł.',
      })
    }
    else if (Math.abs(data.billingDiscountAmount * 100 - Math.round(data.billingDiscountAmount * 100)) > 1e-8) {
      context.addIssue({
        code: 'custom',
        path: ['billingDiscountAmount'],
        message: 'Kwota może mieć maksymalnie dwa miejsca po przecinku.',
      })
    }
  }

  if (
    data.billingDiscountDuration === 'repeating'
    && (
      typeof data.billingDiscountDurationMonths !== 'number'
      || data.billingDiscountDurationMonths < 1
      || data.billingDiscountDurationMonths > 36
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['billingDiscountDurationMonths'],
      message: 'Wybierz okres od 1 do 36 miesięcy.',
    })
  }
})

type InviteSchema = z.output<typeof inviteSchema>

const inviteState = reactive<InviteSchema>({
  email: '',
  administratorName: '',
  organizationName: '',
  organizationKind: 'intermediary',
  billingPlan: 'individual',
  initialSeatCount: 1,
  billingDiscountKind: 'none',
  billingDiscountPercent: 10,
  billingDiscountAmount: 200,
  billingDiscountDuration: 'once',
  billingDiscountDurationMonths: 1,
})

const kindItems = [
  { label: 'Wszystkie rodzaje', value: 'all' },
  { label: 'Pośrednicy', value: 'intermediary' },
  { label: 'Aplikacje', value: 'application' },
]

const accessItems = [
  { label: 'Każdy stan dostępu', value: 'all' },
  { label: 'Dostęp aktywny', value: 'available' },
  { label: 'Wymaga płatności', value: 'payment_required' },
  { label: 'Wymaga uwagi', value: 'attention' },
]

const organizationKindItems = [
  { label: 'Pośrednik', value: 'intermediary' },
  { label: 'Aplikacja', value: 'application' },
]

const billingPlanItems: Array<{ label: string; value: PublicApplicationBillingPlanCode }> = [
  { label: 'Indywidualny — 200 zł netto + VAT / mies.', value: 'individual' },
  { label: 'Zespół — 150 zł netto + VAT / os. / mies.', value: 'team' },
]

const discountKindItems: Array<{
  label: string
  value: InviteDiscountKind
  description: string
}> = [
  {
    label: 'Brak rabatu',
    value: 'none',
    description: 'Administrator może użyć własnego kodu promocyjnego w Stripe Checkout.',
  },
  {
    label: 'Procent',
    value: 'percentage',
    description: 'Rabat skaluje się razem z liczbą opłaconych miejsc.',
  },
  {
    label: 'Kwotowy PLN',
    value: 'fixed_amount',
    description: 'Stała kwota jest odejmowana od całej faktury organizacji.',
  },
  {
    label: 'Darmowy okres',
    value: 'free_period',
    description: '100% rabatu przez wskazany okres rozliczeniowy.',
  },
]

const discountDurationItems: Array<{
  label: string
  value: InviteDiscountDuration
}> = [
  { label: 'Pierwsza faktura', value: 'once' },
  { label: 'Przez określoną liczbę miesięcy', value: 'repeating' },
  { label: 'Bezterminowo', value: 'forever' },
]

const organizationColumns: TableColumn<SystemOrganizationListItem>[] = [
  { accessorKey: 'name', header: 'Organizacja' },
  { id: 'kind', header: 'Rodzaj' },
  { id: 'onboarding', header: 'Onboarding' },
  { id: 'billing', header: 'Rozliczenia' },
  { id: 'offer', header: 'Oferta' },
  { id: 'members', header: 'Użytkownicy' },
  { id: 'createdAt', header: 'Utworzono' },
]

const invitationColumns: TableColumn<SystemOrganizationInvitation>[] = [
  { accessorKey: 'email', header: 'Administrator' },
  { id: 'organization', header: 'Organizacja' },
  { id: 'kind', header: 'Rodzaj' },
  { id: 'offer', header: 'Oferta' },
  { id: 'status', header: 'Status' },
  { id: 'delivery', header: 'Wysyłka' },
  { id: 'expiresAt', header: 'Ważne do' },
  { id: 'actions', header: '' },
]

const filteredOrganizations = computed(() => {
  const tokens = search.value
    .trim()
    .toLocaleLowerCase('pl')
    .split(/\s+/u)
    .filter(Boolean)

  return payload.value.data.filter((organization) => {
    if (kindFilter.value !== 'all' && organization.kind !== kindFilter.value) return false
    if (accessFilter.value !== 'all' && !matchesAccessFilter(organization.billingAccessState, accessFilter.value)) {
      return false
    }
    if (!tokens.length) return true

    const haystack = [
      organization.name,
      organization.slug,
      organization.administratorName,
      organization.administratorEmail,
      kindDetails(organization.kind).label,
      billingDetails(organization.billingAccessState).label,
    ].filter(Boolean).join(' ').toLocaleLowerCase('pl')

    return tokens.every(token => haystack.includes(token))
  })
})

const pendingInvitations = computed(() => payload.value.invitations.filter(invitation => (
  invitation.status === 'pending'
)))
const actionableInvitations = computed(() => payload.value.invitations.filter(invitation => (
  invitation.status === 'pending' || invitation.status === 'expired'
)))

const hasActiveFilters = computed(() => (
  Boolean(search.value.trim())
  || kindFilter.value !== 'all'
  || accessFilter.value !== 'all'
))

const hasFullForeverDiscount = computed(() => (
  inviteState.organizationKind === 'application'
  && inviteState.billingDiscountDuration === 'forever'
  && (
    inviteState.billingDiscountKind === 'free_period'
    || (
      inviteState.billingDiscountKind === 'percentage'
      && (inviteState.billingDiscountPercent ?? 0) >= 100
    )
  )
))

const effectiveStats = computed(() => ({
  totalOrganizations: finiteStat(payload.value.stats.totalOrganizations, payload.value.data.length),
  intermediaryOrganizations: finiteStat(
    payload.value.stats.intermediaryOrganizations,
    payload.value.data.filter(item => item.kind === 'intermediary').length,
  ),
  applicationOrganizations: finiteStat(
    payload.value.stats.applicationOrganizations,
    payload.value.data.filter(item => item.kind === 'application').length,
  ),
  pendingInvitations: finiteStat(
    payload.value.stats.pendingInvitations,
    pendingInvitations.value.length,
  ),
  subscriptionRequired: finiteStat(
    payload.value.stats.subscriptionRequired,
    payload.value.data.filter(item => item.billingAccessState === 'subscription_required').length,
  ),
}))

const statCards = computed(() => [
  {
    label: 'Organizacje',
    value: effectiveStats.value.totalOrganizations,
    description: `${effectiveStats.value.intermediaryOrganizations} pośredników`,
    icon: 'i-lucide-building-2',
    tone: 'neutral',
  },
  {
    label: 'Aplikacje',
    value: effectiveStats.value.applicationOrganizations,
    description: 'Indywidualny 200 zł lub Zespół 150 zł/os. + VAT',
    icon: 'i-lucide-panels-top-left',
    tone: 'primary',
  },
  {
    label: 'Oczekujące zaproszenia',
    value: effectiveStats.value.pendingInvitations,
    description: 'Linki jeszcze nieprzyjęte',
    icon: 'i-lucide-mail-clock',
    tone: 'warning',
  },
  {
    label: 'Płatność wymagana',
    value: effectiveStats.value.subscriptionRequired,
    description: 'Aplikacje bez aktywnej subskrypcji',
    icon: 'i-lucide-credit-card',
    tone: effectiveStats.value.subscriptionRequired ? 'error' : 'success',
  },
])

const loadingList = computed(() => status.value === 'pending' && !payload.value.data.length)
const listError = computed(() => error.value ? apiErrorMessage(error.value) : '')

function finiteStat(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function matchesAccessFilter(state: BillingAccessState, filter: Exclude<AccessFilter, 'all'>) {
  if (filter === 'available') return ['not_required', 'active', 'grace'].includes(state)
  if (filter === 'payment_required') return state === 'subscription_required'
  return state === 'blocked' || state === 'grace'
}

function kindDetails(kind: OrganizationKind) {
  return kind === 'application'
    ? { label: 'Aplikacja', icon: 'i-lucide-panels-top-left', color: 'primary' as const }
    : { label: 'Pośrednik', icon: 'i-lucide-handshake', color: 'neutral' as const }
}

function invitationStatusDetails(status: SystemOrganizationInvitation['status']) {
  if (status === 'expired') {
    return { label: 'Wygasło', color: 'neutral' as const, icon: 'i-lucide-clock-alert' }
  }
  return { label: 'Oczekuje', color: 'warning' as const, icon: 'i-lucide-mail-clock' }
}

function billingDetails(state: BillingAccessState) {
  const details: Record<BillingAccessState, {
    label: string
    description: string
    color: 'neutral' | 'success' | 'warning' | 'error'
  }> = {
    not_required: {
      label: 'Nie dotyczy',
      description: 'Bez płatnej subskrypcji',
      color: 'neutral',
    },
    subscription_required: {
      label: 'Subskrypcja wymagana',
      description: 'Oczekuje na checkout',
      color: 'warning',
    },
    active: {
      label: 'Aktywna',
      description: 'Dostęp opłacony',
      color: 'success',
    },
    grace: {
      label: 'Okres ochronny',
      description: 'Płatność wymaga uwagi',
      color: 'warning',
    },
    blocked: {
      label: 'Zablokowana',
      description: 'Brak dostępu do aplikacji',
      color: 'error',
    },
  }

  return details[state]
}

function onboardingDetails(organization: SystemOrganizationListItem) {
  if (organization.kind === 'intermediary' || organization.billingAccessState === 'active') {
    return { label: 'Ukończony', color: 'success' as const, icon: 'i-lucide-circle-check' }
  }
  if (organization.billingAccessState === 'subscription_required') {
    return { label: 'Oczekuje na płatność', color: 'warning' as const, icon: 'i-lucide-clock-3' }
  }
  if (organization.billingAccessState === 'grace') {
    return { label: 'Ukończony', color: 'success' as const, icon: 'i-lucide-circle-check' }
  }
  return { label: 'Wymaga działania', color: 'error' as const, icon: 'i-lucide-circle-alert' }
}

function resetFilters() {
  search.value = ''
  kindFilter.value = 'all'
  accessFilter.value = 'all'
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pl-PL', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date)
}

function resetInviteDiscount() {
  inviteState.billingDiscountKind = 'none'
  inviteState.billingDiscountPercent = 10
  inviteState.billingDiscountAmount = 200
  inviteState.billingDiscountDuration = 'once'
  inviteState.billingDiscountDurationMonths = 1
}

function buildInvitationBillingDiscount(
  data: InviteSchema,
): OrganizationInvitationBillingDiscount | null {
  if (data.organizationKind !== 'application' || data.billingDiscountKind === 'none') return null

  const durationMonths = data.billingDiscountDuration === 'repeating'
    ? data.billingDiscountDurationMonths ?? null
    : null

  if (data.billingDiscountKind === 'fixed_amount') {
    return {
      kind: 'fixed_amount',
      amountOffMinor: Math.round(data.billingDiscountAmount! * 100),
      currency: 'pln',
      duration: data.billingDiscountDuration,
      durationMonths,
    }
  }

  return {
    kind: 'percentage',
    percentOffBps: data.billingDiscountKind === 'free_period'
      ? 10_000
      : Math.round(data.billingDiscountPercent! * 100),
    duration: data.billingDiscountDuration,
    durationMonths,
  }
}

watch(() => inviteState.organizationKind, (kind) => {
  if (kind !== 'application') {
    inviteState.initialSeatCount = 1
    resetInviteDiscount()
  }
})

watch(() => inviteState.billingPlan, (plan) => {
  if (inviteState.organizationKind !== 'application') return
  inviteState.initialSeatCount = plan === 'individual'
    ? 1
    : Math.max(3, inviteState.initialSeatCount)
})

function openInvite() {
  resetInviteForm()
  inviteOpen.value = true
}

function resetInviteForm() {
  inviteState.email = ''
  inviteState.administratorName = ''
  inviteState.organizationName = ''
  inviteState.organizationKind = 'intermediary'
  inviteState.billingPlan = 'individual'
  inviteState.initialSeatCount = 1
  resetInviteDiscount()
  createdInvitation.value = null
  createdInviteUrl.value = ''
}

async function createInvitation(event: FormSubmitEvent<InviteSchema>) {
  creating.value = true
  try {
    const billingDiscount = buildInvitationBillingDiscount(event.data)
    const body: CreateOrganizationInvitationBody = {
      email: event.data.email.trim().toLocaleLowerCase('pl'),
      organizationName: event.data.organizationName.trim(),
      organizationKind: event.data.organizationKind,
      ...(event.data.organizationKind === 'application'
        ? { billingPlan: event.data.billingPlan }
        : {}),
      initialSeatCount: event.data.initialSeatCount,
      ...(event.data.administratorName.trim()
        ? { administratorName: event.data.administratorName.trim() }
        : {}),
      ...(billingDiscount ? { billingDiscount } : {}),
    }
    const result = await $fetch<OrganizationInvitationMutationResponse>(
      '/api/system/organization-invitations',
      {
        method: 'POST',
        body,
      },
    )

    const inviteUrl = result.inviteUrl || result.invitation.inviteUrl || ''
    createdInvitation.value = result.invitation
    createdInviteUrl.value = inviteUrl
    if (inviteUrl) issuedInviteUrls[result.invitation.id] = inviteUrl

    toast.add({
      title: 'Zaproszenie zostało utworzone',
      description: 'Link jest gotowy do wysłania administratorowi organizacji.',
      color: 'success',
      icon: 'i-lucide-mail-check',
    })
    await refresh()
  }
  catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się utworzyć zaproszenia',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    creating.value = false
  }
}

function isInvitationBusy(id: string) {
  return busyInvitationIds.value.includes(id)
}

function setInvitationBusy(id: string, busy: boolean) {
  busyInvitationIds.value = busy
    ? [...new Set([...busyInvitationIds.value, id])]
    : busyInvitationIds.value.filter(candidate => candidate !== id)
}

async function resendInvitation(invitation: SystemOrganizationInvitation) {
  setInvitationBusy(invitation.id, true)
  try {
    const result = await $fetch<OrganizationInvitationMutationResponse>(
      `/api/system/organization-invitations/${encodeURIComponent(invitation.id)}/resend`,
      { method: 'POST', body: {} },
    )
    const inviteUrl = result.inviteUrl || result.invitation.inviteUrl || ''
    if (inviteUrl) issuedInviteUrls[invitation.id] = inviteUrl
    toast.add({
      title: 'Zaproszenie wysłane ponownie',
      description: inviteUrl
        ? 'Token został odnowiony. Nowy link możesz teraz skopiować.'
        : 'Administrator otrzymał nową wiadomość z zaproszeniem.',
      color: 'success',
      icon: 'i-lucide-send',
    })
    await refresh()
  }
  catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się wysłać zaproszenia',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    setInvitationBusy(invitation.id, false)
  }
}

function invitationUrl(invitation: SystemOrganizationInvitation) {
  return issuedInviteUrls[invitation.id] || invitation.inviteUrl || ''
}

async function copyInvitationUrl(invitation: SystemOrganizationInvitation) {
  const url = invitationUrl(invitation)
  if (!url) {
    toast.add({
      title: 'Najpierw odnów link',
      description: 'Ze względów bezpieczeństwa wcześniej wydanego tokenu nie można ponownie odczytać. Użyj „Wyślij ponownie”, a potem skopiuj nowy link.',
      color: 'warning',
      icon: 'i-lucide-link-2-off',
    })
    return
  }

  try {
    const absoluteUrl = new URL(url, window.location.origin).toString()
    await navigator.clipboard.writeText(absoluteUrl)
    toast.add({
      title: 'Link skopiowany',
      description: 'Możesz bezpiecznie przekazać go administratorowi organizacji.',
      color: 'success',
      icon: 'i-lucide-copy-check',
    })
  }
  catch {
    toast.add({
      title: 'Nie udało się skopiować linku',
      description: 'Skopiuj adres z wiadomości z zaproszeniem lub spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

function askToRevoke(invitation: SystemOrganizationInvitation) {
  revokeCandidate.value = invitation
  revokeOpen.value = true
}

async function revokeInvitation() {
  const invitation = revokeCandidate.value
  if (!invitation) return

  setInvitationBusy(invitation.id, true)
  try {
    await $fetch(
      `/api/system/organization-invitations/${encodeURIComponent(invitation.id)}/revoke`,
      { method: 'POST', body: {} },
    )
    delete issuedInviteUrls[invitation.id]
    revokeOpen.value = false
    revokeCandidate.value = null
    toast.add({
      title: 'Zaproszenie zostało unieważnione',
      description: 'Dotychczasowy link nie pozwoli już utworzyć organizacji.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
    await refresh()
  }
  catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się unieważnić zaproszenia',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    setInvitationBusy(invitation.id, false)
  }
}
</script>

<template>
  <CrmShell
    title="Organizacje"
    eyebrow="Administracja systemu"
    description="Zarządzaj onboardingiem pośredników i aplikacji, monitoruj dostęp subskrypcyjny oraz wydawaj bezpieczne zaproszenia administratorom."
  >
    <template #meta>
      <div class="organizations-page__meta">
        <UBadge color="neutral" variant="outline" icon="i-lucide-shield-check">
          Widok superadministratora
        </UBadge>
        <span>{{ effectiveStats.totalOrganizations }} organizacji</span>
      </div>
    </template>

    <template #actions>
      <UButton icon="i-lucide-building-2" @click="openInvite">
        Zaproś organizację
      </UButton>
    </template>

    <div class="organizations-page">
      <section class="organizations-stats" aria-label="Podsumowanie organizacji">
        <UCard
          v-for="metric in statCards"
          :key="metric.label"
          class="organizations-stat"
        >
          <div class="organizations-stat__top">
            <span class="organizations-stat__label">{{ metric.label }}</span>
            <span class="organizations-stat__icon" :data-tone="metric.tone" aria-hidden="true">
              <UIcon :name="metric.icon" />
            </span>
          </div>
          <strong>{{ metric.value }}</strong>
          <small>{{ metric.description }}</small>
        </UCard>
      </section>

      <UCard class="organizations-registry" :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <div class="organizations-toolbar">
            <div class="organizations-toolbar__heading">
              <div>
                <span>REJESTR</span>
                <h2>Wszystkie organizacje</h2>
                <p>Stan onboardingu i rozliczeń jest aktualizowany po zdarzeniach Stripe.</p>
              </div>
              <span class="organizations-toolbar__count">
                {{ filteredOrganizations.length }} z {{ payload.data.length }}
              </span>
            </div>

            <div class="organizations-toolbar__filters">
              <UInput
                v-model="search"
                class="organizations-toolbar__search"
                icon="i-lucide-search"
                placeholder="Szukaj nazwy, administratora lub slugu"
                aria-label="Szukaj organizacji"
              />
              <USelect
                v-model="kindFilter"
                :items="kindItems"
                value-key="value"
                aria-label="Filtr rodzaju organizacji"
              />
              <USelect
                v-model="accessFilter"
                :items="accessItems"
                value-key="value"
                aria-label="Filtr stanu dostępu"
              />
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-filter-x"
                :disabled="!hasActiveFilters"
                aria-label="Wyczyść filtry"
                @click="resetFilters"
              />
            </div>
          </div>
        </template>

        <div v-if="loadingList" class="organizations-loading" aria-label="Ładowanie organizacji">
          <USkeleton v-for="index in 5" :key="index" class="h-14 w-full" />
        </div>

        <div v-else-if="listError" class="organizations-state">
          <UAlert
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się pobrać organizacji"
            :description="listError"
          />
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="() => refresh()">
            Spróbuj ponownie
          </UButton>
        </div>

        <div v-else-if="filteredOrganizations.length" class="organizations-table">
          <UTable
            :data="filteredOrganizations"
            :columns="organizationColumns"
            :ui="{
              root: 'overflow-x-auto',
              base: 'min-w-[1060px]',
              th: 'px-4 py-3 text-xs font-semibold text-muted',
              td: 'px-4 py-3 align-middle',
              tr: 'transition-colors hover:bg-elevated/50',
            }"
          >
            <template #name-cell="{ row }">
              <div class="organization-cell">
                <span class="organization-cell__avatar" aria-hidden="true">
                  {{ row.original.name.slice(0, 2).toLocaleUpperCase('pl') }}
                </span>
                <div>
                  <strong>{{ row.original.name }}</strong>
                  <small>
                    {{ row.original.administratorName || row.original.administratorEmail || row.original.slug }}
                  </small>
                </div>
              </div>
            </template>

            <template #kind-cell="{ row }">
              <UBadge
                :color="kindDetails(row.original.kind).color"
                variant="subtle"
                :icon="kindDetails(row.original.kind).icon"
              >
                {{ kindDetails(row.original.kind).label }}
              </UBadge>
            </template>

            <template #onboarding-cell="{ row }">
              <UBadge
                :color="onboardingDetails(row.original).color"
                variant="subtle"
                :icon="onboardingDetails(row.original).icon"
              >
                {{ onboardingDetails(row.original).label }}
              </UBadge>
            </template>

            <template #billing-cell="{ row }">
              <div class="organization-status-cell">
                <UBadge :color="billingDetails(row.original.billingAccessState).color" variant="subtle">
                  {{ billingDetails(row.original.billingAccessState).label }}
                </UBadge>
                <small>{{ billingDetails(row.original.billingAccessState).description }}</small>
              </div>
            </template>

            <template #offer-cell="{ row }">
              <div v-if="row.original.billingDiscount" class="invitation-offer">
                <UBadge color="primary" variant="subtle" icon="i-lucide-ticket-percent">
                  Onboardingowa
                </UBadge>
                <small>{{ invitationBillingDiscountLabel(row.original.billingDiscount) }}</small>
              </div>
              <span v-else class="invitation-offer__muted">—</span>
            </template>

            <template #members-cell="{ row }">
              <span class="organization-members">
                <UIcon name="i-lucide-users-round" />
                {{ row.original.memberCount ?? 0 }}
              </span>
            </template>

            <template #createdAt-cell="{ row }">
              <span class="organization-date">{{ formatDate(row.original.createdAt) }}</span>
            </template>

          </UTable>
        </div>

        <OeEmptyState
          v-else
          class="organizations-empty"
          :kind="payload.data.length ? 'filtered' : 'empty'"
          :icon="payload.data.length ? 'i-lucide-building-2-off' : 'i-lucide-building-2'"
          :title="payload.data.length ? 'Brak pasujących organizacji' : 'Nie ma jeszcze organizacji'"
          :description="payload.data.length
            ? 'Zmień wyszukiwaną frazę lub filtry.'
            : 'Wyślij pierwsze zaproszenie, aby rozpocząć bezpieczny onboarding administratora.'"
        >
          <template #actions>
            <UButton
              v-if="payload.data.length"
              color="neutral"
              variant="outline"
              icon="i-lucide-filter-x"
              @click="resetFilters"
            >
              Wyczyść filtry
            </UButton>
            <UButton v-else icon="i-lucide-building-2" @click="openInvite">
              Zaproś organizację
            </UButton>
          </template>
        </OeEmptyState>
      </UCard>

      <UCard class="invitations-registry" :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <div class="invitations-heading">
            <div>
              <span>ZAPROSZENIA</span>
              <h2>Zaproszenia do obsługi</h2>
              <p>Wygasłe zaproszenie możesz odnowić. Ponowne wysłanie rotuje token i unieważnia wcześniejszy link.</p>
            </div>
            <UBadge color="warning" variant="subtle" icon="i-lucide-mail-clock">
              {{ actionableInvitations.length }} do obsługi
            </UBadge>
          </div>
        </template>

        <div v-if="actionableInvitations.length" class="organizations-table">
          <UTable
            :data="actionableInvitations"
            :columns="invitationColumns"
            :ui="{
              root: 'overflow-x-auto',
              base: 'min-w-[1160px]',
              th: 'px-4 py-3 text-xs font-semibold text-muted',
              td: 'px-4 py-3 align-middle',
              tr: 'transition-colors hover:bg-elevated/50',
            }"
          >
            <template #email-cell="{ row }">
              <div class="invitation-recipient">
                <strong>{{ row.original.administratorName || 'Administrator' }}</strong>
                <small>{{ row.original.email }}</small>
              </div>
            </template>

            <template #organization-cell="{ row }">
              <strong class="invitation-organization">{{ row.original.organizationName }}</strong>
            </template>

            <template #kind-cell="{ row }">
              <UBadge
                :color="kindDetails(row.original.organizationKind).color"
                variant="subtle"
                :icon="kindDetails(row.original.organizationKind).icon"
              >
                {{ kindDetails(row.original.organizationKind).label }}
              </UBadge>
            </template>

            <template #offer-cell="{ row }">
              <div class="invitation-offer">
                <strong v-if="row.original.organizationKind === 'application'">
                  {{ row.original.billingPlan === 'individual' ? 'Indywidualny' : row.original.billingPlan === 'team' ? 'Zespół' : 'Plan starszy' }}
                  · {{ row.original.initialSeatCount }} {{ row.original.initialSeatCount === 1 ? 'miejsce' : 'miejsca' }}
                </strong>
                <template v-if="row.original.billingDiscount">
                  <UBadge color="primary" variant="subtle" icon="i-lucide-ticket-percent">
                    Przypisany rabat
                  </UBadge>
                  <small>{{ invitationBillingDiscountLabel(row.original.billingDiscount) }}</small>
                </template>
                <template v-else-if="row.original.organizationKind === 'application'">
                  <span>Kod w Stripe Checkout</span>
                  <small>Brak przypisanego rabatu</small>
                </template>
                <span v-else class="invitation-offer__muted">Nie dotyczy</span>
              </div>
            </template>

            <template #status-cell="{ row }">
              <UBadge
                :color="invitationStatusDetails(row.original.status).color"
                variant="subtle"
                :icon="invitationStatusDetails(row.original.status).icon"
              >
                {{ invitationStatusDetails(row.original.status).label }}
              </UBadge>
            </template>

            <template #delivery-cell="{ row }">
              <div class="organization-status-cell">
                <UBadge
                  :color="row.original.lastDeliveryError ? 'error' : 'success'"
                  variant="subtle"
                  :icon="row.original.lastDeliveryError ? 'i-lucide-mail-warning' : 'i-lucide-mail-check'"
                >
                  {{ row.original.lastDeliveryError ? 'Błąd wysyłki' : 'Wysłano' }}
                </UBadge>
                <small>{{ formatDate(row.original.sentAt, true) }}</small>
              </div>
            </template>

            <template #expiresAt-cell="{ row }">
              <span class="organization-date">{{ formatDate(row.original.expiresAt, true) }}</span>
            </template>

            <template #actions-cell="{ row }">
              <div class="invitation-actions">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  :disabled="row.original.status === 'expired' || isInvitationBusy(row.original.id)"
                  :aria-label="`Kopiuj link dla ${row.original.email}`"
                  :title="row.original.status === 'expired'
                    ? 'Najpierw odnów wygasłe zaproszenie'
                    : 'Kopiuj aktualnie wydany link'"
                  @click="copyInvitationUrl(row.original)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="isInvitationBusy(row.original.id)"
                  :aria-label="`Wyślij ponownie do ${row.original.email}`"
                  title="Wyślij ponownie i odnow token"
                  @click="resendInvitation(row.original)"
                />
                <UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-ban"
                  :disabled="isInvitationBusy(row.original.id)"
                  :aria-label="`Unieważnij zaproszenie dla ${row.original.email}`"
                  title="Unieważnij zaproszenie"
                  @click="askToRevoke(row.original)"
                />
              </div>
            </template>
          </UTable>
        </div>

        <OeEmptyState
          v-else
          class="organizations-empty"
          kind="empty"
          icon="i-lucide-mail-check"
          title="Brak zaproszeń do obsługi"
          description="Wszystkie wysłane zaproszenia zostały przyjęte albo unieważnione."
        >
          <template #actions>
            <UButton color="neutral" variant="outline" icon="i-lucide-building-2" @click="openInvite">
              Nowe zaproszenie
            </UButton>
          </template>
        </OeEmptyState>
      </UCard>
    </div>

    <USlideover
      v-model:open="inviteOpen"
      title="Zaproś organizację"
      description="Przygotuj organizację i bezpieczny link dla jej pierwszego administratora."
      :dismissible="!creating"
      :ui="{ content: 'sm:max-w-xl' }"
      @after:leave="resetInviteForm"
    >
      <template #body>
        <div v-if="createdInvitation" class="invitation-success">
          <span class="invitation-success__icon" aria-hidden="true">
            <UIcon name="i-lucide-mail-check" />
          </span>
          <div>
            <h3>Zaproszenie jest gotowe</h3>
            <p>
              {{ createdInvitation.administratorName || createdInvitation.email }} może teraz założyć
              <strong>{{ createdInvitation.organizationName }}</strong>.
            </p>
          </div>

          <UAlert
            color="success"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="Link jednorazowy"
            description="Po ponownym wysłaniu ten adres przestanie działać i zostanie zastąpiony nowym tokenem."
          />

          <UAlert
            v-if="createdInvitation.organizationKind === 'application' && createdInvitation.billingDiscount"
            color="primary"
            variant="subtle"
            icon="i-lucide-ticket-percent"
            title="Oferta przypisana do zaproszenia"
            :description="`${invitationBillingDiscountLabel(createdInvitation.billingDiscount)}. Rabat zostanie naliczony automatycznie podczas uruchamiania subskrypcji.`"
          />

          <div v-if="createdInviteUrl" class="invitation-url">
            <UInput :model-value="createdInviteUrl" readonly aria-label="Link zaproszenia" />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-copy"
              @click="copyInvitationUrl(createdInvitation)"
            >
              Kopiuj link
            </UButton>
          </div>
        </div>

        <UForm
          v-else
          id="organization-invite-form"
          :schema="inviteSchema"
          :state="inviteState"
          class="organization-invite-form"
          @submit="createInvitation"
        >
          <UFormField
            name="organizationName"
            label="Nazwa organizacji"
            description="Nazwa widoczna w CRM i na ekranie płatności."
            required
          >
            <UInput
              v-model="inviteState.organizationName"
              class="w-full"
              placeholder="np. Finanse Kowalscy"
              icon="i-lucide-building-2"
              autofocus
            />
          </UFormField>

          <UFormField
            v-if="inviteState.organizationKind === 'application'"
            name="billingPlan"
            label="Pakiet"
            description="Plan Indywidualny można później zmienić na Zespół z dokładnym wyliczeniem dopłaty."
            required
          >
            <USelect
              v-model="inviteState.billingPlan"
              :items="billingPlanItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField
            name="organizationKind"
            label="Rodzaj organizacji"
            description="Rodzaj określa przebieg onboardingu i wymagania rozliczeniowe."
            required
          >
            <USelect
              v-model="inviteState.organizationKind"
              :items="organizationKindItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="inviteState.organizationKind === 'application'"
            name="initialSeatCount"
            label="Opłacone miejsca na start"
            description="Administrator zajmie pierwsze miejsce. Pozostałe można przydzielić później bez ponownego obciążenia karty."
            required
          >
            <UInputNumber
              v-model="inviteState.initialSeatCount"
              :min="inviteState.billingPlan === 'team' ? 3 : 1"
              :max="100"
              :step="1"
              class="w-full"
              :disabled="inviteState.billingPlan === 'individual'"
            />
          </UFormField>

          <UAlert
            v-if="inviteState.organizationKind === 'application'"
            color="primary"
            variant="subtle"
            icon="i-lucide-credit-card"
            :title="`Plan ${inviteState.billingPlan === 'individual' ? 'Indywidualny' : 'Zespół'}: ${(inviteState.initialSeatCount * APPLICATION_BILLING_PLANS[inviteState.billingPlan].unitAmount) / 100} zł netto + VAT / miesiąc`"
            description="Możesz przypisać ofertę do tego zaproszenia albo pozostawić administratorowi możliwość wpisania kodu promocyjnego w Stripe Checkout."
          />

          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-handshake"
            title="Bez płatnego onboardingu"
            description="Pośrednik otrzyma dostęp do pulpitu od razu po przyjęciu zaproszenia."
          />

          <section
            v-if="inviteState.organizationKind === 'application'"
            class="invitation-discount"
            aria-labelledby="invitation-discount-title"
          >
            <div class="invitation-discount__heading">
              <span class="invitation-discount__icon" aria-hidden="true">
                <UIcon name="i-lucide-badge-percent" />
              </span>
              <div>
                <h3 id="invitation-discount-title">Oferta dla organizacji</h3>
                <p>Rabat zostanie trwale związany z tym zaproszeniem.</p>
              </div>
            </div>

            <UFormField
              name="billingDiscountKind"
              label="Rodzaj rabatu"
              description="Wybierz jedną ofertę albo pozostaw standardowy checkout z polem na kod."
              required
            >
              <URadioGroup
                v-model="inviteState.billingDiscountKind"
                :items="discountKindItems"
              />
            </UFormField>

            <template v-if="inviteState.billingDiscountKind !== 'none'">
              <UFormField
                v-if="inviteState.billingDiscountKind === 'percentage'"
                name="billingDiscountPercent"
                label="Wartość rabatu procentowego"
                description="Procent obniża całą subskrypcję i skaluje się wraz z liczbą miejsc."
                required
              >
                <UInputNumber
                  v-model="inviteState.billingDiscountPercent"
                  class="w-full"
                  :min="0.01"
                  :max="100"
                  :step="0.01"
                  :format-options="{ maximumFractionDigits: 2 }"
                />
              </UFormField>

              <UFormField
                v-if="inviteState.billingDiscountKind === 'fixed_amount'"
                name="billingDiscountAmount"
                label="Kwota rabatu"
                description="Kwota jest odejmowana od całej miesięcznej faktury organizacji, a nie od każdego miejsca."
                required
              >
                <UInputNumber
                  v-model="inviteState.billingDiscountAmount"
                  class="w-full"
                  :min="0.01"
                  :max="1000000"
                  :step="0.01"
                  :format-options="{
                    style: 'currency',
                    currency: 'PLN',
                    maximumFractionDigits: 2,
                  }"
                />
              </UFormField>

              <UAlert
                v-if="inviteState.billingDiscountKind === 'free_period'"
                color="primary"
                variant="subtle"
                icon="i-lucide-gift"
                title="100% rabatu"
                description="Organizacja nie zapłaci za subskrypcję przez wybrany poniżej okres."
              />

              <UFormField
                name="billingDiscountDuration"
                label="Czas obowiązywania"
                description="Określa, przez ile cykli Stripe będzie stosować ofertę."
                required
              >
                <USelect
                  v-model="inviteState.billingDiscountDuration"
                  :items="discountDurationItems"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="inviteState.billingDiscountDuration === 'repeating'"
                name="billingDiscountDurationMonths"
                label="Liczba miesięcy"
                description="Oferta może obowiązywać od 1 do 36 miesięcy."
                required
              >
                <UInputNumber
                  v-model="inviteState.billingDiscountDurationMonths"
                  class="w-full"
                  :min="1"
                  :max="36"
                  :step="1"
                />
              </UFormField>

              <UAlert
                v-if="hasFullForeverDiscount"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                title="Bezpłatna subskrypcja bez końca"
                description="100% rabatu bezterminowego obejmie także wszystkie przyszłe miejsca. Sprawdź, czy taki jest zamierzony warunek handlowy."
              />
            </template>
          </section>

          <UFormField
            name="email"
            label="Email administratora"
            description="Zaproszenie można przyjąć wyłącznie na koncie z tym adresem."
            required
          >
            <UInput
              v-model="inviteState.email"
              class="w-full"
              type="email"
              placeholder="admin@firma.pl"
              icon="i-lucide-mail"
            />
          </UFormField>

          <UFormField
            name="administratorName"
            label="Imię i nazwisko administratora"
            description="Opcjonalne — ułatwia identyfikację zaproszenia."
          >
            <UInput
              v-model="inviteState.administratorName"
              class="w-full"
              placeholder="Anna Kowalska"
              icon="i-lucide-user-round"
            />
          </UFormField>
        </UForm>
      </template>

      <template #footer="{ close }">
        <template v-if="createdInvitation">
          <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="resetInviteForm">
            Kolejne zaproszenie
          </UButton>
          <UButton icon="i-lucide-check" @click="close">
            Gotowe
          </UButton>
        </template>
        <template v-else>
          <UButton color="neutral" variant="ghost" :disabled="creating" @click="close">
            Anuluj
          </UButton>
          <UButton
            type="submit"
            form="organization-invite-form"
            icon="i-lucide-send"
            :loading="creating"
          >
            Utwórz i wyślij
          </UButton>
        </template>
      </template>
    </USlideover>

    <UModal
      v-model:open="revokeOpen"
      title="Unieważnić zaproszenie?"
      description="Administrator nie będzie mógł użyć dotychczasowego linku. Tej operacji nie można cofnąć."
      :dismissible="!revokeCandidate || !isInvitationBusy(revokeCandidate.id)"
      :ui="{ content: 'sm:max-w-lg', footer: 'justify-end' }"
      @after:leave="revokeCandidate = null"
    >
      <template #body>
        <UAlert
          v-if="revokeCandidate"
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="revokeCandidate.organizationName"
          :description="`Zaproszenie dla ${revokeCandidate.email} zostanie oznaczone jako unieważnione.`"
        />
      </template>
      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="Boolean(revokeCandidate && isInvitationBusy(revokeCandidate.id))"
          @click="close"
        >
          Anuluj
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-ban"
          :loading="Boolean(revokeCandidate && isInvitationBusy(revokeCandidate.id))"
          @click="revokeInvitation"
        >
          Unieważnij zaproszenie
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.organizations-page {
  display: grid;
  gap: 22px;
}

.organizations-page__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.organizations-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.organizations-stat :deep(.divide-y) {
  height: 100%;
}

.organizations-stat__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.organizations-stat__label {
  color: var(--ui-text-toned);
  font-size: 12px;
  font-weight: 650;
}

.organizations-stat__icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
  font-size: 15px;
}

.organizations-stat__icon[data-tone='primary'] {
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
  color: var(--ui-primary);
}

.organizations-stat__icon[data-tone='success'] {
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg-elevated));
  color: var(--ui-success);
}

.organizations-stat__icon[data-tone='warning'] {
  background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg-elevated));
  color: var(--ui-warning);
}

.organizations-stat__icon[data-tone='error'] {
  background: color-mix(in srgb, var(--ui-error) 12%, var(--ui-bg-elevated));
  color: var(--ui-error);
}

.organizations-stat strong {
  display: block;
  margin-top: 14px;
  color: var(--ui-text-highlighted);
  font-size: 30px;
  font-weight: 650;
  letter-spacing: -.035em;
  line-height: 1;
}

.organizations-stat small {
  display: block;
  margin-top: 8px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.organizations-registry,
.invitations-registry {
  overflow: hidden;
}

.organizations-toolbar,
.invitations-heading {
  display: grid;
  gap: 16px;
}

.organizations-toolbar__heading,
.invitations-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.organizations-toolbar__heading > div > span,
.invitations-heading > div > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
}

.organizations-toolbar h2,
.invitations-heading h2 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.organizations-toolbar p,
.invitations-heading p {
  max-width: 660px;
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.organizations-toolbar__count {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.organizations-toolbar__filters {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(160px, 190px) minmax(190px, 220px) 40px;
  gap: 10px;
  align-items: center;
}

.organizations-toolbar__search {
  width: 100%;
}

.organizations-table {
  min-width: 0;
  border-top: 1px solid var(--ui-border);
}

.organizations-loading,
.organizations-state {
  display: grid;
  gap: 12px;
  padding: 24px;
}

.organizations-state > button {
  justify-self: start;
}

.organizations-empty {
  margin: 0;
  border-top: 1px solid var(--ui-border);
  border-radius: 0;
}

.organization-cell,
.organization-members,
.invitation-actions {
  display: flex;
  align-items: center;
}

.organization-cell {
  gap: 11px;
}

.organization-cell__avatar {
  display: grid;
  flex: 0 0 38px;
  height: 38px;
  place-items: center;
  border-radius: 11px;
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 750;
}

.organization-cell > div,
.invitation-recipient,
.organization-status-cell,
.invitation-offer {
  display: grid;
  gap: 4px;
}

.organization-cell strong,
.invitation-recipient strong,
.invitation-organization {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.organization-cell small,
.invitation-recipient small,
.organization-status-cell small,
.invitation-offer small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.invitation-offer {
  justify-items: start;
  max-width: 230px;
}

.invitation-offer > span:not(.invitation-offer__muted) {
  color: var(--ui-text-toned);
  font-size: 12px;
  font-weight: 600;
}

.invitation-offer__muted {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.organization-members {
  gap: 6px;
  color: var(--ui-text-toned);
  font-size: 12px;
}

.organization-date {
  color: var(--ui-text-toned);
  font-size: 12px;
  white-space: nowrap;
}

.invitation-actions {
  justify-content: flex-end;
  gap: 2px;
}

.organization-invite-form,
.invitation-success {
  display: grid;
  gap: 22px;
}

.invitation-discount {
  display: grid;
  gap: 18px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 20%, var(--ui-border));
  border-radius: 16px;
  background: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-bg));
}

.invitation-discount__heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.invitation-discount__icon {
  display: grid;
  flex: 0 0 38px;
  height: 38px;
  place-items: center;
  border-radius: 11px;
  background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 18px;
}

.invitation-discount__heading h3,
.invitation-discount__heading p {
  margin: 0;
}

.invitation-discount__heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
}

.invitation-discount__heading p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.invitation-success__icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: 16px;
  background: color-mix(in srgb, var(--ui-success) 13%, var(--ui-bg-elevated));
  color: var(--ui-success);
  font-size: 24px;
}

.invitation-success h3,
.invitation-success p {
  margin: 0;
}

.invitation-success h3 {
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.invitation-success p {
  margin-top: 7px;
  color: var(--ui-text-toned);
  font-size: 14px;
  line-height: 1.55;
}

.invitation-url {
  display: grid;
  gap: 10px;
}

.invitation-url :deep(input) {
  font-family: var(--font-mono);
  font-size: 11px;
}

@media (max-width: 1080px) {
  .organizations-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .organizations-toolbar__filters {
    grid-template-columns: minmax(240px, 1fr) minmax(150px, 1fr);
  }

  .organizations-toolbar__filters > button {
    justify-self: end;
  }
}

@media (max-width: 640px) {
  .organizations-stats,
  .organizations-toolbar__filters {
    grid-template-columns: 1fr;
  }

  .organizations-toolbar__heading,
  .invitations-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .organizations-toolbar__filters > button {
    justify-self: start;
  }
}
</style>
