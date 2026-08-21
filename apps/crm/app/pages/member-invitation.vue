<script setup lang="ts">
import type {
  OrganizationMemberInvitationAcceptResponse,
  PublicOrganizationMemberInvitationResponse,
} from '#shared/types/organization-member-invitations'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ layout: false })
useHead({
  title: 'Zaproszenie użytkownika — OpenExpert CRM',
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
const endpoint = computed(() => `/api/member-invitations/${encodeURIComponent(token.value)}`)

const {
  data: response,
  status,
  error: previewError,
  refresh,
} = await useAsyncData<PublicOrganizationMemberInvitationResponse | null>(
  `member-invitation:${token.value || 'missing'}`,
  async () => {
    if (!hasValidTokenShape.value) return null
    return requestFetch<PublicOrganizationMemberInvitationResponse>(endpoint.value)
  },
  { default: () => null, watch: [token] },
)

const accepting = ref(false)
const switchingAccount = ref(false)
const actionError = ref('')
const invitation = computed(() => response.value?.invitation ?? null)
const isLoading = computed(() => status.value === 'pending')
const previewFailed = computed(() => Boolean(
  !hasValidTokenShape.value || previewError.value || (!isLoading.value && !invitation.value),
))
const invitedEmail = computed(() => invitation.value?.email.trim().toLowerCase() || '')
const currentEmail = computed(() => authenticatedUser.value?.email.trim().toLowerCase() || '')
const emailMatches = computed(() => Boolean(invitedEmail.value && invitedEmail.value === currentEmail.value))
const canAccept = computed(() => Boolean(
  invitation.value
  && (invitation.value.canAccept || invitation.value.canResume)
  && authenticatedUser.value?.emailVerified
  && emailMatches.value,
))
const invitationReturnPath = computed(() => `/member-invitation?token=${encodeURIComponent(token.value)}`)
const loginTarget = computed(() => ({
  path: '/login',
  query: { email: invitation.value?.email, redirect: invitationReturnPath.value },
}))

function maskEmail(value: string) {
  const [local = '', domain = ''] = value.split('@')
  if (!local || !domain) return value
  return `${local.slice(0, Math.min(2, local.length))}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

async function switchAccount() {
  switchingAccount.value = true
  actionError.value = ''
  try {
    await signOutAuthenticatedUser({ requireServerSuccess: true })
  }
  catch (error: unknown) {
    actionError.value = apiErrorMessage(error)
  }
  finally {
    switchingAccount.value = false
  }
}

async function acceptInvitation() {
  if (!canAccept.value || accepting.value) return
  accepting.value = true
  actionError.value = ''
  try {
    const result = await $fetch<OrganizationMemberInvitationAcceptResponse>(
      `${endpoint.value}/accept`,
      { method: 'POST', body: {} },
    )
    clearNuxtData('openexpert-organizations')
    await navigateTo(`/org/${encodeURIComponent(result.organizationSlug)}/dashboard`)
  }
  catch (error: unknown) {
    actionError.value = apiErrorMessage(error)
    await refresh()
  }
  finally {
    accepting.value = false
  }
}
</script>

<template>
  <AuthShell
    badge="Zaproszenie użytkownika"
    icon="i-lucide-user-round-plus"
    :title="invitation?.organizationName || 'Dołącz do organizacji'"
    description="Potwierdź zaproszony adres email. Miejsce jest już opłacone i przyjęcie zaproszenia nie obciąży karty."
  >
    <div class="member-invitation">
      <template v-if="isLoading">
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-11 w-full" />
      </template>

      <template v-else-if="previewFailed">
        <UAlert
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-link-2-off"
          title="Link jest nieprawidłowy lub nieaktualny"
          description="Poproś administratora organizacji o ponowne wysłanie zaproszenia."
        />
        <UButton to="/login" block color="neutral" variant="outline">
          Przejdź do logowania
        </UButton>
      </template>

      <template v-else-if="invitation">
        <div class="member-invitation__summary">
          <span aria-hidden="true"><UIcon name="i-lucide-building-2" /></span>
          <div>
            <strong>{{ invitation.organizationName }}</strong>
            <small>{{ maskEmail(invitation.email) }}</small>
          </div>
          <UBadge color="primary" variant="subtle">
            {{ invitation.role === 'admin' ? 'Administrator' : 'Użytkownik' }}
          </UBadge>
        </div>

        <UAlert
          v-if="invitation.status === 'expired'"
          color="warning"
          variant="subtle"
          icon="i-lucide-clock-alert"
          title="Zaproszenie wygasło"
          description="Opłacone miejsce zostało zwolnione. Poproś administratora o nowe zaproszenie."
        />
        <UAlert
          v-else-if="invitation.status === 'revoked'"
          color="error"
          variant="subtle"
          icon="i-lucide-ban"
          title="Zaproszenie zostało unieważnione"
          description="Ten link nie daje już dostępu do organizacji."
        />
        <UAlert
          v-else
          color="success"
          variant="subtle"
          icon="i-lucide-circle-check"
          title="Bez dodatkowej płatności"
          :description="`To zaproszenie rezerwuje jedno z opłaconych miejsc do ${formatDate(invitation.expiresAt)}.`"
        />

        <UAlert
          v-if="actionError"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="actionError"
        />

        <template v-if="invitation.canAccept || invitation.canResume">
          <template v-if="!authenticatedUser || !authenticatedUser.emailVerified">
            <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-log-in"
              title="Zaloguj się zaproszonym adresem"
              :description="`Użyj konta ${maskEmail(invitation.email)}. Link z wiadomości email potwierdza ten adres automatycznie.`"
            />
            <UButton :to="loginTarget" block size="lg" icon="i-lucide-log-in">
              Zaloguj się i kontynuuj
            </UButton>
          </template>

          <template v-else-if="!emailMatches">
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-user-round-x"
              title="Zalogowano inne konto"
              :description="`Zaproszenie jest przeznaczone dla ${maskEmail(invitation.email)}.`"
            />
            <UButton
              block
              color="neutral"
              variant="outline"
              icon="i-lucide-log-out"
              :loading="switchingAccount"
              @click="switchAccount"
            >
              Wyloguj i użyj zaproszonego konta
            </UButton>
          </template>

          <UButton
            v-else
            block
            size="lg"
            icon="i-lucide-user-round-check"
            :loading="accepting"
            @click="acceptInvitation"
          >
            Dołącz do organizacji
          </UButton>
        </template>
      </template>
    </div>
  </AuthShell>
</template>

<style scoped>
.member-invitation {
  display: grid;
  gap: 1rem;
}

.member-invitation__summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--ui-bg-elevated) 82%, transparent);
}

.member-invitation__summary > span {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
}

.member-invitation__summary div {
  display: grid;
  min-width: 0;
}

.member-invitation__summary strong,
.member-invitation__summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-invitation__summary small {
  color: var(--ui-text-muted);
}
</style>
