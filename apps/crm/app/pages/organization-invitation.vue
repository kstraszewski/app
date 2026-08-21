<script setup lang="ts">
import type {
  OrganizationBillingCheckoutResponse,
  OrganizationInvitationAcceptResponse,
  OrganizationInvitationMagicLinkResponse,
  OrganizationInvitationStatus,
  PublicOrganizationInvitationResponse,
} from '#shared/types/system-organizations'
import { invitationBillingDiscountLabel } from '#shared/organization-invitation-discount'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ layout: false })

useHead({
  title: 'Zaproszenie do organizacji — OpenExpert CRM',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ],
})

const route = useRoute()
const requestFetch = useRequestFetch()
const authenticatedUser = useAuthUser()
const token = computed(() => {
  const value = Array.isArray(route.query.token) ? route.query.token[0] : route.query.token
  return typeof value === 'string' ? value.trim() : ''
})
const hasValidTokenShape = computed(() => /^[A-Za-z0-9_-]{43}$/u.test(token.value))
const invitationEndpoint = computed(() => (
  `/api/organization-invitations/${encodeURIComponent(token.value)}`
))

const {
  data: invitationResponse,
  status,
  error: previewError,
  refresh,
} = await useAsyncData<PublicOrganizationInvitationResponse | null>(
  `organization-invitation:${token.value || 'missing'}`,
  async () => {
    if (!hasValidTokenShape.value) return null
    return requestFetch<PublicOrganizationInvitationResponse>(invitationEndpoint.value)
  },
  {
    default: () => null,
    watch: [token],
  },
)

const sendingMagicLink = ref(false)
const magicLinkSent = ref(false)
const accepting = ref(false)
const switchingAccount = ref(false)
const startingCheckout = ref(false)
const actionError = ref('')
const checkoutError = ref('')
const acceptedOrganization = ref<OrganizationInvitationAcceptResponse['organization'] | null>(null)

const invitation = computed(() => invitationResponse.value?.invitation ?? null)
const isLoading = computed(() => status.value === 'pending')
const normalizedInvitedEmail = computed(() => invitation.value?.email.trim().toLocaleLowerCase('pl') || '')
const normalizedUserEmail = computed(() => authenticatedUser.value?.email.trim().toLocaleLowerCase('pl') || '')
const emailMatches = computed(() => Boolean(
  normalizedInvitedEmail.value
  && normalizedInvitedEmail.value === normalizedUserEmail.value,
))
const canContinueOnCurrentAccount = computed(() => Boolean(
  authenticatedUser.value
  && authenticatedUser.value.emailVerified
  && emailMatches.value,
))
const canContinueInvitation = computed(() => Boolean(
  invitation.value?.canAccept || invitation.value?.canResume,
))
const invitationUnavailable = computed(() => Boolean(
  invitation.value && !canContinueInvitation.value,
))
const previewFailed = computed(() => Boolean(
  !hasValidTokenShape.value || previewError.value || (!isLoading.value && !invitation.value),
))
const isApplication = computed(() => invitation.value?.organizationKind === 'application')
const isSelfService = computed(() => invitation.value?.onboardingSource === 'self_service')
const initialSeatCount = computed(() => {
  const value = Number(invitation.value?.initialSeatCount)
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : 1
})
const initialMonthlyTotal = computed(() => new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(initialSeatCount.value * 200))
const initialSeatAssignment = computed(() => initialSeatCount.value === 1
  ? 'Administrator zajmuje wybrane miejsce.'
  : `Administrator zajmuje pierwsze miejsce. Pozostałe ${initialSeatCount.value - 1} osoby możesz dodać po aktywacji.`)
const billingDiscount = computed(() => invitation.value?.billingDiscount ?? null)
const billingDiscountLabel = computed(() => billingDiscount.value
  ? invitationBillingDiscountLabel(billingDiscount.value)
  : '')
const invitationReturnPath = computed(() => (
  `/organization-invitation?token=${encodeURIComponent(token.value)}`
))
const resumeLoginTarget = computed(() => ({
  path: '/login',
  query: {
    email: invitation.value?.email || undefined,
    redirect: invitationReturnPath.value,
  },
}))

const pageTitle = computed(() => {
  if (acceptedOrganization.value) {
    return invitation.value?.canResume ? 'Dostęp do organizacji jest gotowy' : 'Organizacja została utworzona'
  }
  return invitation.value?.organizationName || 'Zaproszenie do organizacji'
})

const pageDescription = computed(() => {
  if (acceptedOrganization.value?.kind === 'application') {
    return 'Ostatnim krokiem jest uruchomienie miesięcznej subskrypcji w bezpiecznym formularzu Stripe.'
  }
  if (acceptedOrganization.value) {
    return 'Dostęp administratora jest aktywny. Za chwilę przejdziesz do pulpitu organizacji.'
  }
  if (isApplication.value) {
    if (isSelfService.value) {
      return `Potwierdź konto administratora i uruchom subskrypcję dla ${initialSeatCount.value} miejsc.`
    }
    return 'Przyjmij rolę administratora, a następnie uruchom subskrypcję aplikacji.'
  }
  return 'Potwierdź zaproszony adres email i utwórz przestrzeń swojej organizacji.'
})

function maskEmail(value: string) {
  const [local = '', domain = ''] = value.split('@')
  if (!local || !domain) return value
  const visibleLength = Math.min(2, local.length)
  return `${local.slice(0, visibleLength)}${'•'.repeat(Math.max(3, local.length - visibleLength))}@${domain}`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date)
}

function invitationStatusDetails(invitationStatus: OrganizationInvitationStatus) {
  const details: Record<OrganizationInvitationStatus, {
    title: string
    description: string
    icon: string
    color: 'neutral' | 'success' | 'warning' | 'error'
  }> = {
    pending: {
      title: 'Zaproszenie oczekuje',
      description: 'Możesz jeszcze przyjąć to zaproszenie.',
      icon: 'i-lucide-mail-clock',
      color: 'warning',
    },
    accepted: {
      title: 'Organizacja została już utworzona',
      description: 'Administrator przyjął zaproszenie. Zaloguj się do CRM, aby dokończyć konfigurację płatności.',
      icon: 'i-lucide-circle-check',
      color: 'success',
    },
    completed: {
      title: 'Zaproszenie zostało wykorzystane',
      description: 'Onboarding tej organizacji jest już ukończony.',
      icon: 'i-lucide-circle-check',
      color: 'success',
    },
    expired: {
      title: 'Zaproszenie wygasło',
      description: 'Poproś superadministratora o ponowne wysłanie zaproszenia.',
      icon: 'i-lucide-clock-alert',
      color: 'warning',
    },
    revoked: {
      title: 'Zaproszenie zostało unieważnione',
      description: 'Ten link nie daje już dostępu do organizacji.',
      icon: 'i-lucide-ban',
      color: 'error',
    },
  }
  return details[invitationStatus]
}

async function requestMagicLink() {
  if (!invitation.value?.canAccept || sendingMagicLink.value) return
  actionError.value = ''
  sendingMagicLink.value = true
  try {
    const result = await $fetch<OrganizationInvitationMagicLinkResponse>(
      `${invitationEndpoint.value}/magic-link`,
      { method: 'POST', body: {} },
    )
    if (result.delivery.status === 'failed') {
      actionError.value = 'Nie udało się wysłać wiadomości. Spróbuj ponownie za chwilę.'
      return
    }
    magicLinkSent.value = true
  }
  catch (caught: unknown) {
    actionError.value = apiErrorMessage(caught)
  }
  finally {
    sendingMagicLink.value = false
  }
}

async function switchAccount() {
  switchingAccount.value = true
  actionError.value = ''
  try {
    await signOutAuthenticatedUser({ requireServerSuccess: true })
  }
  catch (caught: unknown) {
    actionError.value = apiErrorMessage(caught)
  }
  finally {
    switchingAccount.value = false
  }
}

async function startCheckout() {
  const organization = acceptedOrganization.value
  if (!organization || organization.kind !== 'application') return

  startingCheckout.value = true
  checkoutError.value = ''
  try {
    const result = await $fetch<OrganizationBillingCheckoutResponse>(
      `/api/org/${encodeURIComponent(organization.slug)}/billing/checkout`,
      { method: 'POST', body: {} },
    )
    if (!result.url) throw new Error('Stripe Checkout URL is unavailable')
    await navigateTo(result.url, { external: true })
  }
  catch (caught: unknown) {
    checkoutError.value = apiErrorMessage(caught)
  }
  finally {
    startingCheckout.value = false
  }
}

async function acceptInvitation() {
  if (!canContinueInvitation.value || !canContinueOnCurrentAccount.value || accepting.value) return

  accepting.value = true
  actionError.value = ''
  try {
    const result = await $fetch<OrganizationInvitationAcceptResponse>(
      `${invitationEndpoint.value}/accept`,
      {
        method: 'POST',
        body: {
          fullName: authenticatedUser.value?.name?.trim() || undefined,
        },
      },
    )
    acceptedOrganization.value = result.organization
    clearNuxtData('openexpert-organizations')

    if (result.organization.kind === 'application') {
      if (
        result.organization.billingAccessState === 'active'
        || result.organization.billingAccessState === 'grace'
      ) {
        await navigateTo(`/org/${encodeURIComponent(result.organization.slug)}/dashboard`)
        return
      }
      if (result.organization.billingAccessState === 'subscription_required') {
        await startCheckout()
        return
      }
      await navigateTo(`/org/${encodeURIComponent(result.organization.slug)}/settings/billing`)
      return
    }
    await navigateTo(`/org/${encodeURIComponent(result.organization.slug)}/dashboard`)
  }
  catch (caught: unknown) {
    actionError.value = apiErrorMessage(caught)
    await refresh()
  }
  finally {
    accepting.value = false
  }
}
</script>

<template>
  <AuthShell
    :badge="isSelfService ? 'Rejestracja organizacji' : 'Zaproszenie do organizacji'"
    icon="i-lucide-building-2"
    :title="pageTitle"
    :description="pageDescription"
  >
    <div class="organization-invitation">
      <template v-if="isLoading">
        <div class="organization-invitation__loading" aria-label="Sprawdzanie zaproszenia">
          <USkeleton class="h-20 w-full" />
          <USkeleton class="h-12 w-full" />
          <USkeleton class="h-10 w-full" />
        </div>
      </template>

      <template v-else-if="previewFailed">
        <UAlert
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-link-2-off"
          title="Link jest nieprawidłowy lub nieaktualny"
          description="Sprawdź, czy używasz pełnego adresu z ostatniej wiadomości. W razie potrzeby poproś superadministratora o nowe zaproszenie."
        />
        <UButton to="/login" block color="neutral" variant="outline" icon="i-lucide-log-in">
          Przejdź do logowania
        </UButton>
      </template>

      <template v-else-if="acceptedOrganization">
        <div class="organization-invitation__success">
          <span aria-hidden="true"><UIcon name="i-lucide-building-2" /></span>
          <div>
            <strong>{{ acceptedOrganization.name }}</strong>
            <small>Rola administratora została przypisana</small>
          </div>
        </div>

        <template v-if="acceptedOrganization.kind === 'application'">
          <div class="organization-invitation__plan">
            <div>
              <span>APLIKACJA</span>
              <strong>{{ initialMonthlyTotal }} <small>/ miesiąc · {{ initialSeatCount }} × 200 zł</small></strong>
            </div>
            <UBadge
              color="primary"
              variant="subtle"
              :icon="billingDiscount ? 'i-lucide-ticket-percent' : 'i-lucide-repeat-2'"
            >
              {{ billingDiscount ? 'Oferta specjalna' : 'Subskrypcja' }}
            </UBadge>
            <ul>
              <li><UIcon name="i-lucide-check" /> Bezpieczna płatność Stripe</li>
              <li><UIcon name="i-lucide-check" /> {{ initialSeatAssignment }}</li>
              <li v-if="billingDiscount">
                <UIcon name="i-lucide-check" /> Rabat automatyczny: {{ billingDiscountLabel }}
              </li>
              <li v-else><UIcon name="i-lucide-check" /> Kod promocyjny możesz wpisać w checkout</li>
              <li><UIcon name="i-lucide-check" /> Rozliczenie co miesiąc</li>
            </ul>
          </div>

          <UAlert
            v-if="checkoutError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Organizacja jest gotowa, ale checkout nie wystartował"
            :description="checkoutError"
          />

          <UButton
            block
            size="lg"
            icon="i-lucide-lock-keyhole"
            trailing-icon="i-lucide-arrow-up-right"
            :loading="startingCheckout"
            @click="startCheckout"
          >
            Przejdź do Stripe Checkout
          </UButton>

          <UButton
            :to="`/org/${encodeURIComponent(acceptedOrganization.slug)}/settings/billing`"
            block
            color="neutral"
            variant="ghost"
          >
            Dokończ później w ustawieniach
          </UButton>
        </template>

        <UButton
          v-else
          :to="`/org/${encodeURIComponent(acceptedOrganization.slug)}`"
          block
          size="lg"
          icon="i-lucide-layout-dashboard"
        >
          Przejdź do pulpitu
        </UButton>
      </template>

      <template v-else-if="invitation">
        <div class="organization-invitation__summary">
          <span class="organization-invitation__summary-icon" aria-hidden="true">
            <UIcon :name="isApplication ? 'i-lucide-panels-top-left' : 'i-lucide-handshake'" />
          </span>
          <div>
            <UBadge :color="isApplication ? 'primary' : 'neutral'" variant="subtle" size="xs">
              {{ isApplication ? 'Aplikacja' : 'Pośrednik' }}
            </UBadge>
            <strong>{{ invitation.organizationName }}</strong>
            <small>{{ isSelfService ? 'Rejestracja' : 'Zaproszenie' }} dla {{ maskEmail(invitation.email) }}</small>
          </div>
        </div>

        <div v-if="isApplication" class="organization-invitation__plan">
          <div>
            <span>PLAN MIESIĘCZNY</span>
            <strong>{{ initialMonthlyTotal }} <small>/ miesiąc · {{ initialSeatCount }} × 200 zł</small></strong>
          </div>
          <UBadge color="primary" variant="subtle" icon="i-lucide-ticket-percent">
            {{ billingDiscount ? 'Oferta przypisana' : 'Kupony w checkout' }}
          </UBadge>
          <p v-if="billingDiscount">
            Do zaproszenia przypisano {{ billingDiscountLabel }}. Rabat zostanie naliczony automatycznie w Stripe Checkout.
          </p>
          <p v-else>
            Subskrypcję uruchomisz po potwierdzeniu organizacji. Kupon promocyjny wpiszesz w Stripe.
          </p>
          <p>{{ initialSeatAssignment }}</p>
        </div>

        <UAlert
          v-if="!invitation.canAccept"
          :color="invitationStatusDetails(invitation.status).color"
          variant="subtle"
          :icon="invitationStatusDetails(invitation.status).icon"
          :title="invitationStatusDetails(invitation.status).title"
          :description="invitationStatusDetails(invitation.status).description"
        />

        <template v-if="invitationUnavailable">
          <UButton
            v-if="authenticatedUser"
            to="/"
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-layout-dashboard"
          >
            Przejdź do CRM
          </UButton>
        </template>

        <template v-else-if="!authenticatedUser || !authenticatedUser.emailVerified">
          <UAlert
            v-if="invitation.canResume"
            color="neutral"
            variant="subtle"
            icon="i-lucide-log-in"
            title="Zaloguj się, aby wrócić do organizacji"
            :description="`Użyj konta ${maskEmail(invitation.email)}. Po zalogowaniu wrócisz tutaj i odzyskamy właściwą organizację.`"
          />
          <UAlert
            v-else-if="magicLinkSent"
            color="success"
            variant="subtle"
            icon="i-lucide-mail-check"
            title="Sprawdź skrzynkę email"
            :description="`Wysłaliśmy bezpieczny link logowania na ${maskEmail(invitation.email)}. Po kliknięciu wrócisz tutaj, aby przyjąć zaproszenie.`"
          />
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-shield-check"
            :title="authenticatedUser ? 'Potwierdź adres email' : 'Najpierw potwierdź swoją tożsamość'"
            :description="`Wyślemy link logowania wyłącznie na zaproszony adres ${maskEmail(invitation.email)}.`"
          />

          <UAlert
            v-if="actionError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="actionError"
          />

          <UButton
            v-if="invitation.canResume && !authenticatedUser"
            :to="resumeLoginTarget"
            block
            size="lg"
            icon="i-lucide-log-in"
          >
            Zaloguj się i kontynuuj
          </UButton>
          <UButton
            v-else-if="invitation.canResume"
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-log-out"
            :loading="switchingAccount"
            @click="switchAccount"
          >
            Wyloguj i użyj zaproszonego konta
          </UButton>
          <UButton
            v-else
            block
            size="lg"
            icon="i-lucide-send"
            :variant="magicLinkSent ? 'outline' : 'solid'"
            :loading="sendingMagicLink"
            @click="requestMagicLink"
          >
            {{ magicLinkSent ? 'Wyślij link ponownie' : 'Wyślij link logowania' }}
          </UButton>
        </template>

        <template v-else-if="!emailMatches">
          <UAlert
            role="alert"
            color="warning"
            variant="subtle"
            icon="i-lucide-user-round-x"
            title="To zaproszenie jest przypisane do innego konta"
            :description="`Jesteś zalogowany jako ${authenticatedUser.email}. Użyj konta powiązanego z adresem ${maskEmail(invitation.email)}.`"
          />

          <UAlert
            v-if="actionError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="actionError"
          />

          <UButton
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-log-out"
            :loading="switchingAccount"
            @click="switchAccount"
          >
            Wyloguj bieżące konto
          </UButton>
        </template>

        <template v-else>
          <div class="organization-invitation__identity">
            <span aria-hidden="true"><UIcon name="i-lucide-badge-check" /></span>
            <div>
              <strong>{{ authenticatedUser.name || authenticatedUser.email }}</strong>
              <small>{{ authenticatedUser.email }} · adres potwierdzony</small>
            </div>
          </div>

          <UAlert
            v-if="actionError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="actionError"
          />

          <UButton
            block
            size="lg"
            :icon="invitation.canResume
              ? 'i-lucide-rotate-ccw'
              : isApplication ? 'i-lucide-credit-card' : 'i-lucide-building-2'"
            :trailing-icon="isApplication ? 'i-lucide-arrow-right' : undefined"
            :loading="accepting || startingCheckout"
            @click="acceptInvitation"
          >
            {{ invitation.canResume
              ? 'Wznów konfigurację organizacji'
              : isApplication ? 'Przyjmij i przejdź do płatności' : 'Przyjmij zaproszenie' }}
          </UButton>

          <p class="organization-invitation__terms">
            {{ invitation.canResume
              ? 'Potwierdzimy organizację przypisaną do tego konta:'
              : 'Przyjmując zaproszenie, zostaniesz administratorem organizacji' }}
            <strong>{{ invitation.organizationName }}</strong>.
          </p>
        </template>

        <div class="organization-invitation__expiry">
          <UIcon :name="invitation.canResume ? 'i-lucide-rotate-ccw' : 'i-lucide-clock-3'" />
          <span v-if="invitation.canResume">Ten link pozwala bezpiecznie wrócić do przypisanej organizacji.</span>
          <span v-else>Zaproszenie ważne do {{ formatDate(invitation.expiresAt) }}</span>
        </div>
      </template>
    </div>

    <template #footer>
      Link jest przypisany do wskazanego adresu email i nie powinien być udostępniany dalej.
    </template>
  </AuthShell>
</template>

<style scoped>
.organization-invitation,
.organization-invitation__loading {
  display: grid;
  gap: 16px;
}

.organization-invitation__summary,
.organization-invitation__identity,
.organization-invitation__success {
  display: flex;
  align-items: center;
  gap: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  padding: 14px;
  background: var(--ui-bg-elevated);
}

.organization-invitation__summary-icon,
.organization-invitation__identity > span,
.organization-invitation__success > span {
  display: grid;
  flex: 0 0 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 20px;
}

.organization-invitation__identity > span,
.organization-invitation__success > span {
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg));
  color: var(--ui-success);
}

.organization-invitation__summary > div,
.organization-invitation__identity > div,
.organization-invitation__success > div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.organization-invitation__summary strong,
.organization-invitation__identity strong,
.organization-invitation__success strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-invitation__summary small,
.organization-invitation__identity small,
.organization-invitation__success small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-invitation__plan {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 25%, var(--ui-border));
  border-radius: 14px;
  padding: 16px;
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ui-bg));
}

.organization-invitation__plan > div {
  display: grid;
  gap: 5px;
}

.organization-invitation__plan > div > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
}

.organization-invitation__plan strong {
  color: var(--ui-text-highlighted);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -.03em;
}

.organization-invitation__plan strong small {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: normal;
}

.organization-invitation__plan p,
.organization-invitation__plan ul {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.5;
}

.organization-invitation__plan ul {
  display: grid;
  gap: 7px;
  padding: 0;
  list-style: none;
}

.organization-invitation__plan li {
  display: flex;
  align-items: center;
  gap: 7px;
}

.organization-invitation__plan li :deep(svg) {
  color: var(--ui-success);
}

.organization-invitation__expiry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.organization-invitation__terms {
  margin: -3px 4px 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}
</style>
