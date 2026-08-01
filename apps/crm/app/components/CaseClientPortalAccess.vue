<script setup lang="ts">
import type {
  ClientPortalAccessResponse,
  ClientPortalInvitationDeliveryStatus,
} from '~/types/client-portal-access'

const props = defineProps<{
  caseId: string
}>()

const emit = defineEmits<{
  changed: []
}>()

const caseId = toRef(props, 'caseId')
const { crmApiPath, orgPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const toast = useToast()
const saving = ref<'portal' | 'multiform' | 'resend' | 'revoke' | null>(null)
const revokeOpen = ref(false)

const emptyResponse = (): ClientPortalAccessResponse => ({
  data: {
    case_id: props.caseId,
    recipient: null,
    access: {
      portal_enabled: false,
      multiform_enabled: false,
      portal_enabled_at: null,
      multiform_enabled_at: null,
      revoked_at: null,
      created_at: null,
      updated_at: null,
      revision: 0,
    },
    invitation: null,
    invitation_delivery: {
      status: 'not_created',
      message: 'Zaproszenie powstanie po udostępnieniu panelu klienta.',
    },
    can_configure: false,
    blocking_reason: null,
  },
})

const {
  data: portalAccess,
  status,
  error,
  refresh,
} = await useAsyncData<ClientPortalAccessResponse>(
  `crm-case-client-portal:${caseId.value}`,
  () => requestFetch<ClientPortalAccessResponse>(
    crmApiPath(`/cases/${caseId.value}/portal-access`),
  ),
  {
    default: emptyResponse,
    watch: [caseId],
  },
)

const access = computed(() => portalAccess.value.data.access)
const recipient = computed(() => portalAccess.value.data.recipient)
const invitation = computed(() => portalAccess.value.data.invitation)
const delivery = computed(() => portalAccess.value.data.invitation_delivery)

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDate(value: string | null | undefined) {
  return value ? dateFormatter.format(new Date(value)) : '—'
}

function deliveryPresentation(status: ClientPortalInvitationDeliveryStatus) {
  if (status === 'accepted') {
    return { color: 'success' as const, icon: 'i-lucide-circle-check-big', title: 'Konto klienta jest aktywne' }
  }
  if (status === 'sent') {
    return { color: 'info' as const, icon: 'i-lucide-mail-check', title: 'Zaproszenie zostało wysłane' }
  }
  if (status === 'pending_send') {
    return { color: 'warning' as const, icon: 'i-lucide-mail-clock', title: 'Zaproszenie czeka na wysyłkę' }
  }
  if (status === 'failed') {
    return { color: 'error' as const, icon: 'i-lucide-mail-x', title: 'Nie udało się wysłać zaproszenia' }
  }
  if (status === 'missing_email') {
    return { color: 'warning' as const, icon: 'i-lucide-at-sign', title: 'Brakuje adresu e-mail' }
  }
  if (status === 'expired') {
    return { color: 'error' as const, icon: 'i-lucide-clock-alert', title: 'Zaproszenie wygasło' }
  }
  if (status === 'revoked') {
    return { color: 'neutral' as const, icon: 'i-lucide-shield-off', title: 'Zaproszenie zostało cofnięte' }
  }
  return { color: 'neutral' as const, icon: 'i-lucide-mail-plus', title: 'Zaproszenie nie zostało utworzone' }
}

const invitationAlert = computed(() => deliveryPresentation(delivery.value.status))

async function saveAccess(
  portalEnabled: boolean,
  multiformEnabled: boolean,
  operation: 'portal' | 'multiform' | 'resend' | 'revoke',
) {
  if (saving.value) return
  saving.value = operation
  try {
    const result = await $fetch<ClientPortalAccessResponse>(
      crmApiPath(`/cases/${caseId.value}/portal-access`),
      {
        method: 'PUT',
        body: {
          portal_enabled: portalEnabled,
          multiform_enabled: portalEnabled && multiformEnabled,
          expected_revision: access.value.revision,
          resend_invitation: operation === 'resend',
        },
      },
    )
    portalAccess.value = result
    emit('changed')

    if (operation === 'portal') {
      toast.add({
        title: 'Udostępniono panel klienta',
        description: result.data.invitation_delivery.message,
        color: 'success',
        icon: 'i-lucide-shield-check',
      })
    }
    else if (operation === 'multiform') {
      toast.add({
        title: multiformEnabled
          ? 'Udostępniono formularz Multiwniosku'
          : 'Wyłączono formularz Multiwniosku',
        color: multiformEnabled ? 'success' : 'neutral',
        icon: multiformEnabled ? 'i-lucide-file-check-2' : 'i-lucide-file-lock-2',
      })
    }
    else if (operation === 'resend') {
      toast.add({
        title: 'Wysłano nowy link aktywacyjny',
        description: result.data.invitation_delivery.message,
        color: 'success',
        icon: 'i-lucide-send',
      })
    }
    else {
      revokeOpen.value = false
      toast.add({
        title: 'Cofnięto dostęp klienta',
        description: 'Panel sprawy i formularz Multiwniosku są wyłączone.',
        color: 'neutral',
        icon: 'i-lucide-shield-off',
      })
    }
  }
  catch (caught: any) {
    await refresh()
    toast.add({
      title: 'Nie udało się zmienić dostępu',
      description: caught?.data?.statusMessage
        ?? caught?.message
        ?? 'Odśwież widok i spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    saving.value = null
  }
}

function setPortalEnabled(enabled: boolean) {
  if (enabled) {
    void saveAccess(true, access.value.multiform_enabled, 'portal')
    return
  }
  revokeOpen.value = true
}

function setMultiformEnabled(enabled: boolean) {
  if (!access.value.portal_enabled) return
  void saveAccess(true, enabled, 'multiform')
}

function revokeAccess() {
  void saveAccess(false, false, 'revoke')
}

function resendInvitation() {
  void saveAccess(true, access.value.multiform_enabled, 'resend')
}
</script>

<template>
  <section class="portal-access" aria-labelledby="client-portal-access-title" data-testid="case-client-portal-access">
    <header class="portal-access__header">
      <div class="portal-access__title">
        <span class="portal-access__icon"><UIcon name="i-lucide-panel-top-open" /></span>
        <div>
          <p>Panel klienta</p>
          <h3 id="client-portal-access-title">Udostępnienie sprawy i Multiwniosku</h3>
          <span>Klient zobaczy tylko zakres odblokowany dla tej sprawy.</span>
        </div>
      </div>
      <UBadge
        :color="access.portal_enabled ? 'success' : 'neutral'"
        :variant="access.portal_enabled ? 'subtle' : 'outline'"
        size="lg"
        :icon="access.portal_enabled ? 'i-lucide-shield-check' : 'i-lucide-shield-off'"
      >
        {{ access.portal_enabled ? 'Panel włączony' : 'Panel wyłączony' }}
      </UBadge>
    </header>

    <div v-if="status === 'pending'" class="portal-access__loading">
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-24 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać ustawień panelu"
      description="Odśwież dane i spróbuj ponownie."
    >
      <template #actions>
        <UButton color="error" variant="soft" size="sm" @click="refresh()">Odśwież</UButton>
      </template>
    </UAlert>

    <template v-else>
      <UAlert
        v-if="portalAccess.data.blocking_reason"
        color="warning"
        variant="subtle"
        icon="i-lucide-user-round-x"
        title="Nie można jeszcze udostępnić panelu"
        :description="portalAccess.data.blocking_reason"
      />

      <div v-if="recipient" class="portal-access__recipient">
        <span class="portal-access__avatar"><UIcon name="i-lucide-user-round" /></span>
        <div>
          <small>Główna osoba · odbiorca dostępu</small>
          <strong>{{ recipient.display_name }}</strong>
          <span>{{ recipient.email || recipient.phone || 'Brak danych kontaktowych' }}</span>
        </div>
        <UBadge color="neutral" variant="subtle" size="sm">Osoba główna</UBadge>
        <UButton
          :to="orgPath(`/clients/${recipient.client_id}`)"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-external-link"
        >
          Karta klienta
        </UButton>
      </div>

      <div class="portal-access__settings">
        <div class="portal-access__setting">
          <span class="portal-access__setting-icon"><UIcon name="i-lucide-layout-dashboard" /></span>
          <div class="portal-access__setting-copy">
            <div>
              <strong>Panel tej sprawy</strong>
              <p>Podsumowanie procesu, bezpieczne wiadomości i udostępnione działania klienta.</p>
            </div>
            <small v-if="access.portal_enabled_at">
              {{ access.portal_enabled ? 'Udostępniono' : 'Ostatnio udostępniono' }}
              {{ formatDate(access.portal_enabled_at) }}
            </small>
          </div>
          <USwitch
            :model-value="access.portal_enabled"
            :disabled="!portalAccess.data.can_configure || Boolean(saving)"
            :loading="saving === 'portal'"
            aria-label="Udostępnij panel sprawy klientowi"
            @update:model-value="setPortalEnabled(Boolean($event))"
          />
        </div>

        <div :class="['portal-access__setting', { 'is-disabled': !access.portal_enabled }]">
          <span class="portal-access__setting-icon"><UIcon name="i-lucide-files" /></span>
          <div class="portal-access__setting-copy">
            <div>
              <strong>Formularz Multiwniosku</strong>
              <p>
                Pozwala klientowi uzupełniać pytania i dane formularza. Wymaga aktywnego panelu sprawy.
              </p>
            </div>
            <small v-if="access.multiform_enabled_at">
              {{ access.multiform_enabled ? 'Udostępniono' : 'Ostatnio udostępniono' }}
              {{ formatDate(access.multiform_enabled_at) }}
            </small>
            <small v-else-if="!access.portal_enabled">Najpierw włącz panel klienta.</small>
          </div>
          <USwitch
            :model-value="access.multiform_enabled"
            :disabled="!access.portal_enabled || Boolean(saving)"
            :loading="saving === 'multiform'"
            aria-label="Udostępnij formularz Multiwniosku klientowi"
            @update:model-value="setMultiformEnabled(Boolean($event))"
          />
        </div>
      </div>

      <UAlert
        v-if="access.portal_enabled || delivery.status === 'missing_email'"
        :color="invitationAlert.color"
        variant="subtle"
        :icon="invitationAlert.icon"
        :title="invitationAlert.title"
        :description="delivery.message"
      >
        <template #actions>
          <div class="portal-access__invitation-actions">
            <span v-if="invitation" class="portal-access__invitation-date">
              <template v-if="invitation.accepted_at">Aktywacja: {{ formatDate(invitation.accepted_at) }}</template>
              <template v-else-if="invitation.sent_at">Wysłano: {{ formatDate(invitation.sent_at) }}</template>
              <template v-else>Wygasa: {{ formatDate(invitation.expires_at) }}</template>
            </span>
            <UButton
              v-if="delivery.status === 'failed' || delivery.status === 'expired'"
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-refresh-cw"
              :loading="saving === 'resend'"
              :disabled="Boolean(saving)"
              @click="resendInvitation"
            >
              Wyślij nowy link
            </UButton>
          </div>
        </template>
      </UAlert>

      <footer v-if="access.portal_enabled" class="portal-access__footer">
        <div>
          <UIcon name="i-lucide-info" />
          <span>Cofnięcie dostępu natychmiast wyłączy również formularz Multiwniosku.</span>
        </div>
        <UButton
          color="error"
          variant="ghost"
          size="sm"
          icon="i-lucide-shield-off"
          :disabled="Boolean(saving)"
          @click="revokeOpen = true"
        >
          Cofnij dostęp
        </UButton>
      </footer>
    </template>

    <UModal
      v-model:open="revokeOpen"
      title="Cofnąć dostęp klienta?"
      :description="recipient
        ? `${recipient.display_name} straci dostęp do tej sprawy i formularza Multiwniosku.`
        : 'Klient straci dostęp do tej sprawy i formularza Multiwniosku.'"
      :dismissible="saving !== 'revoke'"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Dane klienta pozostaną w CRM"
          description="Cofnięcie dotyczy wyłącznie dostępu do panelu. Nie usuwa klienta, sprawy ani zapisanych odpowiedzi."
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="saving === 'revoke'" @click="close">
          Anuluj
        </UButton>
        <UButton color="error" icon="i-lucide-shield-off" :loading="saving === 'revoke'" @click="revokeAccess">
          Cofnij dostęp
        </UButton>
      </template>
    </UModal>
  </section>
</template>

<style scoped>
.portal-access {
  overflow: hidden;
  margin-bottom: 18px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-text) 4%, transparent);
}

.portal-access__header,
.portal-access__title,
.portal-access__recipient,
.portal-access__setting,
.portal-access__footer,
.portal-access__footer > div {
  display: flex;
  align-items: center;
}

.portal-access__header {
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg-elevated) 62%, var(--ui-bg));
}

.portal-access__title {
  min-width: 0;
  gap: 12px;
}

.portal-access__icon,
.portal-access__avatar,
.portal-access__setting-icon {
  display: grid;
  flex: none;
  place-items: center;
}

.portal-access__icon {
  width: 38px;
  height: 38px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 25%, var(--ui-border));
  border-radius: 10px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg));
}

.portal-access__icon :deep(svg) {
  width: 19px;
  height: 19px;
}

.portal-access__title > div,
.portal-access__recipient > div,
.portal-access__setting-copy,
.portal-access__setting-copy > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.portal-access__title > div {
  gap: 2px;
}

.portal-access__title p,
.portal-access__title h3,
.portal-access__title span,
.portal-access__recipient small,
.portal-access__recipient strong,
.portal-access__recipient span,
.portal-access__setting strong,
.portal-access__setting p,
.portal-access__setting small {
  margin: 0;
}

.portal-access__title p {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.portal-access__title h3 {
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 680;
}

.portal-access__title span,
.portal-access__recipient span,
.portal-access__setting p,
.portal-access__setting small,
.portal-access__footer,
.portal-access__invitation-date {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.portal-access__loading {
  display: grid;
  gap: 12px;
  padding: 20px;
}

.portal-access__recipient {
  gap: 12px;
  margin: 18px 20px 0;
  padding: 13px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-elevated);
}

.portal-access__avatar {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-accented);
}

.portal-access__recipient > div {
  flex: 1;
  gap: 1px;
}

.portal-access__recipient small {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.portal-access__recipient strong,
.portal-access__setting strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.portal-access__settings {
  margin: 18px 20px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
}

.portal-access__setting {
  gap: 13px;
  min-height: 82px;
  padding: 14px;
}

.portal-access__setting + .portal-access__setting {
  border-top: 1px solid var(--ui-border);
}

.portal-access__setting.is-disabled {
  background: color-mix(in srgb, var(--ui-bg-muted) 65%, transparent);
}

.portal-access__setting-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.portal-access__setting-copy {
  flex: 1;
  gap: 5px;
}

.portal-access__setting-copy > div {
  gap: 2px;
}

.portal-access__setting p {
  line-height: 1.45;
}

.portal-access :deep([data-slot="root"][role="alert"]) {
  margin: 0 20px 18px;
}

.portal-access__footer {
  justify-content: space-between;
  gap: 14px;
  padding: 12px 20px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.portal-access__footer > div {
  gap: 7px;
}

.portal-access__footer :deep(svg) {
  flex: none;
}

@media (max-width: 720px) {
  .portal-access__header,
  .portal-access__recipient,
  .portal-access__footer {
    align-items: flex-start;
  }

  .portal-access__header,
  .portal-access__footer {
    flex-direction: column;
  }

  .portal-access__recipient {
    flex-wrap: wrap;
  }

  .portal-access__recipient > :deep(a) {
    width: 100%;
  }

  .portal-access__setting {
    align-items: flex-start;
  }

  .portal-access__setting > :deep(button) {
    margin-top: 7px;
  }

  .portal-access__footer > :deep(button) {
    width: 100%;
  }
}
</style>
