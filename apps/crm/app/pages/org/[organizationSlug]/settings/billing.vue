<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type {
  OrganizationBillingHistory,
  OrganizationBillingInvoice,
  OrganizationMemberBillingSummary,
} from '#shared/types/organization-seat-billing'
import type { BillingAccessState, OrganizationKind } from '~~/shared/organization-billing'
import { isBillingAccessGranted } from '~~/shared/organization-billing'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Subskrypcja — OpenExpert CRM' })

type BillingPayload = {
  organization: {
    id: string
    name: string
    slug: string
    kind: OrganizationKind
    billingAccessState: BillingAccessState
  }
  plan: {
    code: string
    name: string
    currency: string
    unitAmount: number
    interval: string
    displayAmount: string
    displayInterval: string
  }
  demoMode: boolean
  configured: boolean
  webhookConfigured: boolean
  portalConfigured: boolean
  canManage: boolean
  account: null | {
    subscriptionStatus: string | null
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    graceUntil: string | null
    hasCustomer: boolean
    hasSubscription: boolean
    lastSyncedAt: string | null
  }
}

type BillingReconcileResponse = {
  synchronized: boolean
  billingAccessState: BillingAccessState
  reason?: string
  replayed?: boolean
}

type BillingMembersPayload = {
  billing: OrganizationMemberBillingSummary
}

const route = useRoute()
const { orgApiPath, orgPath } = useOrganizationContext()
const tabs = useOrganizationSettingsTabs()
const toast = useToast()
const checkoutLoading = ref(false)
const portalLoading = ref(false)
const synchronizeLoading = ref(false)
const reconciliationError = ref('')

const emptyMemberBilling = (): OrganizationMemberBillingSummary => ({
  perSeat: false,
  canManageSeats: false,
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

const emptyMembersPayload = (): BillingMembersPayload => ({
  billing: emptyMemberBilling(),
})

const emptyBillingHistory = (): OrganizationBillingHistory => ({
  invoices: [],
  upcoming: null,
  paymentMethod: null,
})

const emptyBillingPayload = (): BillingPayload => ({
  organization: {
    id: '',
    name: '',
    slug: '',
    kind: 'application',
    billingAccessState: 'subscription_required',
  },
  plan: {
    code: 'application_monthly',
    name: 'Aplikacja',
    currency: 'pln',
    unitAmount: 20_000,
    interval: 'month',
    displayAmount: '200 zł',
    displayInterval: 'miesiąc',
  },
  demoMode: true,
  configured: false,
  webhookConfigured: false,
  portalConfigured: false,
  canManage: false,
  account: null,
})

const { data: payload, status, error, refresh } = await useFetch<BillingPayload>(
  () => orgApiPath('/billing'),
  {
    key: computed(() => `organization-billing:${orgApiPath()}`),
    default: emptyBillingPayload,
  },
)

const {
  data: membersPayload,
  status: membersStatus,
  error: membersError,
  refresh: refreshMembers,
} = useFetch<BillingMembersPayload>(
  () => orgApiPath('/members'),
  {
    key: computed(() => `organization-member-billing:${orgApiPath()}`),
    default: emptyMembersPayload,
    immediate: false,
  },
)

const {
  data: billingHistory,
  status: historyStatus,
  error: historyError,
  refresh: refreshHistory,
} = useFetch<OrganizationBillingHistory>(
  () => orgApiPath('/billing/history'),
  {
    key: computed(() => `organization-billing-history:${orgApiPath()}`),
    default: emptyBillingHistory,
    immediate: false,
  },
)

const accessGranted = computed(() => isBillingAccessGranted(payload.value.organization.billingAccessState))
const seatBilling = computed(() => membersPayload.value.billing)
const isApplication = computed(() => payload.value.organization.kind === 'application')
const canLoadSeatUsage = computed(() => isApplication.value && accessGranted.value && payload.value.canManage)
const canLoadHistory = computed(() => (
  isApplication.value
  && payload.value.canManage
  && Boolean(payload.value.account?.hasCustomer)
))
const statusPresentation = computed(() => {
  switch (payload.value.organization.billingAccessState) {
    case 'active':
      return { label: 'Aktywna', color: 'success' as const, icon: 'i-lucide-circle-check' }
    case 'grace':
      return { label: 'Okres naprawczy', color: 'warning' as const, icon: 'i-lucide-clock-3' }
    case 'blocked':
      return { label: 'Zablokowana', color: 'error' as const, icon: 'i-lucide-circle-x' }
    case 'not_required':
      return { label: 'Niewymagana', color: 'neutral' as const, icon: 'i-lucide-minus-circle' }
    default:
      return { label: 'Wymaga płatności', color: 'warning' as const, icon: 'i-lucide-credit-card' }
  }
})
const periodEndLabel = computed(() => payload.value.account?.currentPeriodEnd
  ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long' })
      .format(new Date(payload.value.account.currentPeriodEnd))
  : null)
const redirectedForBilling = computed(() => (
  !accessGranted.value
  && (typeof route.query.required === 'string' || route.query.setup === 'required')
))
const checkoutCancelled = computed(() => route.query.checkout === 'cancelled')
const checkoutSessionId = computed(() => (
  typeof route.query.session_id === 'string' ? route.query.session_id : undefined
))
const reconciliationRequired = computed(() => Boolean(
  (route.query.checkout === 'success' && checkoutSessionId.value)
  || route.query.portal === 'return',
))

const invoiceColumns: TableColumn<OrganizationBillingInvoice>[] = [
  { accessorKey: 'number', header: 'Faktura' },
  { id: 'period', header: 'Okres' },
  { id: 'amount', header: 'Kwota' },
  { id: 'status', header: 'Status' },
  { id: 'actions', header: '' },
]

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100)
}

function formatDate(value: string | null | undefined, dateStyle: 'medium' | 'long' = 'medium') {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle }).format(new Date(value))
}

function formatInvoicePeriod(invoice: OrganizationBillingInvoice) {
  if (!invoice.periodStart && !invoice.periodEnd) return '—'
  return `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`
}

function invoiceStatusPresentation(invoiceStatus: string) {
  switch (invoiceStatus) {
    case 'paid':
      return { label: 'Zapłacona', color: 'success' as const }
    case 'open':
      return { label: 'Do zapłaty', color: 'warning' as const }
    case 'uncollectible':
      return { label: 'Nieopłacona', color: 'error' as const }
    case 'void':
      return { label: 'Anulowana', color: 'neutral' as const }
    case 'draft':
      return { label: 'Szkic', color: 'neutral' as const }
    default:
      return { label: invoiceStatus, color: 'neutral' as const }
  }
}

function paymentMethodBrand(brand: string) {
  const names: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
  }
  return names[brand.toLocaleLowerCase('en')] ?? brand
}

async function refreshSupplementalBillingData() {
  const requests: Promise<unknown>[] = []
  if (canLoadSeatUsage.value) requests.push(refreshMembers())
  if (canLoadHistory.value) requests.push(refreshHistory())
  await Promise.all(requests)
}

await refreshSupplementalBillingData()

async function startCheckout() {
  checkoutLoading.value = true
  try {
    const result = await $fetch<{ url: string }>(orgApiPath('/billing/checkout'), {
      method: 'POST',
      body: {},
    })
    await navigateTo(result.url, { external: true })
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się otworzyć płatności',
      description: apiErrorMessage(caught),
      color: 'error',
    })
  }
  finally {
    checkoutLoading.value = false
  }
}

async function openPortal() {
  portalLoading.value = true
  try {
    const result = await $fetch<{ url: string }>(orgApiPath('/billing/portal'), {
      method: 'POST',
      body: {},
    })
    await navigateTo(result.url, { external: true })
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się otworzyć panelu Stripe',
      description: apiErrorMessage(caught),
      color: 'error',
    })
  }
  finally {
    portalLoading.value = false
  }
}

async function synchronize(sessionId?: string): Promise<boolean> {
  synchronizeLoading.value = true
  reconciliationError.value = ''
  try {
    const result = await $fetch<BillingReconcileResponse>(orgApiPath('/billing/reconcile'), {
      method: 'POST',
      body: { sessionId: sessionId || undefined },
    })
    await Promise.all([
      refresh(),
      refreshNuxtData('openexpert-organizations'),
    ])
    await refreshSupplementalBillingData()

    if (!result.synchronized) {
      reconciliationError.value = 'Stripe nie udostępnił jeszcze danych subskrypcji. Zachowaliśmy identyfikator sesji — spróbuj ponownie za chwilę.'
      toast.add({
        title: 'Płatność czeka na potwierdzenie',
        description: reconciliationError.value,
        color: 'warning',
      })
      return false
    }

    toast.add({
      title: accessGranted.value ? 'Subskrypcja jest aktywna' : 'Stan płatności został odświeżony',
      color: accessGranted.value ? 'success' : 'neutral',
    })
    return true
  }
  catch (caught) {
    reconciliationError.value = apiErrorMessage(caught)
    toast.add({
      title: 'Nie udało się zsynchronizować płatności',
      description: reconciliationError.value,
      color: 'error',
    })
    return false
  }
  finally {
    synchronizeLoading.value = false
  }
}

async function retryReconciliation() {
  const synchronized = await synchronize(checkoutSessionId.value)
  if (synchronized) {
    await navigateTo(route.path, { replace: true })
  }
}

async function refreshBillingState() {
  if (reconciliationRequired.value) {
    await retryReconciliation()
    return
  }
  await synchronize()
}

onMounted(async () => {
  if (reconciliationRequired.value) await retryReconciliation()
})
</script>

<template>
  <CrmShell
    class="billing-page"
    title="Subskrypcja"
    eyebrow="Ustawienia organizacji"
    description="Zarządzaj subskrypcją 200 zł miesięcznie za każde opłacone miejsce, metodą płatności i fakturami."
    :tabs="tabs"
  >
    <UAlert
      v-if="redirectedForBilling"
      color="warning"
      variant="subtle"
      icon="i-lucide-lock-keyhole"
      title="Subskrypcja jest wymagana"
      description="Pozostałe moduły tej organizacji są chronione do czasu uruchomienia albo przywrócenia subskrypcji."
    />

    <UAlert
      v-if="checkoutCancelled"
      color="neutral"
      variant="subtle"
      icon="i-lucide-circle-x"
      title="Płatność nie została zakończona"
      description="Organizacja nadal istnieje. Możesz wrócić do Stripe Checkout, gdy będziesz gotowy."
    />

    <UAlert
      v-if="reconciliationRequired"
      :color="reconciliationError ? 'error' : 'warning'"
      variant="subtle"
      :icon="reconciliationError ? 'i-lucide-circle-alert' : 'i-lucide-refresh-cw'"
      :title="reconciliationError ? 'Płatność nie została jeszcze potwierdzona' : 'Potwierdzamy płatność w Stripe'"
      :description="reconciliationError
        || 'Nie zamykaj tej strony. Zachowamy dane sesji Checkout do chwili poprawnego odświeżenia subskrypcji.'"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="synchronizeLoading"
          @click="retryReconciliation"
        >
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać stanu subskrypcji"
      :description="apiErrorMessage(error)"
    >
      <template #actions>
        <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" @click="refresh()">
          Ponów
        </UButton>
      </template>
    </UAlert>

    <div v-else-if="status === 'pending'" class="billing-grid">
      <USkeleton class="h-80 w-full" />
      <USkeleton class="h-80 w-full" />
    </div>

    <template v-else>
      <UAlert
        v-if="payload.organization.kind !== 'application'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="Ta organizacja nie wymaga subskrypcji"
        description="Organizacje typu Pośrednik zachowują dostęp bez cyklicznej opłaty."
      />

      <UAlert
        v-else-if="payload.demoMode"
        color="info"
        variant="subtle"
        icon="i-lucide-flask-conical"
        title="Stripe Sandbox — bez prawdziwego obciążenia"
      >
        <template #description>
          Użyj karty <code>4242 4242 4242 4242</code>, dowolnej przyszłej daty oraz dowolnego
          3-cyfrowego CVC. W Checkout możesz też wpisać aktywny testowy kod promocyjny.
        </template>
      </UAlert>

      <UAlert
        v-if="payload.organization.kind === 'application' && payload.demoMode && !payload.webhookConfigured"
        color="warning"
        variant="subtle"
        icon="i-lucide-webhook-off"
        title="Sandbox bez automatycznej synchronizacji"
        description="Po Checkout wróć na tę stronę i poczekaj na potwierdzenie. Zmiany płatności nie będą aktualizowane automatycznie, dopóki webhook Stripe nie zostanie skonfigurowany."
      />

      <div v-if="payload.organization.kind === 'application'" class="billing-grid">
        <UCard class="billing-plan">
          <div class="billing-plan__heading">
            <span class="billing-plan__icon"><UIcon name="i-lucide-panels-top-left" /></span>
            <div>
              <small>Plan organizacji</small>
              <h2>{{ payload.plan.name }}</h2>
            </div>
            <UBadge :color="statusPresentation.color" variant="subtle" :icon="statusPresentation.icon">
              {{ statusPresentation.label }}
            </UBadge>
          </div>

          <div class="billing-plan__price">
            <strong>{{ payload.plan.displayAmount }}</strong>
            <span>/ opłacone miejsce / {{ payload.plan.displayInterval }}</span>
          </div>

          <ul>
            <li><UIcon name="i-lucide-check" /> Każdy aktywny użytkownik to jedno płatne miejsce</li>
            <li><UIcon name="i-lucide-check" /> Dodanie osoby rozlicza dopłatę za bieżący okres</li>
            <li><UIcon name="i-lucide-check" /> Płatność i faktury obsługiwane przez Stripe</li>
            <li><UIcon name="i-lucide-check" /> Opcjonalne kupony i kody promocyjne</li>
          </ul>

          <UAlert
            v-if="!payload.configured"
            color="warning"
            variant="subtle"
            :title="payload.demoMode
              ? 'Stripe Sandbox nie jest jeszcze skonfigurowany'
              : 'Płatności Stripe nie są jeszcze skonfigurowane'"
            :description="payload.demoMode
              ? 'Dodaj testowy klucz Stripe do konfiguracji serwera, aby uruchomić Checkout.'
              : 'Uzupełnij konfigurację Stripe, aby administrator mógł uruchomić subskrypcję.'"
          />

          <UAlert
            v-else-if="payload.account?.hasCustomer && !payload.portalConfigured"
            color="warning"
            variant="subtle"
            icon="i-lucide-settings"
            title="Bezpieczny portal Stripe nie jest skonfigurowany"
            description="Historia pozostaje dostępna tutaj, ale zmiana karty w Stripe wymaga konfiguracji portalu bez edycji liczby miejsc."
          />

          <div v-if="payload.canManage" class="billing-plan__actions">
            <UButton
              v-if="!accessGranted && !reconciliationRequired"
              size="lg"
              icon="i-lucide-credit-card"
              :loading="checkoutLoading"
              :disabled="!payload.configured"
              @click="startCheckout"
            >
              {{ payload.demoMode ? 'Przejdź do płatności testowej' : 'Przejdź do płatności' }}
            </UButton>
            <UButton
              v-if="payload.account?.hasCustomer"
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              :loading="portalLoading"
              :disabled="!payload.configured || !payload.portalConfigured"
              @click="openPortal"
            >
              Zarządzaj w Stripe
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="synchronizeLoading"
              @click="refreshBillingState"
            >
              Odśwież stan
            </UButton>
          </div>
          <p v-else class="billing-plan__notice">
            Tylko administrator organizacji może rozpocząć lub zmienić subskrypcję.
          </p>
        </UCard>

        <UCard class="billing-state">
          <span class="billing-state__eyebrow">Dostęp</span>
          <div class="billing-state__visual" :class="{ 'billing-state__visual--active': accessGranted }">
            <UIcon :name="accessGranted ? 'i-lucide-shield-check' : 'i-lucide-lock-keyhole'" />
          </div>
          <h2>{{ accessGranted ? 'Aplikacja jest odblokowana' : 'Dokończ płatność' }}</h2>
          <p v-if="accessGranted">
            CRM i pozostałe moduły są dostępne dla członków organizacji.
            <template v-if="periodEndLabel"> Bieżący okres kończy się {{ periodEndLabel }}.</template>
          </p>
          <p v-else>
            Organizacja już istnieje, ale jej moduły pozostaną chronione do chwili potwierdzenia subskrypcji.
          </p>
          <UButton
            v-if="accessGranted"
            :to="orgPath('/dashboard')"
            size="lg"
            trailing-icon="i-lucide-arrow-right"
          >
            Przejdź do aplikacji
          </UButton>
        </UCard>
      </div>

      <template v-if="payload.organization.kind === 'application' && accessGranted && payload.canManage">
        <UAlert
          v-if="membersError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać użycia subskrypcji"
          :description="apiErrorMessage(membersError)"
        >
          <template #actions>
            <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" @click="refreshMembers()">
              Ponów
            </UButton>
          </template>
        </UAlert>

        <div v-else-if="membersStatus === 'pending'" class="billing-usage-grid">
          <USkeleton v-for="item in 4" :key="item" class="h-32 w-full" />
        </div>

        <template v-else-if="seatBilling.perSeat">
          <UAlert
            v-if="seatBilling.pendingChanges.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-credit-card"
            title="Zmiana liczby miejsc czeka na płatność"
            :description="`${seatBilling.pendingChanges.length} ${seatBilling.pendingChanges.length === 1 ? 'zmiana wymaga' : 'zmiany wymagają'} dokończenia przed aktywowaniem dostępu użytkownika.`"
          >
            <template #actions>
              <UButton
                :to="orgPath('/users')"
                color="neutral"
                variant="outline"
                trailing-icon="i-lucide-arrow-right"
              >
                Przejdź do użytkowników
              </UButton>
            </template>
          </UAlert>

          <UAlert
            v-if="seatBilling.reservedSeats"
            color="info"
            variant="subtle"
            icon="i-lucide-mail-clock"
            title="Opłacone miejsca czekają na przyjęcie zaproszeń"
            :description="`${seatBilling.reservedSeats} ${seatBilling.reservedSeats === 1 ? 'miejsce jest zarezerwowane' : 'miejsca są zarezerwowane'} bez dodatkowej płatności.`"
          >
            <template #actions>
              <UButton :to="orgPath('/users')" color="neutral" variant="outline">
                Zarządzaj zaproszeniami
              </UButton>
            </template>
          </UAlert>

          <div class="billing-usage-grid">
            <UCard class="billing-metric">
              <span class="billing-metric__icon"><UIcon name="i-lucide-users" /></span>
              <small>Aktywni użytkownicy</small>
              <strong>{{ seatBilling.activeMembers }}</strong>
              <p>Tylu użytkowników ma obecnie dostęp do organizacji.</p>
            </UCard>

            <UCard class="billing-metric">
              <span class="billing-metric__icon"><UIcon name="i-lucide-badge-check" /></span>
              <small>Opłacone miejsca</small>
              <strong>{{ seatBilling.licensedSeats }}</strong>
              <p>Liczba miejsc zapisana w bieżącej subskrypcji Stripe.</p>
            </UCard>

            <UCard class="billing-metric">
              <span class="billing-metric__icon"><UIcon name="i-lucide-calculator" /></span>
              <small>Miesięczny koszt katalogowy</small>
              <strong>{{ formatMoney(seatBilling.monthlyListAmount, seatBilling.currency) }}</strong>
              <p>
                {{ seatBilling.licensedSeats }} ×
                {{ formatMoney(seatBilling.unitAmount, seatBilling.currency) }} za opłacone miejsce.
              </p>
            </UCard>

            <UCard class="billing-metric">
              <span class="billing-metric__icon"><UIcon name="i-lucide-calendar-clock" /></span>
              <small>Następne odnowienie</small>
              <strong class="billing-metric__date">{{ formatDate(seatBilling.renewalAt, 'long') }}</strong>
              <p>Faktyczna kwota faktury może uwzględniać kupon, podatek i dopłaty.</p>
            </UCard>
          </div>
        </template>
      </template>

      <template v-if="payload.organization.kind === 'application' && payload.canManage && payload.account?.hasCustomer">
        <UAlert
          v-if="historyError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać płatności i faktur"
          :description="apiErrorMessage(historyError)"
        >
          <template #actions>
            <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" @click="refreshHistory()">
              Ponów
            </UButton>
          </template>
        </UAlert>

        <template v-else-if="historyStatus === 'pending'">
          <div class="billing-details-grid">
            <USkeleton class="h-44 w-full" />
            <USkeleton class="h-44 w-full" />
          </div>
          <USkeleton class="h-72 w-full" />
        </template>

        <template v-else>
          <div class="billing-details-grid">
            <UCard class="billing-detail-card">
              <div class="billing-detail-card__heading">
                <span><UIcon name="i-lucide-credit-card" /></span>
                <div>
                  <small>Metoda płatności</small>
                  <h3>Zapisana karta</h3>
                </div>
              </div>

              <div v-if="billingHistory.paymentMethod" class="billing-payment-method">
                <strong>
                  {{ paymentMethodBrand(billingHistory.paymentMethod.brand) }}
                  •••• {{ billingHistory.paymentMethod.last4 }}
                </strong>
                <span>
                  Ważna do {{ String(billingHistory.paymentMethod.expMonth).padStart(2, '0') }}/{{ billingHistory.paymentMethod.expYear }}
                </span>
              </div>
              <p v-else>Brak zapisanej domyślnej metody płatności.</p>

              <UButton
                v-if="payload.canManage"
                color="neutral"
                variant="outline"
                icon="i-lucide-external-link"
                :loading="portalLoading"
                :disabled="!payload.configured || !payload.portalConfigured"
                @click="openPortal"
              >
                Zmień metodę w Stripe
              </UButton>
            </UCard>

            <UCard class="billing-detail-card">
              <div class="billing-detail-card__heading">
                <span><UIcon name="i-lucide-receipt-text" /></span>
                <div>
                  <small>Następna faktura</small>
                  <h3>Prognozowana płatność</h3>
                </div>
              </div>

              <div v-if="billingHistory.upcoming" class="billing-upcoming">
                <strong>{{ formatMoney(billingHistory.upcoming.amountDue, billingHistory.upcoming.currency) }}</strong>
                <span>Planowana na {{ formatDate(billingHistory.upcoming.dueAt, 'long') }}</span>
              </div>
              <p v-else>Stripe nie udostępnia jeszcze prognozy następnej faktury.</p>
            </UCard>
          </div>

          <UCard class="billing-history">
            <template #header>
              <div class="billing-history__heading">
                <div>
                  <small>Rozliczenia</small>
                  <h2>Historia płatności i faktur</h2>
                  <p>Kwoty po rabatach, podatkach i zmianach liczby użytkowników.</p>
                </div>
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  @click="refreshHistory()"
                >
                  Odśwież
                </UButton>
              </div>
            </template>

            <UTable
              v-if="billingHistory.invoices.length"
              :data="billingHistory.invoices"
              :columns="invoiceColumns"
              :ui="{
                root: 'overflow-x-auto',
                base: 'min-w-[780px]',
                th: 'px-4 py-3 text-xs font-semibold text-muted',
                td: 'px-4 py-3 align-middle',
              }"
            >
              <template #number-cell="{ row }">
                <div class="invoice-identity">
                  <strong>{{ row.original.number || row.original.id }}</strong>
                  <span>{{ formatDate(row.original.createdAt) }}</span>
                </div>
              </template>

              <template #period-cell="{ row }">
                <span class="invoice-period">{{ formatInvoicePeriod(row.original) }}</span>
              </template>

              <template #amount-cell="{ row }">
                <div class="invoice-amount">
                  <strong>{{ formatMoney(row.original.amountDue, row.original.currency) }}</strong>
                  <span v-if="row.original.amountPaid !== row.original.amountDue">
                    Zapłacono {{ formatMoney(row.original.amountPaid, row.original.currency) }}
                  </span>
                </div>
              </template>

              <template #status-cell="{ row }">
                <UBadge :color="invoiceStatusPresentation(row.original.status).color" variant="subtle">
                  {{ invoiceStatusPresentation(row.original.status).label }}
                </UBadge>
              </template>

              <template #actions-cell="{ row }">
                <div class="invoice-actions">
                  <UButton
                    v-if="row.original.hostedInvoiceUrl"
                    :to="row.original.hostedInvoiceUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-external-link"
                    aria-label="Otwórz fakturę w Stripe"
                    title="Otwórz fakturę w Stripe"
                  />
                  <UButton
                    v-if="row.original.invoicePdf"
                    :to="row.original.invoicePdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-download"
                  >
                    Pobierz PDF
                  </UButton>
                </div>
              </template>
            </UTable>

            <OeEmptyState
              v-else
              kind="empty"
              icon="i-lucide-receipt-text"
              title="Brak faktur"
              description="Pierwsza faktura pojawi się tutaj po utworzeniu jej przez Stripe."
            />
          </UCard>
        </template>
      </template>
    </template>
  </CrmShell>
</template>

<style scoped>
.billing-page :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
  font-family: var(--font-mono);
  font-size: .9em;
}

.billing-page :deep(.crm-page__content) {
  display: grid;
  gap: 18px;
}

.billing-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr);
  gap: 18px;
}

.billing-plan,
.billing-state {
  min-height: 420px;
}

.billing-plan__heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.billing-plan__icon {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 14px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
  font-size: 21px;
}

.billing-plan small,
.billing-state__eyebrow {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.billing-plan h2,
.billing-state h2 {
  margin: 3px 0 0;
  font-size: 22px;
}

.billing-plan__price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 34px 0 24px;
}

.billing-plan__price strong {
  font-size: clamp(36px, 5vw, 54px);
  font-weight: 650;
  letter-spacing: -.05em;
}

.billing-plan__price span,
.billing-plan__notice,
.billing-state p {
  color: var(--ui-text-muted);
}

.billing-plan ul {
  display: grid;
  gap: 12px;
  margin: 0 0 28px;
  padding: 0;
  list-style: none;
}

.billing-plan li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
}

.billing-plan li :deep(svg) {
  color: var(--ui-success);
}

.billing-plan__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.billing-state {
  display: grid;
  align-content: center;
  justify-items: center;
  text-align: center;
}

.billing-state__visual {
  display: grid;
  width: 88px;
  height: 88px;
  margin: 24px 0 18px;
  place-items: center;
  border-radius: 28px;
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 14%, var(--ui-bg));
  font-size: 38px;
}

.billing-state__visual--active {
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 14%, var(--ui-bg));
}

.billing-state p {
  max-width: 330px;
  margin: 10px 0 24px;
  line-height: 1.6;
}

.billing-usage-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.billing-metric {
  position: relative;
  min-height: 178px;
}

.billing-metric :deep(.card-body) {
  height: 100%;
}

.billing-metric__icon {
  display: grid;
  width: 34px;
  height: 34px;
  margin-bottom: 18px;
  place-items: center;
  border-radius: 10px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.billing-metric small,
.billing-detail-card small,
.billing-history__heading small {
  display: block;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.billing-metric strong {
  display: block;
  margin-top: 5px;
  color: var(--ui-text-highlighted);
  font-size: 28px;
  line-height: 1.15;
}

.billing-metric strong.billing-metric__date {
  font-size: 17px;
  line-height: 1.35;
}

.billing-metric p {
  margin: 8px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.billing-details-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.billing-detail-card {
  min-height: 208px;
}

.billing-detail-card :deep(.card-body) {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: flex-start;
}

.billing-detail-card__heading {
  display: flex;
  align-items: center;
  gap: 11px;
}

.billing-detail-card__heading > span {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.billing-detail-card h3,
.billing-history h2 {
  margin: 3px 0 0;
  color: var(--ui-text-highlighted);
}

.billing-detail-card h3 {
  font-size: 17px;
}

.billing-payment-method,
.billing-upcoming {
  display: grid;
  gap: 4px;
  margin: 22px 0 20px;
}

.billing-payment-method strong,
.billing-upcoming strong {
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.billing-payment-method span,
.billing-upcoming span,
.billing-detail-card > p {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.billing-detail-card > p {
  margin: 24px 0;
}

.billing-detail-card > :deep(.button) {
  margin-top: auto;
}

.billing-history {
  overflow: hidden;
}

.billing-history__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.billing-history h2 {
  font-size: 19px;
}

.billing-history__heading p {
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.billing-history :deep(.table-root) {
  margin: 0 -24px -24px;
  border-top: 1px solid var(--ui-border);
}

.invoice-identity,
.invoice-amount {
  display: grid;
  gap: 3px;
}

.invoice-identity strong,
.invoice-amount strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.invoice-identity span,
.invoice-amount span,
.invoice-period {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.invoice-period {
  white-space: nowrap;
}

.invoice-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  min-width: 150px;
}

@media (max-width: 900px) {
  .billing-grid {
    grid-template-columns: 1fr;
  }

  .billing-usage-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .billing-plan__heading {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .billing-plan__heading :deep(.badge) {
    grid-column: 2;
    justify-self: start;
  }

  .billing-usage-grid,
  .billing-details-grid {
    grid-template-columns: 1fr;
  }

  .billing-history__heading {
    display: grid;
  }
}
</style>
