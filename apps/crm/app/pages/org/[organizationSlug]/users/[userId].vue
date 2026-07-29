<script setup lang="ts">
import type { OrganizationMember } from '~/types/organization'
import type {
  OrganizationMembersPayload,
  UserStructureAssignmentsPayload,
  UserStructureTeamAssignment,
} from '~/types/scheduling'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })

type DetailView = 'overview' | 'admin-access' | 'teams' | 'accreditation' | 'history'
type AdminRoleId =
  | 'organization_admin'
  | 'access_admin'
  | 'structure_admin'
  | 'consents_admin'
  | 'crm_config_admin'

type AdminRoleDefinition = {
  id: AdminRoleId
  label: string
  description: string
  icon: string
  permissionCount: number
  emphasis?: 'highest' | 'sensitive'
  permissions: string[]
}

type AccessDraft = {
  roles: Record<AdminRoleId, boolean>
  consentPublish: boolean
  consentReason: string
  consentExpiresAt: string
}

type ConsentExceptionSnapshot = Pick<
  AccessDraft,
  'consentPublish' | 'consentReason' | 'consentExpiresAt'
>

type EffectiveArea = {
  id: string
  label: string
  description: string
  icon: string
  granted: boolean
  pending?: boolean
  source: string
  sensitive?: boolean
  highRisk?: boolean
}

type AuditEntryTone = 'success' | 'warning' | 'error' | 'neutral'

type AuditActor = {
  id: string
  name: string
  role: string
  email?: string
  avatarUrl?: string | null
}

type AuditLogEntry = {
  id: string
  eventId: string
  title: string
  description: string
  field: string
  before?: string
  after?: string
  reason?: string
  createdAt: Date
  actor: AuditActor
  source: string
  tone: AuditEntryTone
  icon: string
}

type AdministrativeRoleAssignment = {
  key: AdminRoleId
  source: 'direct' | 'organization_membership'
  assignedAt: string
  assignedBy: {
    userId: string
    fullName: string
    email: string
    avatarUrl: string | null
  } | null
}

type ConsentPublishingGrant = {
  id: string
  permissionKey: 'compliance.consents.definitions.publish'
  status: 'active' | 'expired' | 'revoked'
  justification: string
  validFrom: string
  expiresAt: string
  revision: number
  grantedByUserId: string
}

type AdministrativeAccessState = {
  userId: string
  revision: number
  roles: AdministrativeRoleAssignment[]
  consentPublishingGrant: ConsentPublishingGrant | null
  updatedAt: string | null
  updatedBy: {
    userId: string
    fullName: string
    email: string
    avatarUrl: string | null
  } | null
}

type AdministrativeAccessPayload = {
  access?: AdministrativeAccessState
  data?: AdministrativeAccessState
}

type AuditChange = {
  field: string
  before: unknown
  after: unknown
}

type AdministrativeAuditEvent = {
  id: string
  eventId?: string
  eventType: string
  resourceType: string
  resourceId: string | null
  resourceLabel: string | null
  changes: AuditChange[]
  reason: string | null
  source: string
  correlationId?: string
  revisionBefore: number | null
  revisionAfter: number | null
  createdAt: string
  actor: {
    userId: string | null
    fullName: string
    email?: string | null
    avatarUrl?: string | null
    role?: string | null
  }
}

type AdministrativeAuditEventsPayload = {
  data: AdministrativeAuditEvent[]
  page: {
    limit: number
    hasMore: boolean
    nextCursor: string | null
  }
}

type AnonymizationGrantStatus =
  | 'pending_approval'
  | 'active'
  | 'rejected'
  | 'revoked'
  | 'consumed'
  | 'expired'

type AnonymizationGrant = {
  id: string
  revision: number
  permissionKey: 'clients.anonymization.execute'
  requestNumber: string
  requestId: string
  clientReference: string
  justification: string
  expiresAt: string
  requestedByUserId: string
  approverId: string
  approverName: string
  singleUse: true
  status: AnonymizationGrantStatus
}

type AnonymizationGrantForm = {
  requestId: string
  justification: string
  expiresAt: string
  approverId: string
}

type AnonymizationGrantApi = {
  id: string
  revision: number
  permissionKey: 'clients.anonymization.execute'
  status: AnonymizationGrantStatus
  singleUse: true
  request: {
    id: string
    requestNumber: string
    status: string
    dueAt: string
    client: {
      id: string
      displayName: string
    } | null
  } | null
  grantee: {
    userId: string
    fullName: string
    email: string
    avatarUrl: string | null
  } | null
  requestedBy: {
    userId: string
    fullName: string
    email: string
    avatarUrl: string | null
  } | null
  approver: {
    userId: string
    fullName: string
    email: string
    avatarUrl: string | null
  } | null
  justification: string
  decisionReason: string | null
  requestedAt: string
  approvedAt: string | null
  expiresAt: string
  consumedAt: string | null
  revokedAt: string | null
}

type AnonymizationGrantsPayload = {
  data: AnonymizationGrantApi[]
  limit: number
}

type AnonymizationApprover = {
  userId: string
  fullName: string
  email: string
  avatarUrl: string | null
}

type AnonymizationApproversPayload = {
  data: Array<AnonymizationApprover & { roleKeys: AdminRoleId[] }>
}

type ApprovedAnonymizationRequest = {
  id: string
  requestNumber: string
  status: string
  dueAt: string
  client: {
    id: string
    displayName: string
  }
}

type ApprovedAnonymizationRequestsPayload = {
  data: ApprovedAnonymizationRequest[]
}

type StructureAssignmentKind = 'team' | 'facility'

type StructureRemoval = {
  kind: StructureAssignmentKind
  id: string
  name: string
}

const route = useRoute()
const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()

const userId = computed(() => {
  const param = route.params.userId
  return Array.isArray(param) ? String(param[0] ?? '') : String(param ?? '')
})

const activeView = computed<DetailView>(() => {
  const query = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  if (query === 'overview' || query === 'teams' || query === 'accreditation' || query === 'history') return query
  return 'admin-access'
})

const tabs = computed(() => [
  {
    label: 'Podsumowanie',
    to: { path: route.path, query: { view: 'overview' } },
    active: activeView.value === 'overview',
  },
  {
    label: 'Dostęp administracyjny',
    to: { path: route.path },
    active: activeView.value === 'admin-access',
  },
  {
    label: 'Zespoły i placówki',
    to: { path: route.path, query: { view: 'teams' } },
    active: activeView.value === 'teams',
  },
  {
    label: 'Akredytacja',
    to: { path: route.path, query: { view: 'accreditation' } },
    active: activeView.value === 'accreditation',
  },
  {
    label: 'Historia zmian',
    to: { path: route.path, query: { view: 'history' } },
    active: activeView.value === 'history',
  },
])

const roleDefinitions: AdminRoleDefinition[] = [
  {
    id: 'organization_admin',
    label: 'Administrator organizacji',
    description: 'Administracja organizacją bez edycji i publikowania definicji zgód.',
    icon: 'i-lucide-crown',
    permissionCount: 18,
    emphasis: 'highest',
    permissions: ['Ustawienia organizacji', 'Użytkownicy i dostępy', 'Struktura', 'Ustawienia operacyjne'],
  },
  {
    id: 'access_admin',
    label: 'Administrator dostępów',
    description: 'Zaprasza użytkowników oraz nadaje role i bezpośrednie wyjątki.',
    icon: 'i-lucide-key-round',
    permissionCount: 6,
    permissions: ['Użytkownicy', 'Role administracyjne', 'Przegląd wyjątków'],
  },
  {
    id: 'structure_admin',
    label: 'Administrator struktury',
    description: 'Zarządza zespołami, ich hierarchią oraz placówkami organizacji.',
    icon: 'i-lucide-network',
    permissionCount: 7,
    permissions: ['Zespoły', 'Hierarchia', 'Placówki'],
  },
  {
    id: 'consents_admin',
    label: 'Administrator zgód',
    description: 'Tworzy i edytuje robocze wersje zgód. Nie może samodzielnie ich publikować.',
    icon: 'i-lucide-file-check-2',
    permissionCount: 4,
    emphasis: 'sensitive',
    permissions: ['Wersje robocze', 'Podgląd', 'Historia wersji'],
  },
  {
    id: 'crm_config_admin',
    label: 'Administrator ustawień operacyjnych',
    description: 'Zarządza założeniami zdolności oraz wspólnymi parametrami usług.',
    icon: 'i-lucide-sliders-horizontal',
    permissionCount: 2,
    permissions: ['Założenia zdolności', 'Parametry usług'],
  },
]
const standardRoleDefinitions = roleDefinitions.filter(role => role.emphasis !== 'sensitive')
const sensitiveRoleDefinition = roleDefinitions.find(role => role.id === 'consents_admin')!

const emptyDirectory: OrganizationMembersPayload = {
  currentUserId: '',
  role: 'expert',
  canAssignOthers: false,
  members: [],
}

const {
  data: directory,
  status,
  error,
  refresh,
} = await useFetch<OrganizationMembersPayload>(
  () => orgApiPath('/members'),
  { default: () => emptyDirectory },
)

const member = computed(() => directory.value.members.find(item => item.userId === userId.value) ?? null)
const canManageAccess = computed(() =>
  directory.value.capabilities?.canManageAccess ?? directory.value.canAssignOthers,
)
const canManageStructure = computed(() =>
  directory.value.capabilities?.canManageStructure ?? directory.value.canAssignOthers,
)
const canReadAudit = computed(() =>
  directory.value.capabilities?.canReadAudit ?? directory.value.canAssignOthers,
)
const canRequestPrivacyGrants = computed(() =>
  directory.value.capabilities?.canRequestPrivacyGrants ?? directory.value.canAssignOthers,
)
const canApprovePrivacyGrants = computed(() =>
  directory.value.capabilities?.canApprovePrivacyGrants ?? directory.value.canAssignOthers,
)
const canEdit = canManageAccess
const isApprovalOnly = computed(() =>
  canApprovePrivacyGrants.value && !canManageAccess.value,
)
const isCurrentUser = computed(() => member.value?.userId === directory.value.currentUserId)
const userName = computed(() => member.value?.fullName || member.value?.email || 'Użytkownik')

const emptyAdministrativeAccessPayload: AdministrativeAccessPayload = {}
const {
  data: administrativeAccessPayload,
  status: administrativeAccessStatus,
  error: administrativeAccessError,
  refresh: refreshAdministrativeAccess,
} = await useFetch<AdministrativeAccessPayload>(
  () => orgApiPath(`/members/${userId.value}/admin-access`),
  {
    default: () => emptyAdministrativeAccessPayload,
    immediate: canManageAccess.value && Boolean(member.value),
  },
)

const administrativeAccess = computed(() =>
  administrativeAccessPayload.value.access
  ?? administrativeAccessPayload.value.data
  ?? null,
)

const {
  data: administrativeAuditEvents,
  status: administrativeAuditStatus,
  error: administrativeAuditError,
  refresh: refreshAdministrativeAudit,
} = await useFetch<AdministrativeAuditEventsPayload>(
  () => orgApiPath(`/members/${userId.value}/admin-access/audit-events?limit=50`),
  {
    default: () => ({
      data: [],
      page: { limit: 100, hasMore: false, nextCursor: null },
    }),
    immediate: canReadAudit.value && Boolean(member.value),
  },
)

const {
  data: anonymizationGrantsPayload,
  status: anonymizationGrantsStatus,
  error: anonymizationGrantsError,
  refresh: refreshAnonymizationGrants,
} = await useFetch<AnonymizationGrantsPayload>(
  () => orgApiPath(`/members/${userId.value}/admin-access/anonymization-grants`),
  {
    default: () => ({ data: [], limit: 100 }),
    immediate: (canRequestPrivacyGrants.value || canApprovePrivacyGrants.value)
      && Boolean(member.value),
  },
)

const {
  data: anonymizationApproversPayload,
  status: anonymizationApproversStatus,
  error: anonymizationApproversError,
  refresh: refreshAnonymizationApprovers,
} = await useFetch<AnonymizationApproversPayload>(
  () => orgApiPath(`/members/${userId.value}/admin-access/anonymization-grants/approvers`),
  {
    default: () => ({ data: [] }),
    immediate: canRequestPrivacyGrants.value && Boolean(member.value),
  },
)

const { data: approvedAnonymizationRequests } = await useFetch<ApprovedAnonymizationRequestsPayload>(
  () => orgApiPath('/crm/anonymization-requests'),
  {
    default: () => ({ data: [] }),
    immediate: canRequestPrivacyGrants.value,
  },
)

const emptyStructureAssignments: UserStructureAssignmentsPayload = {
  data: {
    teams: [],
    facilities: [],
  },
  catalog: {
    teams: [],
    facilities: [],
  },
}

const {
  data: structureAssignments,
  status: structureStatus,
  error: structureError,
  refresh: refreshStructureAssignments,
} = await useFetch<UserStructureAssignmentsPayload>(
  () => orgApiPath(`/members/${userId.value}/assignments`),
  {
    default: () => emptyStructureAssignments,
    immediate: canEdit.value,
  },
)

const draft = reactive<AccessDraft>(blankAccessDraft())
const savedDraft = ref<AccessDraft>(blankAccessDraft())
const savedAccessRevision = ref(0)
const initializedAccessKey = ref('')
const saving = ref(false)
const loadingMoreAuditEvents = ref(false)
const showValidation = ref(false)
const exceptionModalOpen = ref(false)
const consentExceptionSnapshot = ref<ConsentExceptionSnapshot | null>(null)
const anonymizationModalOpen = ref(false)
const anonymizationShowValidation = ref(false)
const anonymizationActionKey = ref('')
const anonymizationActionModalOpen = ref(false)
const anonymizationAction = ref<'approve' | 'reject' | 'revoke' | null>(null)
const anonymizationActionReason = ref('')
const anonymizationActionShowValidation = ref(false)
const anonymizationGrantForm = reactive<AnonymizationGrantForm>({
  requestId: '',
  justification: '',
  expiresAt: '',
  approverId: '',
})
const teamAssignmentModalOpen = ref(false)
const facilityAssignmentModalOpen = ref(false)
const structureRemovalModalOpen = ref(false)
const structureRemoval = ref<StructureRemoval | null>(null)
const structureActionKey = ref('')
const teamAssignmentForm = reactive({
  teamId: '',
  role: 'member' as 'member' | 'admin',
})
const facilityAssignmentForm = reactive({
  facilityId: '',
})

const verifiedAnonymizationRequests = computed(() =>
  approvedAnonymizationRequests.value.data.map(request => ({
    label: `${request.requestNumber} · ${request.client.displayName}`,
    value: request.id,
    requestNumber: request.requestNumber,
    clientReference: request.client.displayName,
  })),
)

const anonymizationApprovers = computed(() =>
  anonymizationApproversPayload.value.data.map(approver => ({
    label: `${approver.fullName} · ${approver.email}`,
    value: approver.userId,
    name: approver.fullName,
  })),
)

const anonymizationGrant = computed<AnonymizationGrant | null>(() => {
  const openGrants = anonymizationGrantsPayload.value.data.filter(item =>
    item.status === 'pending_approval' || item.status === 'active',
  )
  const grant = isApprovalOnly.value
    ? openGrants.find(item =>
        item.status === 'pending_approval'
        && item.approver?.userId === directory.value.currentUserId,
      )
    : openGrants[0]
  if (!grant || !grant.request || !grant.requestedBy || !grant.approver) return null
  return {
    id: grant.id,
    revision: grant.revision,
    permissionKey: grant.permissionKey,
    requestId: grant.request.id,
    requestNumber: grant.request.requestNumber,
    clientReference: grant.request.client?.displayName ?? 'Klient powiązany z żądaniem',
    justification: grant.justification,
    expiresAt: grant.expiresAt,
    requestedByUserId: grant.requestedBy.userId,
    approverId: grant.approver.userId,
    approverName: grant.approver.fullName,
    singleUse: true,
    status: grant.status,
  }
})

const teamAssignments = computed(() => structureAssignments.value.data.teams)
const facilityAssignments = computed(() => structureAssignments.value.data.facilities)
const teamAssignmentIds = computed(() => new Set(
  teamAssignments.value.map(assignment => assignment.team.id),
))
const facilityAssignmentIds = computed(() => new Set(
  facilityAssignments.value.map(assignment => assignment.facility.id),
))
const availableTeamItems = computed(() => structureAssignments.value.catalog.teams
  .filter(team => !teamAssignmentIds.value.has(team.id))
  .map(team => ({
    label: team.name,
    value: team.id,
  })))
const availableFacilityItems = computed(() => structureAssignments.value.catalog.facilities
  .filter(facility => facility.is_active && !facilityAssignmentIds.value.has(facility.id))
  .map(facility => ({
    label: facility.city ? `${facility.name} · ${facility.city}` : facility.name,
    value: facility.id,
  })))
const teamMembershipRoleItems = [
  { label: 'Członek zespołu', value: 'member' },
  { label: 'Administrator zespołu', value: 'admin' },
]

watch(
  [member, administrativeAccess, administrativeAccessStatus],
  ([value, access, accessStatus]) => {
    if (!value || !access || accessStatus !== 'success') return
    const accessKey = `${value.userId}:${access.revision}`
    if (initializedAccessKey.value === accessKey) return
    const persisted = accessDraftFromState(access)
    applyDraft(persisted)
    savedDraft.value = cloneDraft(persisted)
    savedAccessRevision.value = access.revision
    initializedAccessKey.value = accessKey
    showValidation.value = false
  },
  { immediate: true },
)

const hasUnsavedChanges = computed(() => draftSignature(draft) !== draftSignature(savedDraft.value))
const activeRoleCount = computed(() => Object.values(draft.roles).filter(Boolean).length)
const standardActiveRoleCount = computed(() =>
  standardRoleDefinitions.filter(role => draft.roles[role.id]).length,
)
const consentReasonValid = computed(() => !draft.consentPublish || draft.consentReason.trim().length >= 10)
const consentExpiryValid = computed(() => {
  if (!draft.consentPublish) return true
  if (!draft.consentExpiresAt) return false
  return new Date(`${draft.consentExpiresAt}T23:59:59`).getTime() > Date.now()
})
const consentExceptionValid = computed(() => {
  return consentReasonValid.value && consentExpiryValid.value
})
const selectedAnonymizationRequest = computed(() =>
  verifiedAnonymizationRequests.value.find(request => request.value === anonymizationGrantForm.requestId) ?? null,
)
const selectedAnonymizationApprover = computed(() =>
  anonymizationApprovers.value.find(approver => approver.value === anonymizationGrantForm.approverId) ?? null,
)
const anonymizationRequestValid = computed(() => Boolean(selectedAnonymizationRequest.value))
const anonymizationReasonValid = computed(() => anonymizationGrantForm.justification.trim().length >= 20)
const anonymizationExpiryValid = computed(() => {
  if (!anonymizationGrantForm.expiresAt) return false
  const expiry = new Date(anonymizationGrantForm.expiresAt).getTime()
  const now = Date.now()
  return Number.isFinite(expiry) && expiry > now && expiry <= now + 24 * 60 * 60 * 1000
})
const anonymizationGrantFormValid = computed(() =>
  anonymizationRequestValid.value
  && anonymizationReasonValid.value
  && anonymizationExpiryValid.value
  && Boolean(selectedAnonymizationApprover.value),
)
const canRespondToAnonymizationGrant = computed(() =>
  canApprovePrivacyGrants.value
  &&
  anonymizationGrant.value?.status === 'pending_approval'
  && anonymizationGrant.value.approverId === directory.value.currentUserId,
)
const anonymizationActionReasonValid = computed(() => {
  const reasonLength = anonymizationActionReason.value.trim().length
  if (anonymizationAction.value === 'approve') return reasonLength === 0 || reasonLength >= 10
  return reasonLength >= 10
})
const anonymizationActionPresentation = computed(() => {
  if (anonymizationAction.value === 'approve') {
    return {
      title: 'Zatwierdzić grant anonimizacji?',
      description: 'Dostęp stanie się aktywny i będzie można wykorzystać go tylko raz.',
      label: 'Zatwierdź grant',
      icon: 'i-lucide-user-round-check',
      color: 'success' as const,
      reasonLabel: 'Komentarz (opcjonalnie)',
    }
  }
  if (anonymizationAction.value === 'reject') {
    return {
      title: 'Odrzucić grant anonimizacji?',
      description: 'Wniosek nie będzie mógł zostać aktywowany. Powód trafi do dziennika audytu.',
      label: 'Odrzuć grant',
      icon: 'i-lucide-user-round-x',
      color: 'error' as const,
      reasonLabel: 'Powód odrzucenia',
    }
  }
  return {
    title: 'Cofnąć grant anonimizacji?',
    description: 'Oczekujący lub aktywny grant zostanie natychmiast unieważniony.',
    label: 'Cofnij grant',
    icon: 'i-lucide-undo-2',
    color: 'error' as const,
    reasonLabel: 'Powód cofnięcia',
  }
})
const directAccessCount = computed(() => Number(draft.consentPublish) + Number(Boolean(anonymizationGrant.value)))
const activeDirectAccessCount = computed(() =>
  Number(draft.consentPublish) + Number(anonymizationGrant.value?.status === 'active'),
)
const pendingDirectAccessCount = computed(() => Number(anonymizationGrant.value?.status === 'pending_approval'))
const teamAssignmentCountLabel = computed(() => polishCount(
  teamAssignments.value.length,
  'zespół',
  'zespoły',
  'zespołów',
))
const facilityAssignmentCountLabel = computed(() => polishCount(
  facilityAssignments.value.length,
  'placówka',
  'placówki',
  'placówek',
))
const teamAdminAssignmentCount = computed(() =>
  teamAssignments.value.filter(assignment => assignment.membership.role === 'admin').length,
)
const facilityAdminAssignmentCount = computed(() =>
  facilityAssignments.value.filter(assignment => assignment.membership.role === 'admin').length,
)
const teamOverviewNames = computed(() =>
  summarizeNames(teamAssignments.value.map(assignment => assignment.team.name)),
)
const facilityOverviewNames = computed(() =>
  summarizeNames(facilityAssignments.value.map(assignment =>
    assignment.facility.city
      ? `${assignment.facility.name} · ${assignment.facility.city}`
      : assignment.facility.name,
  )),
)
const auditHistory = computed(() => administrativeAuditEvents.value.data
  .map(toAuditLogEntry)
  .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime()))
const latestAuditEntries = computed(() => auditHistory.value.slice(0, 5))
const latestAuditDateLabel = computed(() => {
  const latest = auditHistory.value[0]
  if (!latest) return '—'
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
  }).format(latest.createdAt)
})
const latestAuditSummary = computed(() => {
  const latest = auditHistory.value[0]
  if (!latest) return 'brak zarejestrowanych zmian'
  return `${latest.actor.name} · ${latest.source}`
})
const structureRemovalTitle = computed(() => {
  if (!structureRemoval.value) return 'Usunąć przypisanie?'
  return structureRemoval.value.kind === 'team'
    ? `Usunąć z zespołu „${structureRemoval.value.name}”?`
    : `Usunąć z placówki „${structureRemoval.value.name}”?`
})
const structureRemovalDescription = computed(() => {
  if (!structureRemoval.value) return ''
  const scope = structureRemoval.value.kind === 'team' ? 'zespołowe' : 'do placówki'
  return `Usunięte zostanie wyłącznie przypisanie ${scope}. Role administracyjne i akredytacje użytkownika nie zmienią się.`
})

const effectiveAreas = computed<EffectiveArea[]>(() => {
  const organization = draft.roles.organization_admin
  const anonymizationPending = anonymizationGrant.value?.status === 'pending_approval'
  const anonymizationActive = anonymizationGrant.value?.status === 'active'
  return [
    {
      id: 'access',
      label: 'Użytkownicy i role',
      description: 'Zaproszenia, role administracyjne i historia zmian',
      icon: 'i-lucide-users-round',
      granted: organization || draft.roles.access_admin,
      source: effectiveSource('access_admin', 'Administrator dostępów'),
    },
    {
      id: 'structure',
      label: 'Zespoły i placówki',
      description: 'Struktura organizacyjna i lokalizacje',
      icon: 'i-lucide-network',
      granted: organization || draft.roles.structure_admin,
      source: effectiveSource('structure_admin', 'Administrator struktury'),
    },
    {
      id: 'consents',
      label: 'Zgody i compliance',
      description: 'Edycja definicji i kontrolowana publikacja',
      icon: 'i-lucide-scale',
      granted: draft.roles.consents_admin || draft.consentPublish,
      source: draft.roles.consents_admin && draft.consentPublish
        ? 'Rola Administrator zgód + dostęp bezpośredni'
        : draft.roles.consents_admin
          ? 'Rola Administrator zgód'
          : draft.consentPublish
            ? 'Tylko publikowanie · dostęp bezpośredni'
            : 'Brak roli i dostępu bezpośredniego',
      sensitive: true,
    },
    {
      id: 'privacy',
      label: 'Prywatność danych',
      description: 'Obsługa zaakceptowanych żądań anonimizacji',
      icon: 'i-lucide-file-lock-2',
      granted: anonymizationActive,
      pending: anonymizationPending,
      source: anonymizationActive
        ? `Jednorazowy grant · ${anonymizationGrant.value?.requestNumber}`
        : anonymizationPending
          ? `Oczekuje na zatwierdzenie · ${anonymizationGrant.value?.requestNumber}`
          : 'Brak aktywnego grantu',
      highRisk: true,
    },
    {
      id: 'operations',
      label: 'Ustawienia operacyjne',
      description: 'Założenia zdolności i wspólne parametry usług',
      icon: 'i-lucide-sliders-horizontal',
      granted: organization || draft.roles.crm_config_admin,
      source: effectiveSource('crm_config_admin', 'Administrator ustawień operacyjnych'),
    },
    {
      id: 'audit',
      label: 'Audyt',
      description: 'Historia ról, wyjątków i zmian administracyjnych',
      icon: 'i-lucide-clipboard-list',
      granted: organization || draft.roles.access_admin,
      source: effectiveSource('access_admin', 'Administrator dostępów'),
    },
  ]
})

const grantedAreaCount = computed(() => effectiveAreas.value.filter(area => area.granted).length)
const consentExpiryLabel = computed(() =>
  draft.consentPublish ? formatExpiry(draft.consentExpiresAt) : '',
)
const anonymizationExpiryLabel = computed(() =>
  anonymizationGrant.value ? formatExpiry(anonymizationGrant.value.expiresAt, true) : '',
)
const anonymizationExpiryMin = computed(() => localDatetimeAfterHours(0))
const anonymizationExpiryMax = computed(() => localDatetimeAfterHours(24))

function summarizeNames(names: string[], visibleCount = 2) {
  if (!names.length) return ''
  const visible = names.slice(0, visibleCount).join(' · ')
  const remaining = names.length - visibleCount
  return remaining > 0 ? `${visible} · +${remaining}` : visible
}

function auditEventPresentation(eventType: string): {
  title: string
  tone: AuditEntryTone
  icon: string
} {
  const presentations: Record<string, {
    title: string
    tone: AuditEntryTone
    icon: string
  }> = {
    admin_access_updated: {
      title: 'Zmieniono dostęp administracyjny',
      tone: 'warning',
      icon: 'i-lucide-shield-check',
    },
    anonymization_grant_requested: {
      title: 'Wysłano grant anonimizacji do zatwierdzenia',
      tone: 'warning',
      icon: 'i-lucide-file-lock-2',
    },
    anonymization_grant_approved: {
      title: 'Zatwierdzono grant anonimizacji',
      tone: 'success',
      icon: 'i-lucide-user-round-check',
    },
    anonymization_grant_rejected: {
      title: 'Odrzucono grant anonimizacji',
      tone: 'error',
      icon: 'i-lucide-user-round-x',
    },
    anonymization_grant_revoked: {
      title: 'Cofnięto grant anonimizacji',
      tone: 'error',
      icon: 'i-lucide-undo-2',
    },
    anonymization_grant_consumed: {
      title: 'Wykorzystano grant anonimizacji',
      tone: 'neutral',
      icon: 'i-lucide-file-check-2',
    },
  }
  return presentations[eventType] ?? {
    title: 'Zarejestrowano zmianę administracyjną',
    tone: 'neutral',
    icon: 'i-lucide-history',
  }
}

function auditFieldLabel(field: string) {
  const labels: Record<string, string> = {
    roles: 'Role administracyjne',
    consentPublishingGrant: 'Publikowanie wersji zgód',
    status: 'Status grantu',
    expiresAt: 'Termin ważności',
    approverUserId: 'Osoba zatwierdzająca',
  }
  return labels[field] ?? field
}

function auditValueLabel(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    if (!value.length) return 'Brak'
    return value.map(item => String(item)).join(', ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.permissionKey === 'string') {
      return record.expiresAt
        ? `Aktywny do ${formatExpiry(String(record.expiresAt), true)}`
        : 'Aktywny'
    }
    return JSON.stringify(value)
  }
  const labels: Record<string, string> = {
    pending_approval: 'Oczekuje na zatwierdzenie',
    active: 'Aktywny',
    rejected: 'Odrzucony',
    revoked: 'Cofnięty',
    consumed: 'Wykorzystany',
    expired: 'Wygasły',
  }
  return labels[String(value)] ?? String(value)
}

function auditSourceLabel(source: string) {
  const labels: Record<string, string> = {
    admin_panel: 'Panel administracyjny',
    system: 'System IAM',
  }
  return labels[source] ?? source
}

function toAuditLogEntry(event: AdministrativeAuditEvent): AuditLogEntry {
  const presentation = auditEventPresentation(event.eventType)
  const primaryChange = event.changes[0]
  const actorName = event.actor.fullName || event.actor.email || 'System IAM'
  const compactId = event.id.replaceAll('-', '').slice(0, 8).toUpperCase()
  return {
    id: event.id,
    eventId: event.eventId ?? `IAM-${compactId}`,
    title: presentation.title,
    description: event.resourceLabel || 'Dostęp administracyjny użytkownika',
    field: auditFieldLabel(primaryChange?.field ?? event.resourceType),
    before: auditValueLabel(primaryChange?.before),
    after: auditValueLabel(primaryChange?.after),
    reason: event.reason ?? undefined,
    createdAt: new Date(event.createdAt),
    actor: {
      id: event.actor.userId ?? 'system-iam',
      name: actorName,
      role: event.actor.role || (event.actor.userId ? 'Administrator' : 'Automatyzacja'),
      email: event.actor.email ?? undefined,
      avatarUrl: event.actor.avatarUrl,
    },
    source: auditSourceLabel(event.source),
    tone: presentation.tone,
    icon: presentation.icon,
  }
}

function auditActorInitials(actor: AuditActor) {
  return actor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toLocaleUpperCase('pl'))
    .join('')
}

function formatAuditDate(value: Date) {
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
    timeZoneName: 'short',
  }).format(value)
}

async function loadMoreAuditEvents() {
  const cursor = administrativeAuditEvents.value.page.nextCursor
  if (!cursor || loadingMoreAuditEvents.value) return
  loadingMoreAuditEvents.value = true
  try {
    const nextPage = await $fetch<AdministrativeAuditEventsPayload>(
      orgApiPath(
        `/members/${userId.value}/admin-access/audit-events?limit=50&cursor=${encodeURIComponent(cursor)}`,
      ),
    )
    const existingIds = new Set(administrativeAuditEvents.value.data.map(event => event.id))
    administrativeAuditEvents.value = {
      data: [
        ...administrativeAuditEvents.value.data,
        ...nextPage.data.filter(event => !existingIds.has(event.id)),
      ],
      page: nextPage.page,
    }
  } catch (fetchError: unknown) {
    toast.add({
      title: 'Nie udało się pobrać kolejnych zdarzeń',
      description: apiErrorMessage(fetchError),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    loadingMoreAuditEvents.value = false
  }
}

function polishCount(count: number, singular: string, paucal: string, plural: string) {
  const absolute = Math.abs(count)
  const lastTwoDigits = absolute % 100
  const lastDigit = absolute % 10
  const noun = count === 1
    ? singular
    : lastTwoDigits >= 12 && lastTwoDigits <= 14
      ? plural
      : lastDigit >= 2 && lastDigit <= 4
        ? paucal
        : plural
  return `${count} ${noun}`
}

function formatExpiry(value: string, includeTime = false) {
  if (!value) return ''
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

useHead(() => ({ title: `${userName.value} — użytkownicy — OpenExpert CRM` }))

defineShortcuts({
  meta_s: () => {
    if (activeView.value === 'admin-access' && canEdit.value && hasUnsavedChanges.value) {
      void saveChanges()
    }
  },
})

function blankRoles(): Record<AdminRoleId, boolean> {
  return {
    organization_admin: false,
    access_admin: false,
    structure_admin: false,
    consents_admin: false,
    crm_config_admin: false,
  }
}

function blankAccessDraft(): AccessDraft {
  return {
    roles: blankRoles(),
    consentPublish: false,
    consentReason: '',
    consentExpiresAt: '',
  }
}

function dateInputValue(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function accessDraftFromState(access: AdministrativeAccessState): AccessDraft {
  const roles = blankRoles()
  for (const assignment of access.roles) {
    if (assignment.key in roles) roles[assignment.key] = true
  }
  const grant = access.consentPublishingGrant
  const grantIsActive = grant?.status === 'active'
    && new Date(grant.expiresAt).getTime() > Date.now()
  return {
    roles,
    consentPublish: Boolean(grantIsActive),
    consentReason: grantIsActive ? grant?.justification ?? '' : '',
    consentExpiresAt: grantIsActive ? dateInputValue(grant?.expiresAt ?? '') : '',
  }
}

function cloneDraft(value: AccessDraft): AccessDraft {
  return {
    roles: { ...value.roles },
    consentPublish: value.consentPublish,
    consentReason: value.consentReason,
    consentExpiresAt: value.consentExpiresAt,
  }
}

function applyDraft(value: AccessDraft) {
  Object.assign(draft.roles, value.roles)
  draft.consentPublish = value.consentPublish
  draft.consentReason = value.consentReason
  draft.consentExpiresAt = value.consentExpiresAt
}

function draftSignature(value: AccessDraft) {
  return JSON.stringify(value)
}

function effectiveSource(roleId: AdminRoleId, roleLabel: string) {
  if (roleId === 'consents_admin') {
    return draft.roles.consents_admin ? roleLabel : 'Brak przypisanej roli'
  }
  if (draft.roles.organization_admin) return 'Administrator organizacji'
  return draft.roles[roleId] ? roleLabel : 'Brak przypisanej roli'
}

function memberInitials(value: OrganizationMember | null) {
  const label = value?.fullName || value?.email || '?'
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toLocaleUpperCase('pl'))
    .join('')
}

const memberPresentation = computed(() => {
  const status = member.value?.status ?? 'active'
  return {
    status: status === 'inactive' ? 'Nieaktywny' : status === 'pending' ? 'Oczekuje' : 'Aktywny',
    statusColor: status === 'inactive'
      ? 'neutral' as const
      : status === 'pending'
        ? 'warning' as const
        : 'success' as const,
  }
})

function roleBadge(role: AdminRoleDefinition) {
  if (role.emphasis === 'highest') return { label: 'Najszerszy zakres', color: 'neutral' as const }
  return null
}

function teamKindLabel(kind: UserStructureTeamAssignment['team']['kind']) {
  if (kind === 'department') return 'Dział'
  if (kind === 'division') return 'Jednostka'
  if (kind === 'team') return 'Zespół'
  return 'Inny'
}

function facilityAssignmentAddress(facility: {
  address_line1: string | null
  postal_code: string | null
  city: string | null
}) {
  return [
    facility.address_line1,
    [facility.postal_code, facility.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ') || 'Brak adresu'
}

function openTeamAssignmentModal() {
  teamAssignmentForm.teamId = ''
  teamAssignmentForm.role = 'member'
  teamAssignmentModalOpen.value = true
}

function openFacilityAssignmentModal() {
  facilityAssignmentForm.facilityId = ''
  facilityAssignmentModalOpen.value = true
}

function askToRemoveStructureAssignment(kind: StructureAssignmentKind, id: string, name: string) {
  structureRemoval.value = { kind, id, name }
  structureRemovalModalOpen.value = true
}

function showStructureMutationError(title: string, mutationError: unknown) {
  toast.add({
    title,
    description: apiErrorMessage(mutationError),
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
}

function consentExceptionState(): ConsentExceptionSnapshot {
  return {
    consentPublish: draft.consentPublish,
    consentReason: draft.consentReason,
    consentExpiresAt: draft.consentExpiresAt,
  }
}

function applyConsentExceptionState(state: ConsentExceptionSnapshot) {
  draft.consentPublish = state.consentPublish
  draft.consentReason = state.consentReason
  draft.consentExpiresAt = state.consentExpiresAt
}

function openConsentExceptionModal() {
  consentExceptionSnapshot.value = consentExceptionState()
  showValidation.value = false
  exceptionModalOpen.value = true
}

function cancelConsentException() {
  if (consentExceptionSnapshot.value) {
    applyConsentExceptionState(consentExceptionSnapshot.value)
  }
  consentExceptionSnapshot.value = null
  showValidation.value = false
  exceptionModalOpen.value = false
}

function confirmConsentException() {
  if (!consentExceptionValid.value) return
  consentExceptionSnapshot.value = null
  showValidation.value = false
  exceptionModalOpen.value = false
}

function handleConsentExceptionModalOpen(open: boolean) {
  if (!open && consentExceptionSnapshot.value) cancelConsentException()
}

function resetExceptionFields(enabled: boolean | undefined) {
  if (enabled) {
    consentExceptionSnapshot.value = {
      consentPublish: false,
      consentReason: '',
      consentExpiresAt: '',
    }
    if (!draft.consentExpiresAt) {
      const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      draft.consentExpiresAt = defaultExpiry.toISOString().slice(0, 10)
    }
    showValidation.value = false
    exceptionModalOpen.value = true
    return
  }
  draft.consentReason = ''
  draft.consentExpiresAt = ''
  consentExceptionSnapshot.value = null
  exceptionModalOpen.value = false
  showValidation.value = false
}

function localDatetimeAfterHours(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function openAnonymizationGrantModal() {
  anonymizationGrantForm.requestId = ''
  anonymizationGrantForm.justification = ''
  anonymizationGrantForm.expiresAt = localDatetimeAfterHours(8)
  anonymizationGrantForm.approverId = ''
  anonymizationShowValidation.value = false
  anonymizationModalOpen.value = true
}

function mutationStatusCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const record = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
  }
  return record.statusCode ?? record.status ?? record.response?.status ?? null
}

function newIdempotencyKey() {
  return globalThis.crypto.randomUUID()
}

async function refreshAccessWorkspace() {
  await Promise.all([
    refreshAdministrativeAccess(),
    refreshAdministrativeAudit(),
    refreshAnonymizationGrants(),
  ])
}

async function refreshGrantWorkspace() {
  if (canReadAudit.value) {
    await Promise.all([
      refreshAnonymizationGrants(),
      refreshAdministrativeAudit(),
    ])
    return
  }
  await refreshAnonymizationGrants()
}

async function showAccessMutationError(title: string, mutationError: unknown) {
  const conflict = mutationStatusCode(mutationError) === 409
  if (conflict) await refreshAccessWorkspace()
  toast.add({
    title: conflict ? 'Dane zostały zmienione przez inną osobę' : title,
    description: conflict
      ? 'Pobrano najnowszy stan. Sprawdź go i ponów operację.'
      : apiErrorMessage(mutationError),
    color: 'error',
    icon: conflict ? 'i-lucide-refresh-cw' : 'i-lucide-circle-alert',
  })
}

async function submitAnonymizationGrant() {
  if (!canRequestPrivacyGrants.value || anonymizationActionKey.value) return
  anonymizationShowValidation.value = true
  if (!anonymizationGrantFormValid.value || !selectedAnonymizationRequest.value || !selectedAnonymizationApprover.value) {
    toast.add({
      title: 'Uzupełnij wniosek o dostęp',
      description: 'Wybierz potwierdzone żądanie, zatwierdzającego i ważność nie dłuższą niż 24 godziny.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
    return
  }

  anonymizationActionKey.value = 'create'
  try {
    await $fetch(
      orgApiPath(`/members/${userId.value}/admin-access/anonymization-grants`),
      {
        method: 'POST',
        body: {
          requestId: selectedAnonymizationRequest.value.value,
          approverUserId: selectedAnonymizationApprover.value.value,
          justification: anonymizationGrantForm.justification.trim(),
          expiresAt: new Date(anonymizationGrantForm.expiresAt).toISOString(),
          idempotencyKey: newIdempotencyKey(),
        },
      },
    )
    await refreshGrantWorkspace()
    anonymizationModalOpen.value = false
    anonymizationShowValidation.value = false
    toast.add({
      title: 'Wniosek przekazany do zatwierdzenia',
      description: 'Dostęp nie jest jeszcze aktywny. Zatwierdzająca osoba musi potwierdzić go przed wygaśnięciem.',
      color: 'success',
      icon: 'i-lucide-user-round-check',
    })
  } catch (mutationError: unknown) {
    await showAccessMutationError('Nie udało się nadać grantu', mutationError)
  } finally {
    anonymizationActionKey.value = ''
  }
}

function openAnonymizationAction(action: 'approve' | 'reject' | 'revoke') {
  anonymizationAction.value = action
  anonymizationActionReason.value = ''
  anonymizationActionShowValidation.value = false
  anonymizationActionModalOpen.value = true
}

async function submitAnonymizationAction() {
  const grant = anonymizationGrant.value
  const action = anonymizationAction.value
  if (!grant || !action || anonymizationActionKey.value) return
  if (action === 'revoke' && !canManageAccess.value) return
  if (action !== 'revoke' && !canApprovePrivacyGrants.value) return
  anonymizationActionShowValidation.value = true
  if (!anonymizationActionReasonValid.value) return

  anonymizationActionKey.value = action
  try {
    const basePath = `/members/${userId.value}/admin-access/anonymization-grants/${grant.id}`
    if (action === 'revoke') {
      await $fetch(orgApiPath(`${basePath}/revoke`), {
        method: 'POST',
        body: {
          expectedRevision: grant.revision,
          idempotencyKey: newIdempotencyKey(),
          reason: anonymizationActionReason.value.trim(),
        },
      })
    } else {
      await $fetch(orgApiPath(`${basePath}/response`), {
        method: 'PATCH',
        body: {
          action,
          expectedRevision: grant.revision,
          idempotencyKey: newIdempotencyKey(),
          reason: anonymizationActionReason.value.trim() || null,
        },
      })
    }
    await refreshGrantWorkspace()
    anonymizationActionModalOpen.value = false
    toast.add({
      title: action === 'approve'
        ? 'Grant został zatwierdzony'
        : action === 'reject'
          ? 'Grant został odrzucony'
          : 'Grant został cofnięty',
      color: action === 'approve' ? 'success' : 'neutral',
      icon: action === 'approve' ? 'i-lucide-user-round-check' : 'i-lucide-undo-2',
    })
  } catch (mutationError: unknown) {
    await showAccessMutationError(
      action === 'approve'
        ? 'Nie udało się zatwierdzić grantu'
        : action === 'reject'
          ? 'Nie udało się odrzucić grantu'
          : 'Nie udało się cofnąć grantu',
      mutationError,
    )
  } finally {
    anonymizationActionKey.value = ''
  }
}

async function addTeamAssignment() {
  if (!canManageStructure.value || !teamAssignmentForm.teamId || structureActionKey.value) return
  structureActionKey.value = 'team:add'
  const selectedTeam = structureAssignments.value.catalog.teams
    .find(team => team.id === teamAssignmentForm.teamId)
  try {
    await $fetch(orgApiPath('/team-memberships'), {
      method: 'POST',
      body: {
        team_id: teamAssignmentForm.teamId,
        user_id: userId.value,
        role: teamAssignmentForm.role,
      },
    })
    await Promise.all([
      refreshStructureAssignments(),
      refreshAdministrativeAudit(),
    ])
    teamAssignmentModalOpen.value = false
    toast.add({
      title: `Dodano ${userName.value} do zespołu`,
      description: selectedTeam?.name,
      color: 'success',
      icon: 'i-lucide-user-plus',
    })
  } catch (mutationError: unknown) {
    showStructureMutationError('Nie udało się dodać do zespołu', mutationError)
  } finally {
    structureActionKey.value = ''
  }
}

async function addFacilityAssignment() {
  if (!canManageStructure.value || !facilityAssignmentForm.facilityId || structureActionKey.value) return
  structureActionKey.value = 'facility:add'
  const selectedFacility = structureAssignments.value.catalog.facilities
    .find(facility => facility.id === facilityAssignmentForm.facilityId)
  try {
    await $fetch(orgApiPath(`/facilities/${facilityAssignmentForm.facilityId}/members`), {
      method: 'POST',
      body: {
        userId: userId.value,
        isBookable: false,
        bookingPriority: 100,
      },
    })
    await Promise.all([
      refreshStructureAssignments(),
      refreshAdministrativeAudit(),
    ])
    facilityAssignmentModalOpen.value = false
    toast.add({
      title: `Dodano ${userName.value} do placówki`,
      description: selectedFacility?.name,
      color: 'success',
      icon: 'i-lucide-building-2',
    })
  } catch (mutationError: unknown) {
    showStructureMutationError('Nie udało się dodać do placówki', mutationError)
  } finally {
    structureActionKey.value = ''
  }
}

async function updateTeamAssignmentRole(
  assignment: UserStructureTeamAssignment,
  role: unknown,
) {
  if (
    !canManageStructure.value
    || (role !== 'member' && role !== 'admin')
    || assignment.membership.role === role
    || structureActionKey.value
  ) return

  const actionKey = `team:role:${assignment.team.id}`
  structureActionKey.value = actionKey
  try {
    await $fetch(orgApiPath(`/team-memberships/${assignment.team.id}/${userId.value}`), {
      method: 'PATCH',
      body: { role },
    })
    await Promise.all([
      refreshStructureAssignments(),
      refreshAdministrativeAudit(),
    ])
    toast.add({
      title: 'Zmieniono rolę w zespole',
      description: assignment.team.name,
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  } catch (mutationError: unknown) {
    showStructureMutationError('Nie udało się zmienić roli w zespole', mutationError)
  } finally {
    if (structureActionKey.value === actionKey) structureActionKey.value = ''
  }
}

async function removeStructureAssignment() {
  const removal = structureRemoval.value
  if (!canManageStructure.value || !removal || structureActionKey.value) return
  const actionKey = `${removal.kind}:remove:${removal.id}`
  structureActionKey.value = actionKey
  try {
    if (removal.kind === 'team') {
      await $fetch(orgApiPath(`/team-memberships/${removal.id}/${userId.value}`), {
        method: 'DELETE',
      })
    } else {
      await $fetch(orgApiPath(`/facilities/${removal.id}/members/${userId.value}`), {
        method: 'DELETE',
      })
    }
    await Promise.all([
      refreshStructureAssignments(),
      refreshAdministrativeAudit(),
    ])
    structureRemovalModalOpen.value = false
    structureRemoval.value = null
    toast.add({
      title: removal.kind === 'team'
        ? 'Usunięto z zespołu'
        : 'Usunięto z placówki',
      description: removal.name,
      color: 'success',
      icon: 'i-lucide-user-minus',
    })
  } catch (mutationError: unknown) {
    showStructureMutationError('Nie udało się usunąć przypisania', mutationError)
  } finally {
    if (structureActionKey.value === actionKey) structureActionKey.value = ''
  }
}

async function saveChanges() {
  if (!canEdit.value || !hasUnsavedChanges.value || saving.value) return
  showValidation.value = true
  if (!consentExceptionValid.value) {
    exceptionModalOpen.value = true
    toast.add({
      title: 'Uzupełnij wyjątek publikowania zgód',
      description: 'Podaj uzasadnienie (minimum 10 znaków) i przyszłą datę wygaśnięcia.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
    return
  }

  saving.value = true
  try {
    const roles = roleDefinitions
      .filter(role => draft.roles[role.id])
      .map(role => role.id)
    const persistedConsentGrant = administrativeAccess.value?.consentPublishingGrant
    const consentExpiryWasUnchanged = persistedConsentGrant
      && dateInputValue(persistedConsentGrant.expiresAt) === draft.consentExpiresAt
    const consentPublishingGrant = draft.consentPublish
      ? {
          justification: draft.consentReason.trim(),
          expiresAt: consentExpiryWasUnchanged
            ? persistedConsentGrant.expiresAt
            : new Date(`${draft.consentExpiresAt}T23:59:59`).toISOString(),
        }
      : null
    await $fetch(orgApiPath(`/members/${userId.value}/admin-access`), {
      method: 'PUT',
      body: {
        expectedRevision: savedAccessRevision.value,
        idempotencyKey: newIdempotencyKey(),
        roles,
        consentPublishingGrant,
        changeReason: draft.consentPublish
          ? draft.consentReason.trim()
          : 'Aktualizacja zakresu dostępu administracyjnego.',
      },
    })
    await refreshAccessWorkspace()
    showValidation.value = false
    toast.add({
      title: 'Dostęp został zapisany',
      description: 'Zmiany zapisano w systemie dostępów i niezmiennym dzienniku audytu.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  } catch (mutationError: unknown) {
    await showAccessMutationError('Nie udało się zapisać dostępu', mutationError)
  } finally {
    saving.value = false
  }
}

function discardChanges() {
  applyDraft(savedDraft.value)
  exceptionModalOpen.value = false
  anonymizationModalOpen.value = false
  showValidation.value = false
  toast.add({
    title: 'Odrzucono niezapisane zmiany',
    color: 'neutral',
    icon: 'i-lucide-undo-2',
  })
}

onBeforeRouteLeave(() => {
  if (!import.meta.client || !hasUnsavedChanges.value) return true
  return window.confirm('Masz niezapisane zmiany dostępów. Czy na pewno chcesz opuścić ten widok?')
})

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))

</script>

<template>
  <CrmShell
    :title="userName"
    :back-to="orgPath('/users')"
    back-label="Wróć do użytkowników"
    :avatar-src="member?.avatarUrl || undefined"
    :avatar-alt="userName"
    :avatar-text="member ? memberInitials(member) : undefined"
    :tabs="member ? tabs : []"
  >
    <template v-if="member" #meta>
      <div class="user-meta">
        <span>{{ member.email }}</span>
        <span aria-hidden="true">·</span>
        <span>Status zatrudnienia:</span>
        <UBadge :color="memberPresentation.statusColor" variant="subtle">
          {{ memberPresentation.status }}
        </UBadge>
        <UBadge v-if="isCurrentUser" color="neutral" variant="outline">
          To Ty
        </UBadge>
      </div>
    </template>

    <div v-if="status === 'pending'" class="access-loading" aria-label="Ładowanie użytkownika">
      <USkeleton class="h-24 w-full" />
      <div class="access-loading__grid">
        <USkeleton class="h-96 w-full" />
        <USkeleton class="h-96 w-full" />
      </div>
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać użytkownika"
      :description="apiErrorMessage(error)"
      :actions="[
        { label: 'Ponów', onClick: () => refresh() },
        { label: 'Wróć do użytkowników', to: orgPath('/users'), color: 'neutral', variant: 'ghost' },
      ]"
    />

    <UAlert
      v-else-if="!member"
      color="warning"
      variant="subtle"
      icon="i-lucide-user-round-x"
      title="Nie znaleziono użytkownika"
      description="Użytkownik nie istnieje albo nie należy już do tej organizacji."
      :actions="[{ label: 'Wróć do użytkowników', to: orgPath('/users') }]"
    />

    <template v-else>
      <UAlert
        v-if="!canEdit"
        class="read-only-alert"
        :color="isApprovalOnly ? 'neutral' : 'warning'"
        variant="subtle"
        icon="i-lucide-lock-keyhole"
        :title="isApprovalOnly
          ? 'Dostęp ograniczony do zatwierdzania grantów'
          : 'Brak dostępu do administracji użytkownikami'"
        :description="isApprovalOnly
          ? 'Możesz rozpatrzyć wskazany grant anonimizacji, ale nie możesz zmieniać ról, struktury ani przeglądać audytu użytkownika.'
          : 'Ten widok jest dostępny wyłącznie dla osób zarządzających dostępami administracyjnymi.'"
      />

      <section
        v-if="isApprovalOnly && activeView === 'admin-access'"
        class="admin-access"
      >
        <section
          class="access-section access-tier access-tier--high-risk approval-only-panel"
          aria-labelledby="approval-only-title"
        >
          <div class="access-tier__heading">
            <span class="access-tier__icon"><UIcon name="i-lucide-shield-x" /></span>
            <div>
              <span class="section-eyebrow">Dostęp wysokiego ryzyka</span>
              <h2 id="approval-only-title">Zatwierdzenie grantu anonimizacji</h2>
              <p>Zweryfikuj żądanie, odbiorcę i termin przed podjęciem decyzji.</p>
            </div>
            <UBadge color="error" variant="subtle">
              Zasada dwóch par oczu
            </UBadge>
          </div>

          <div
            v-if="anonymizationGrantsStatus === 'pending' || anonymizationGrantsStatus === 'idle'"
            class="access-loading approval-only-panel__body"
            aria-label="Ładowanie grantu do zatwierdzenia"
          >
            <USkeleton class="h-32 w-full" />
          </div>
          <UAlert
            v-else-if="anonymizationGrantsError"
            class="approval-only-panel__body"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się pobrać grantu"
            :description="apiErrorMessage(anonymizationGrantsError)"
            :actions="[{ label: 'Ponów', onClick: () => refreshAnonymizationGrants() }]"
          />
          <article
            v-else-if="anonymizationGrant && canRespondToAnonymizationGrant"
            class="risk-access-row risk-access-row--anonymization"
          >
            <span class="risk-access-row__icon"><UIcon name="i-lucide-file-lock-2" /></span>
            <div class="risk-access-row__copy">
              <div class="risk-access-row__title">
                <h3>{{ anonymizationGrant.requestNumber }}</h3>
                <UBadge color="warning" variant="subtle" size="sm" icon="i-lucide-clock-3">
                  Oczekuje na decyzję
                </UBadge>
              </div>
              <p>{{ anonymizationGrant.clientReference }}</p>
              <div class="risk-access-row__rules">
                <span><UIcon name="i-lucide-clock-3" /> Ważne do {{ anonymizationExpiryLabel }}</span>
                <span><UIcon name="i-lucide-user-check" /> Odbiorca: {{ userName }}</span>
                <span><UIcon name="i-lucide-badge-check" /> Jedna operacja</span>
              </div>
            </div>
            <div class="risk-access-row__grant">
              <small>Uzasadnienie administratora</small>
              <p>{{ anonymizationGrant.justification }}</p>
              <div class="risk-access-row__actions">
                <UButton
                  color="success"
                  variant="soft"
                  icon="i-lucide-user-round-check"
                  :disabled="Boolean(anonymizationActionKey)"
                  @click="openAnonymizationAction('approve')"
                >
                  Zatwierdź
                </UButton>
                <UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-user-round-x"
                  :disabled="Boolean(anonymizationActionKey)"
                  @click="openAnonymizationAction('reject')"
                >
                  Odrzuć
                </UButton>
              </div>
            </div>
          </article>
          <div v-else class="history-empty approval-only-panel__body">
            <span><UIcon name="i-lucide-circle-check" /></span>
            <h3>Brak decyzji do podjęcia</h3>
            <p>Nie masz oczekującego grantu dla tego użytkownika.</p>
          </div>
        </section>
      </section>

      <section v-else-if="canEdit && activeView === 'admin-access'" class="admin-access">
        <div
          v-if="administrativeAccessStatus === 'pending' || administrativeAccessStatus === 'idle'"
          class="access-loading"
          aria-label="Ładowanie dostępu administracyjnego"
        >
          <USkeleton class="h-64 w-full" />
          <USkeleton class="h-64 w-full" />
        </div>
        <UAlert
          v-else-if="administrativeAccessError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać dostępu administracyjnego"
          :description="apiErrorMessage(administrativeAccessError)"
          :actions="[{ label: 'Ponów', onClick: () => refreshAdministrativeAccess() }]"
        />
        <div v-else class="access-workspace">
          <div class="access-editor">
            <section class="access-section access-section--roles" aria-labelledby="role-section-title">
              <div class="access-panel-heading">
                <div>
                  <h2 id="role-section-title">Role administracyjne</h2>
                  <p>Stałe role do zarządzania organizacją, dostępami i strukturą.</p>
                </div>
                <span>{{ standardActiveRoleCount }} z {{ standardRoleDefinitions.length }}</span>
              </div>

              <div class="role-list__head" aria-hidden="true">
                <span>Rola</span>
                <span>Przypisanie</span>
                <span>Pochodzenie</span>
              </div>

              <div class="role-list">
                <article
                  v-for="role in standardRoleDefinitions"
                  :key="role.id"
                  class="role-row"
                  :class="{ 'role-row--selected': draft.roles[role.id] }"
                >
                  <span class="role-row__icon"><UIcon :name="role.icon" /></span>
                  <div class="role-row__copy">
                    <div class="role-row__title">
                      <h3>{{ role.label }}</h3>
                      <UBadge
                        v-if="roleBadge(role)"
                        :color="roleBadge(role)?.color"
                        variant="subtle"
                      >
                        {{ roleBadge(role)?.label }}
                      </UBadge>
                    </div>
                    <p>{{ role.description }}</p>
                  </div>
                  <label class="role-row__assignment">
                    <UCheckbox
                      v-model="draft.roles[role.id]"
                      :disabled="!canEdit"
                      size="lg"
                      :aria-label="`Przypisz rolę: ${role.label}`"
                    />
                    <span>{{ draft.roles[role.id] ? 'Przypisana' : 'Nieprzypisana' }}</span>
                  </label>
                  <span class="role-row__origin">
                    {{ draft.roles[role.id] ? 'Bezpośrednio' : '—' }}
                  </span>
                </article>
              </div>
            </section>

            <section class="access-section access-tier access-tier--sensitive" aria-labelledby="sensitive-access-title">
              <div class="access-tier__heading">
                <span class="access-tier__icon"><UIcon name="i-lucide-shield-alert" /></span>
                <div>
                  <span class="section-eyebrow">Dostęp wrażliwy</span>
                  <h2 id="sensitive-access-title">Zgody i compliance</h2>
                  <p>Stały dostęp do tworzenia i edycji roboczych definicji zgód.</p>
                </div>
                <UBadge color="warning" variant="subtle">
                  {{ draft.roles.consents_admin ? 'Rola przypisana' : 'Brak roli' }}
                </UBadge>
              </div>

              <article
                class="access-tier-row access-tier-row--sensitive"
                :class="{ 'access-tier-row--selected': draft.roles.consents_admin }"
              >
                <span class="access-tier-row__icon"><UIcon :name="sensitiveRoleDefinition.icon" /></span>
                <div class="access-tier-row__copy">
                  <h3>{{ sensitiveRoleDefinition.label }}</h3>
                  <p>Tworzy i edytuje wersje robocze zgód. Nie może ich publikować.</p>
                  <div class="access-tier-row__scope" aria-label="Zakres roli Administrator zgód">
                    <span v-for="permission in sensitiveRoleDefinition.permissions" :key="permission">
                      <UIcon name="i-lucide-check" />
                      {{ permission }}
                    </span>
                  </div>
                </div>
                <label class="access-tier-row__assignment">
                  <UCheckbox
                    v-model="draft.roles.consents_admin"
                    :disabled="!canEdit"
                    size="lg"
                    aria-label="Przypisz rolę: Administrator zgód"
                  />
                  <span>{{ draft.roles.consents_admin ? 'Przypisana' : 'Nieprzypisana' }}</span>
                </label>
                <small class="access-tier-row__origin">
                  {{ draft.roles.consents_admin ? 'Pochodzenie: bezpośrednio' : 'Brak przypisania' }}
                </small>
              </article>
            </section>

            <section class="access-section access-tier access-tier--high-risk" aria-labelledby="high-risk-access-title">
              <div class="access-tier__heading">
                <span class="access-tier__icon"><UIcon name="i-lucide-shield-x" /></span>
                <div>
                  <span class="section-eyebrow">Dostęp wysokiego ryzyka</span>
                  <h2 id="high-risk-access-title">Operacje kontrolowane</h2>
                  <p>Wyłącznie bezpośrednie, ograniczone czasowo lub do konkretnego żądania.</p>
                </div>
                <UBadge color="error" variant="subtle">
                  {{ directAccessCount
                    ? directAccessCount === 1 ? '1 nadanie' : `${directAccessCount} nadania`
                    : 'Brak nadań'
                  }}
                </UBadge>
              </div>

              <div class="risk-access-list">
                <article class="risk-access-row">
                  <span class="risk-access-row__icon"><UIcon name="i-lucide-send" /></span>
                  <div class="risk-access-row__copy">
                    <div class="risk-access-row__title">
                      <h3>Publikowanie wersji zgód</h3>
                      <UBadge color="error" variant="subtle" size="sm">
                        Publikacja
                      </UBadge>
                    </div>
                    <p>Czasowy wyjątek bezpośredni, niezależny od roli Administrator zgód.</p>
                    <div class="risk-access-row__rules">
                      <span><UIcon name="i-lucide-user-check" /> Tylko bezpośrednio</span>
                      <span><UIcon name="i-lucide-clock-3" /> Wygasa automatycznie</span>
                      <span><UIcon name="i-lucide-clipboard-list" /> Pełny ślad audytowy</span>
                    </div>
                  </div>
                  <div class="risk-access-row__control">
                    <div class="risk-access-row__switch">
                      <span>{{ draft.consentPublish ? 'Dostęp aktywny' : 'Brak dostępu' }}</span>
                      <USwitch
                        v-model="draft.consentPublish"
                        :disabled="!canEdit"
                        size="lg"
                        aria-label="Nadaj bezpośrednie uprawnienie do publikowania zgód"
                        @update:model-value="resetExceptionFields"
                      />
                    </div>
                    <template v-if="draft.consentPublish">
                      <small>Ważne do {{ consentExpiryLabel }}</small>
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-pencil-line"
                        @click="openConsentExceptionModal"
                      >
                        Edytuj warunki
                      </UButton>
                    </template>
                    <small v-else>Nie wynika z żadnej roli.</small>
                  </div>
                </article>

                <article class="risk-access-row risk-access-row--anonymization">
                  <span class="risk-access-row__icon"><UIcon name="i-lucide-file-lock-2" /></span>
                  <div class="risk-access-row__copy">
                    <div class="risk-access-row__title">
                      <h3>Anonimizacja danych klienta</h3>
                      <UBadge color="error" variant="subtle" size="sm" icon="i-lucide-triangle-alert">
                        Nieodwracalne
                      </UBadge>
                    </div>
                    <p>Jednorazowy grant do konkretnego klienta i zatwierdzonego żądania.</p>
                    <div class="risk-access-row__rules">
                      <span><UIcon name="i-lucide-clock-3" /> Maks. 24 godziny</span>
                      <span><UIcon name="i-lucide-badge-check" /> Jedna operacja</span>
                      <span><UIcon name="i-lucide-users" /> Zatwierdza druga osoba</span>
                    </div>
                  </div>

                  <div
                    v-if="anonymizationGrantsStatus === 'pending' || anonymizationGrantsStatus === 'idle'"
                    class="risk-access-row__control risk-access-row__control--grant-empty"
                    aria-label="Ładowanie grantów anonimizacji"
                  >
                    <USkeleton class="h-20 w-full" />
                  </div>
                  <div
                    v-else-if="anonymizationGrantsError"
                    class="risk-access-row__control risk-access-row__control--grant-empty"
                  >
                    <UButton
                      color="error"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-refresh-cw"
                      @click="() => refreshAnonymizationGrants()"
                    >
                      Ponów pobieranie
                    </UButton>
                  </div>
                  <div v-else-if="anonymizationGrant" class="risk-access-row__grant">
                    <div class="risk-access-row__grant-heading">
                      <UBadge
                        :color="anonymizationGrant.status === 'active' ? 'success' : 'warning'"
                        variant="subtle"
                        :icon="anonymizationGrant.status === 'active'
                          ? 'i-lucide-circle-check'
                          : 'i-lucide-clock-3'"
                      >
                        {{ anonymizationGrant.status === 'active' ? 'Aktywny' : 'Oczekuje' }}
                      </UBadge>
                      <code>{{ anonymizationGrant.requestNumber }}</code>
                    </div>
                    <strong>{{ anonymizationGrant.clientReference }}</strong>
                    <small>Ważne do {{ anonymizationExpiryLabel }}</small>
                    <div class="risk-access-row__actions">
                      <UButton
                        v-if="canRespondToAnonymizationGrant"
                        color="success"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-user-round-check"
                        :disabled="Boolean(anonymizationActionKey)"
                        @click="openAnonymizationAction('approve')"
                      >
                        Zatwierdź
                      </UButton>
                      <UButton
                        v-if="canRespondToAnonymizationGrant"
                        color="error"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-user-round-x"
                        :disabled="Boolean(anonymizationActionKey)"
                        @click="openAnonymizationAction('reject')"
                      >
                        Odrzuć
                      </UButton>
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-undo-2"
                        :disabled="Boolean(anonymizationActionKey)"
                        @click="openAnonymizationAction('revoke')"
                      >
                        Cofnij
                      </UButton>
                    </div>
                  </div>
                  <div v-else class="risk-access-row__control risk-access-row__control--grant-empty">
                    <div class="grant-empty-state">
                      <div class="grant-empty-state__copy">
                        <strong>
                          <UIcon name="i-lucide-circle-minus" />
                          Brak grantu
                        </strong>
                      </div>
                      <UButton
                        class="grant-empty-state__button"
                        color="error"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-plus"
                        :disabled="!canRequestPrivacyGrants || Boolean(anonymizationActionKey)"
                        @click="openAnonymizationGrantModal"
                      >
                        Nadaj grant
                      </UButton>
                    </div>
                  </div>
                </article>
              </div>
            </section>
          </div>

          <div class="access-side">
            <aside class="effective-panel" aria-labelledby="effective-access-title">
              <div class="effective-panel__heading">
                <div>
                  <h2 id="effective-access-title">Efektywny dostęp</h2>
                  <p>Wynik ról stałych oraz dostępów bezpośrednich.</p>
                </div>
                <span class="effective-panel__score">{{ grantedAreaCount }}/{{ effectiveAreas.length }}</span>
              </div>

              <div class="effective-list">
                <article
                  v-for="area in effectiveAreas"
                  :key="area.id"
                  :class="{
                    'effective-item--granted': area.granted,
                    'effective-item--pending': area.pending,
                    'effective-item--sensitive': area.sensitive,
                    'effective-item--high-risk': area.highRisk,
                  }"
                >
                  <span class="effective-item__icon"><UIcon :name="area.icon" /></span>
                  <div>
                    <div class="effective-item__title">
                      <strong>{{ area.label }}</strong>
                      <UIcon
                        :name="area.pending
                          ? 'i-lucide-clock-3'
                          : area.granted
                            ? 'i-lucide-circle-check'
                            : 'i-lucide-circle-minus'"
                        :aria-label="area.pending
                          ? 'Oczekuje na zatwierdzenie'
                          : area.granted
                            ? 'Dostęp przyznany'
                            : 'Brak dostępu'"
                      />
                    </div>
                    <p>{{ area.description }}</p>
                    <small>
                      <UIcon
                        :name="area.pending
                          ? 'i-lucide-clock-3'
                          : area.granted
                            ? 'i-lucide-git-branch'
                            : 'i-lucide-ban'"
                      />
                      {{ area.source }}
                    </small>
                  </div>
                </article>
              </div>
            </aside>
          </div>
        </div>

        <Transition name="save-bar">
          <div v-if="hasUnsavedChanges" class="save-bar" role="status" aria-live="polite">
            <div>
              <span><UIcon name="i-lucide-circle-dot-dashed" /></span>
              <div>
                <strong>Masz niezapisane zmiany</strong>
                <small>Zapisz lub odrzuć wprowadzone zmiany.</small>
              </div>
            </div>
            <div class="save-bar__actions">
              <UButton
                color="neutral"
                variant="outline"
                :disabled="saving"
                @click="discardChanges"
              >
                Odrzuć
              </UButton>
              <UButton
                icon="i-lucide-save"
                :loading="saving"
                :disabled="!canEdit"
                @click="saveChanges"
              >
                Zapisz zmiany
              </UButton>
            </div>
          </div>
        </Transition>
      </section>

      <section v-else-if="canEdit && activeView === 'overview'" class="secondary-view">
        <UAlert
          v-if="administrativeAccessError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać bieżących dostępów"
          :description="apiErrorMessage(administrativeAccessError)"
          :actions="[{ label: 'Ponów', onClick: () => refreshAdministrativeAccess() }]"
        />
        <div class="overview-grid">
          <article>
            <span><UIcon name="i-lucide-shield-check" /></span>
            <div class="overview-grid__copy">
              <small>Role administracyjne</small>
              <p>{{ grantedAreaCount }} dostępnych obszarów</p>
            </div>
            <strong>{{ activeRoleCount }}</strong>
          </article>
          <article>
            <span><UIcon name="i-lucide-key-round" /></span>
            <div class="overview-grid__copy">
              <small>Dostępy bezpośrednie</small>
              <p v-if="pendingDirectAccessCount">{{ pendingDirectAccessCount }} oczekuje na zatwierdzenie</p>
              <p v-else>{{ activeDirectAccessCount ? 'aktywne i ograniczone czasowo' : 'brak aktywnych dostępów' }}</p>
            </div>
            <strong>{{ directAccessCount }}</strong>
          </article>
          <article>
            <span><UIcon name="i-lucide-history" /></span>
            <div class="overview-grid__copy">
              <small>Ostatnia zmiana</small>
              <p>{{ latestAuditSummary }}</p>
            </div>
            <strong>{{ latestAuditDateLabel }}</strong>
          </article>
        </div>

        <div class="overview-detail-grid">
          <UCard class="overview-panel">
            <template #header>
              <div class="simple-card-heading">
                <div>
                  <span class="section-eyebrow">Najważniejsze</span>
                  <h3>Aktualny zakres administracyjny</h3>
                </div>
                <UButton
                  :to="{ path: route.path }"
                  color="neutral"
                  variant="outline"
                  trailing-icon="i-lucide-arrow-right"
                >
                  Zarządzaj
                </UButton>
              </div>
            </template>
            <div class="overview-access-list">
              <div v-for="area in effectiveAreas.filter(item => item.granted)" :key="area.id">
                <UIcon :name="area.icon" />
                <span>{{ area.label }}</span>
                <small>{{ area.source }}</small>
              </div>
            </div>
          </UCard>

          <UCard class="overview-panel">
            <template #header>
              <div class="simple-card-heading">
                <div>
                  <span class="section-eyebrow">Struktura</span>
                  <h3>Zespoły i placówki</h3>
                </div>
                <UButton
                  :to="{ path: route.path, query: { view: 'teams' } }"
                  color="neutral"
                  variant="outline"
                  trailing-icon="i-lucide-arrow-right"
                >
                  Przypisania
                </UButton>
              </div>
            </template>

            <div
              v-if="structureStatus === 'pending' || structureStatus === 'idle'"
              class="overview-structure-loading"
              aria-label="Ładowanie przypisań struktury"
            >
              <USkeleton class="h-14 w-full" />
              <USkeleton class="h-14 w-full" />
            </div>
            <div v-else-if="structureError" class="overview-structure-error">
              <UIcon name="i-lucide-circle-alert" />
              <p>Nie udało się pobrać przypisań struktury.</p>
            </div>
            <div v-else class="overview-structure-list">
              <article>
                <span><UIcon name="i-lucide-users-round" /></span>
                <div>
                  <strong>{{ teamAssignmentCountLabel }}</strong>
                  <p>{{ teamOverviewNames || 'Brak przypisanych zespołów' }}</p>
                </div>
                <small>
                  {{ teamAdminAssignmentCount
                    ? `${teamAdminAssignmentCount} z rolą administratora`
                    : 'Bez roli administratora'
                  }}
                </small>
              </article>
              <article>
                <span><UIcon name="i-lucide-building-2" /></span>
                <div>
                  <strong>{{ facilityAssignmentCountLabel }}</strong>
                  <p>{{ facilityOverviewNames || 'Brak przypisanych placówek' }}</p>
                </div>
                <small>
                  {{ facilityAdminAssignmentCount
                    ? `${facilityAdminAssignmentCount} z rolą administratora`
                    : 'Przypisanie bezpośrednie'
                  }}
                </small>
              </article>
            </div>
          </UCard>

          <UCard class="overview-panel overview-panel--audit">
            <template #header>
              <div class="simple-card-heading">
                <div>
                  <span class="section-eyebrow">Audyt dostępu</span>
                  <h3>5 ostatnich zmian</h3>
                </div>
                <div class="audit-heading-actions">
                  <UBadge color="neutral" variant="subtle" icon="i-lucide-lock-keyhole">
                    Tylko do odczytu
                  </UBadge>
                  <UButton
                    :to="{ path: route.path, query: { view: 'history' } }"
                    color="neutral"
                    variant="outline"
                    trailing-icon="i-lucide-arrow-right"
                  >
                    Pełna historia
                  </UButton>
                </div>
              </div>
            </template>

            <div
              v-if="administrativeAuditStatus === 'pending' || administrativeAuditStatus === 'idle'"
              class="overview-structure-loading"
              aria-label="Ładowanie ostatnich zmian"
            >
              <USkeleton class="h-20 w-full" />
              <USkeleton class="h-20 w-full" />
            </div>
            <UAlert
              v-else-if="administrativeAuditError"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="Nie udało się pobrać historii zmian"
              :description="apiErrorMessage(administrativeAuditError)"
              :actions="[{ label: 'Ponów', onClick: () => refreshAdministrativeAudit() }]"
            />
            <div v-else-if="latestAuditEntries.length" class="audit-log-list audit-log-list--preview">
              <div class="audit-log-list__head" aria-hidden="true">
                <span />
                <span>Zmiana</span>
                <span>Wprowadzona przez</span>
                <span>Data i źródło</span>
              </div>
              <article v-for="entry in latestAuditEntries" :key="entry.id" class="audit-log-row">
                <span :class="['audit-log-row__icon', `audit-log-row__icon--${entry.tone}`]">
                  <UIcon :name="entry.icon" />
                </span>
                <div class="audit-log-row__content">
                  <strong>{{ entry.title }}</strong>
                  <p>{{ entry.description }}</p>
                  <div class="audit-log-row__diff">
                    <small>{{ entry.field }}</small>
                    <span v-if="entry.before">{{ entry.before }}</span>
                    <UIcon v-if="entry.before && entry.after" name="i-lucide-arrow-right" />
                    <span v-if="entry.after" class="audit-log-row__after">{{ entry.after }}</span>
                  </div>
                </div>
                <div class="audit-log-row__actor">
                  <UAvatar
                    :src="entry.actor.avatarUrl || undefined"
                    :alt="entry.actor.name"
                    :text="auditActorInitials(entry.actor)"
                    size="xs"
                  />
                  <div>
                    <strong>{{ entry.actor.name }}</strong>
                    <small>{{ entry.actor.role }}</small>
                  </div>
                </div>
                <div class="audit-log-row__meta">
                  <time :datetime="entry.createdAt.toISOString()">
                    {{ formatAuditDate(entry.createdAt) }}
                  </time>
                  <small>{{ entry.eventId }} · {{ entry.source }}</small>
                </div>
              </article>
            </div>
            <div v-else class="history-empty">
              <span><UIcon name="i-lucide-history" /></span>
              <h3>Brak zdarzeń audytowych</h3>
              <p>Pierwsza zarejestrowana zmiana pojawi się tutaj.</p>
            </div>
          </UCard>
        </div>
      </section>

      <section v-else-if="canEdit && activeView === 'teams'" class="secondary-view">
        <div class="secondary-view__intro">
          <span class="section-eyebrow">Struktura organizacji</span>
          <h2>Przypisania do zespołów i placówek</h2>
          <p>
            Poniżej znajdują się bezpośrednie członkostwa użytkownika: {{ userName }}.
            Uprawnienia eksperckie i produktowe będą zarządzane oddzielnie w module akredytacji.
          </p>
        </div>

        <UAlert
          v-if="!canManageStructure"
          color="neutral"
          variant="subtle"
          icon="i-lucide-eye"
          title="Przypisania tylko do odczytu"
          description="Zarządzanie zespołami i placówkami wymaga roli Administrator struktury."
        />

        <div
          v-if="structureStatus === 'pending' || structureStatus === 'idle'"
          class="membership-grid membership-grid--loading"
          aria-label="Ładowanie przypisań"
        >
          <div v-for="index in 2" :key="index" class="membership-panel">
            <USkeleton class="h-12 w-full" />
            <USkeleton class="h-16 w-full" />
            <USkeleton class="h-16 w-full" />
          </div>
        </div>

        <UAlert
          v-else-if="structureError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać przypisań"
          :description="apiErrorMessage(structureError)"
          :actions="[{ label: 'Ponów', onClick: () => refreshStructureAssignments() }]"
        />

        <div v-else class="membership-grid">
          <section class="membership-panel" aria-labelledby="team-memberships-title">
            <header class="membership-panel__header">
              <div class="membership-panel__title">
                <span><UIcon name="i-lucide-users-round" /></span>
                <div>
                  <h3 id="team-memberships-title">Zespoły</h3>
                  <p>{{ teamAssignmentCountLabel }} · przypisania bezpośrednie</p>
                </div>
              </div>
              <UButton
                v-if="canManageStructure"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-plus"
                :disabled="!canManageStructure || !availableTeamItems.length"
                @click="openTeamAssignmentModal"
              >
                Dodaj
              </UButton>
            </header>

            <div v-if="teamAssignments.length" class="membership-list">
              <article
                v-for="assignment in teamAssignments"
                :key="assignment.team.id"
                class="membership-row"
              >
                <span class="membership-row__icon">
                  <UIcon name="i-lucide-users-round" />
                </span>
                <div class="membership-row__copy">
                  <NuxtLink :to="orgPath(`/teams/${assignment.team.id}`)">
                    {{ assignment.team.name }}
                  </NuxtLink>
                  <p>{{ teamKindLabel(assignment.team.kind) }} · przypisanie bezpośrednie</p>
                </div>
                <div class="membership-row__role">
                  <USelect
                    v-if="canManageStructure"
                    :model-value="assignment.membership.role"
                    class="w-full"
                    :items="teamMembershipRoleItems"
                    value-key="value"
                    label-key="label"
                    size="sm"
                    :disabled="!canManageStructure || Boolean(structureActionKey)"
                    :aria-label="`Rola ${userName} w zespole ${assignment.team.name}`"
                    @update:model-value="updateTeamAssignmentRole(assignment, $event)"
                  />
                  <UBadge v-else color="neutral" variant="subtle">
                    {{ assignment.membership.role === 'admin' ? 'Administrator' : 'Członek' }}
                  </UBadge>
                </div>
                <UButton
                  v-if="canManageStructure"
                  class="membership-row__remove"
                  color="error"
                  variant="ghost"
                  square
                  size="sm"
                  icon="i-lucide-user-minus"
                  :disabled="!canManageStructure || Boolean(structureActionKey)"
                  :aria-label="`Usuń ${userName} z zespołu ${assignment.team.name}`"
                  @click="askToRemoveStructureAssignment('team', assignment.team.id, assignment.team.name)"
                />
              </article>
            </div>

            <div v-else class="membership-empty">
              <span><UIcon name="i-lucide-users-round" /></span>
              <h4>Brak przypisanych zespołów</h4>
              <p>{{ userName }} nie należy obecnie do żadnego zespołu.</p>
              <UButton
                v-if="canManageStructure"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-user-plus"
                :disabled="!canManageStructure || !availableTeamItems.length"
                @click="openTeamAssignmentModal"
              >
                Dodaj do zespołu
              </UButton>
            </div>

            <UButton
              class="membership-panel__footer"
              :to="orgPath('/teams')"
              color="neutral"
              variant="link"
              trailing-icon="i-lucide-arrow-right"
            >
              Zarządzaj wszystkimi zespołami
            </UButton>
          </section>

          <section class="membership-panel" aria-labelledby="facility-memberships-title">
            <header class="membership-panel__header">
              <div class="membership-panel__title">
                <span><UIcon name="i-lucide-building-2" /></span>
                <div>
                  <h3 id="facility-memberships-title">Placówki</h3>
                  <p>{{ facilityAssignmentCountLabel }} · przypisania bezpośrednie</p>
                </div>
              </div>
              <UButton
                v-if="canManageStructure"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-plus"
                :disabled="!canManageStructure || !availableFacilityItems.length"
                @click="openFacilityAssignmentModal"
              >
                Dodaj
              </UButton>
            </header>

            <div v-if="facilityAssignments.length" class="membership-list">
              <article
                v-for="assignment in facilityAssignments"
                :key="assignment.facility.id"
                class="membership-row"
              >
                <span class="membership-row__icon">
                  <UIcon name="i-lucide-building-2" />
                </span>
                <div class="membership-row__copy">
                  <div class="membership-row__name">
                    <NuxtLink :to="orgPath(`/facilities/${assignment.facility.id}`)">
                      {{ assignment.facility.name }}
                    </NuxtLink>
                    <UBadge
                      v-if="!assignment.facility.is_active"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                    >
                      Nieaktywna
                    </UBadge>
                  </div>
                  <p>{{ facilityAssignmentAddress(assignment.facility) }}</p>
                </div>
                <div class="membership-row__badge">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-map-pin"
                  >
                    {{ assignment.membership.role === 'admin'
                      ? 'Administrator placówki'
                      : 'Członek placówki'
                    }}
                  </UBadge>
                </div>
                <UButton
                  v-if="canManageStructure"
                  class="membership-row__remove"
                  color="error"
                  variant="ghost"
                  square
                  size="sm"
                  icon="i-lucide-user-minus"
                  :disabled="!canManageStructure || Boolean(structureActionKey)"
                  :aria-label="`Usuń ${userName} z placówki ${assignment.facility.name}`"
                  @click="askToRemoveStructureAssignment('facility', assignment.facility.id, assignment.facility.name)"
                />
              </article>
            </div>

            <div v-else class="membership-empty">
              <span><UIcon name="i-lucide-building-2" /></span>
              <h4>Brak przypisanych placówek</h4>
              <p>{{ userName }} nie należy obecnie bezpośrednio do żadnej placówki.</p>
              <UButton
                v-if="canManageStructure"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-plus"
                :disabled="!canManageStructure || !availableFacilityItems.length"
                @click="openFacilityAssignmentModal"
              >
                Dodaj do placówki
              </UButton>
            </div>

            <UButton
              class="membership-panel__footer"
              :to="orgPath('/facilities')"
              color="neutral"
              variant="link"
              trailing-icon="i-lucide-arrow-right"
            >
              Zarządzaj wszystkimi placówkami
            </UButton>
          </section>
        </div>

        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          title="Członkostwo nie jest akredytacją"
          description="Dodanie do placówki nie nadaje możliwości przyjmowania spotkań. Dostępy eksperckie i zakres produktów pozostają poza tym ekranem."
        />

      </section>

      <section v-else-if="canEdit && activeView === 'accreditation'" class="secondary-view">
        <div class="secondary-view__intro">
          <span class="section-eyebrow">Uprawnienia eksperckie</span>
          <h2>Akredytacja</h2>
          <p>W tym miejscu będą zarządzane zakresy produktów, uprawnienia eksperckie i ważność akredytacji użytkownika.</p>
        </div>

        <div class="history-empty accreditation-placeholder">
          <span>
            <UIcon name="i-lucide-badge-check" />
          </span>
          <div class="accreditation-placeholder__badge">
            <UBadge color="neutral" variant="subtle">
              Wkrótce
            </UBadge>
          </div>
          <h3>Moduł akredytacji jest w przygotowaniu</h3>
          <p>Trwają prace nad bezpiecznym zarządzaniem uprawnieniami eksperckimi i zakresem obsługiwanych produktów.</p>
        </div>
      </section>

      <section v-else-if="canEdit && activeView === 'history'" class="secondary-view">
        <div class="secondary-view__intro">
          <span class="section-eyebrow">Audyt</span>
          <h2>Historia zmian</h2>
          <p>Każde zdarzenie ma autora, pełny czas, identyfikator, źródło oraz wartości przed i po. Rejestr jest tylko do odczytu.</p>
        </div>

        <div
          v-if="administrativeAuditStatus === 'pending' || administrativeAuditStatus === 'idle'"
          class="access-loading"
          aria-label="Ładowanie historii zmian"
        >
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-24 w-full" />
        </div>
        <UAlert
          v-else-if="administrativeAuditError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać historii zmian"
          :description="apiErrorMessage(administrativeAuditError)"
          :actions="[{ label: 'Ponów', onClick: () => refreshAdministrativeAudit() }]"
        />
        <div v-else-if="auditHistory.length" class="audit-log-list audit-log-list--full">
          <div class="audit-log-list__head" aria-hidden="true">
            <span />
            <span>Zmiana</span>
            <span>Wprowadzona przez</span>
            <span>Data i źródło</span>
          </div>
          <article v-for="entry in auditHistory" :key="entry.id" class="audit-log-row">
            <span :class="['audit-log-row__icon', `audit-log-row__icon--${entry.tone}`]">
              <UIcon :name="entry.icon" />
            </span>
            <div class="audit-log-row__content">
              <strong>{{ entry.title }}</strong>
              <p>{{ entry.description }}</p>
              <div class="audit-log-row__diff">
                <small>{{ entry.field }}</small>
                <span v-if="entry.before">{{ entry.before }}</span>
                <UIcon v-if="entry.before && entry.after" name="i-lucide-arrow-right" />
                <span v-if="entry.after" class="audit-log-row__after">{{ entry.after }}</span>
              </div>
              <p v-if="entry.reason" class="audit-log-row__reason">
                <UIcon name="i-lucide-message-square-text" />
                <span>{{ entry.reason }}</span>
              </p>
            </div>
            <div class="audit-log-row__actor">
              <UAvatar
                :src="entry.actor.avatarUrl || undefined"
                :alt="entry.actor.name"
                :text="auditActorInitials(entry.actor)"
                size="xs"
              />
              <div>
                <strong>{{ entry.actor.name }}</strong>
                <small>{{ entry.actor.role }}</small>
                <small v-if="entry.actor.email">{{ entry.actor.email }}</small>
              </div>
            </div>
            <div class="audit-log-row__meta">
              <time :datetime="entry.createdAt.toISOString()">
                {{ formatAuditDate(entry.createdAt) }}
              </time>
              <small>{{ entry.eventId }} · {{ entry.source }}</small>
            </div>
          </article>
          <UButton
            v-if="administrativeAuditEvents.page.hasMore"
            class="audit-load-more"
            color="neutral"
            variant="outline"
            icon="i-lucide-list-plus"
            :loading="loadingMoreAuditEvents"
            @click="() => loadMoreAuditEvents()"
          >
            Pokaż starsze zdarzenia
          </UButton>
        </div>
        <div v-else class="history-empty">
          <span><UIcon name="i-lucide-history" /></span>
          <h3>Brak zdarzeń audytowych</h3>
          <p>Po zarejestrowaniu zmiany zdarzenie pojawi się tutaj.</p>
          <UButton :to="{ path: route.path }" color="neutral" variant="outline">
            Przejdź do dostępów
          </UButton>
        </div>
      </section>
      <section v-else-if="isApprovalOnly" class="secondary-view">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-lock-keyhole"
          title="Ten obszar jest poza zakresem Twojego dostępu"
          description="Możesz wyłącznie rozpatrzyć grant anonimizacji przypisany do Ciebie jako osoby zatwierdzającej."
          :actions="[{ label: 'Przejdź do grantu', to: { path: route.path } }]"
        />
      </section>
    </template>

    <UModal
      v-model:open="teamAssignmentModalOpen"
      :title="`Dodaj ${userName} do zespołu`"
      description="Wybierz zespół oraz rolę administracyjną w jego zakresie."
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
    >
      <template #body>
        <UForm
          id="team-assignment-form"
          :state="teamAssignmentForm"
          class="assignment-form"
          @submit="addTeamAssignment"
        >
          <UFormField
            name="teamId"
            label="Zespół"
            description="Lista nie zawiera zespołów, do których użytkownik już należy."
            required
          >
            <USelectMenu
              v-model="teamAssignmentForm.teamId"
              class="w-full"
              :items="availableTeamItems"
              value-key="value"
              label-key="label"
              placeholder="Wybierz zespół"
            />
          </UFormField>
          <UFormField
            name="role"
            label="Rola w zespole"
            description="Administrator może zarządzać tym zespołem i jego członkami."
            required
          >
            <USelect
              v-model="teamAssignmentForm.role"
              class="w-full"
              :items="teamMembershipRoleItems"
              value-key="value"
              label-key="label"
            />
          </UFormField>
          <UAlert
            v-if="!availableTeamItems.length"
            color="neutral"
            variant="subtle"
            icon="i-lucide-users-round"
            title="Użytkownik należy już do wszystkich dostępnych zespołów"
          />
        </UForm>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="team-assignment-form"
          icon="i-lucide-user-plus"
          :disabled="!canManageStructure || !teamAssignmentForm.teamId"
          :loading="structureActionKey === 'team:add'"
        >
          Dodaj do zespołu
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="facilityAssignmentModalOpen"
      :title="`Dodaj ${userName} do placówki`"
      description="To bezpośrednie przypisanie organizacyjne, niezależne od akredytacji eksperckiej."
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
    >
      <template #body>
        <UForm
          id="facility-assignment-form"
          :state="facilityAssignmentForm"
          class="assignment-form"
          @submit="addFacilityAssignment"
        >
          <UFormField
            name="facilityId"
            label="Placówka"
            description="Lista zawiera aktywne placówki bez istniejącego bezpośredniego przypisania."
            required
          >
            <USelectMenu
              v-model="facilityAssignmentForm.facilityId"
              class="w-full"
              :items="availableFacilityItems"
              value-key="value"
              label-key="label"
              placeholder="Wybierz placówkę"
            />
          </UFormField>
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-badge-check"
            title="Bez dostępu eksperckiego"
            description="Nowe przypisanie nie pozwala przyjmować spotkań ani obsługiwać produktów. Te prawa nada później moduł akredytacji."
          />
          <UAlert
            v-if="!availableFacilityItems.length"
            color="neutral"
            variant="subtle"
            icon="i-lucide-building-2"
            title="Brak kolejnych aktywnych placówek do przypisania"
          />
        </UForm>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="facility-assignment-form"
          icon="i-lucide-plus"
          :disabled="!canManageStructure || !facilityAssignmentForm.facilityId"
          :loading="structureActionKey === 'facility:add'"
        >
          Dodaj do placówki
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="structureRemovalModalOpen"
      :title="structureRemovalTitle"
      :description="structureRemovalDescription"
      :ui="{ content: 'sm:max-w-lg', footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Sprawdź skutki przed usunięciem"
          description="Użytkownik może utracić dostęp wynikający z tego członkostwa. Pozostałe role i przypisania pozostaną bez zmian."
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">
          Anuluj
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-user-minus"
          :disabled="!canManageStructure"
          :loading="structureActionKey.includes(':remove:')"
          @click="removeStructureAssignment"
        >
          Usuń przypisanie
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="exceptionModalOpen"
      title="Bezpośrednie prawo do publikowania zgód"
      description="To niezależny, czasowy wyjątek. Edycja definicji nadal wymaga roli Administrator zgód."
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
      @update:open="handleConsentExceptionModalOpen"
    >
      <template #body>
        <div class="exception-form">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="Wyjątek wysokiego ryzyka"
            description="Nadanie uprawnienia i każda publikacja są rejestrowane w dzienniku audytu."
          />
          <UFormField
            name="consentReason"
            label="Uzasadnienie"
            description="Minimum 10 znaków; wpis będzie widoczny w audycie."
            :error="draft.consentReason && !consentReasonValid
              ? 'Wpisz co najmniej 10 znaków.'
              : undefined"
            required
          >
            <UTextarea
              v-model="draft.consentReason"
              class="w-full"
              :rows="3"
              placeholder="Dlaczego ta osoba potrzebuje publikować zgody?"
            />
          </UFormField>
          <UFormField
            name="consentExpiresAt"
            label="Ważne do"
            description="Po tej dacie wyjątek wygaśnie automatycznie."
            :error="draft.consentExpiresAt && !consentExpiryValid
              ? 'Wybierz przyszłą datę.'
              : undefined"
            required
          >
            <UInput
              v-model="draft.consentExpiresAt"
              class="w-full"
              type="date"
            />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <UButton color="neutral" variant="outline" @click="cancelConsentException">
          Anuluj
        </UButton>
        <UButton
          :disabled="!consentExceptionValid"
          icon="i-lucide-check"
          @click="confirmConsentException"
        >
          Zatwierdź wyjątek
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="anonymizationModalOpen"
      title="Grant do anonimizacji danych klienta"
      description="Jednorazowy dostęp do konkretnego, potwierdzonego żądania klienta."
      :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }"
    >
      <template #body>
        <div class="anonymization-form">
          <UAlert
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Anonimizacja jest nieodwracalna"
            description="Po wykonaniu operacji danych nie będzie można przywrócić. Grant stanie się nieważny po jednym użyciu."
          />

          <UFormField
            name="anonymizationRequest"
            label="Potwierdzone żądanie klienta"
            description="Można wskazać wyłącznie aktywne żądanie zweryfikowane przez compliance."
            :error="anonymizationShowValidation && !anonymizationRequestValid
              ? 'Wybierz zweryfikowane żądanie.'
              : undefined"
            required
          >
            <USelect
              v-model="anonymizationGrantForm.requestId"
              class="w-full"
              :items="verifiedAnonymizationRequests"
              value-key="value"
              placeholder="Wybierz żądanie"
            />
          </UFormField>

          <div v-if="selectedAnonymizationRequest" class="anonymization-request-preview">
            <span><UIcon name="i-lucide-link-2" /></span>
            <div>
              <small>Grant zostanie powiązany z klientem</small>
              <strong>{{ selectedAnonymizationRequest.clientReference }}</strong>
            </div>
          </div>

          <UFormField
            name="anonymizationJustification"
            label="Uzasadnienie operacyjne"
            description="Minimum 20 znaków; treść trafi do niezmiennego dziennika audytu."
            :error="anonymizationShowValidation && !anonymizationReasonValid
              ? 'Wpisz co najmniej 20 znaków.'
              : undefined"
            required
          >
            <UTextarea
              v-model="anonymizationGrantForm.justification"
              class="w-full"
              :rows="3"
              placeholder="Dlaczego ta osoba ma wykonać anonimizację?"
            />
          </UFormField>

          <div class="anonymization-form__row">
            <UFormField
              name="anonymizationExpiresAt"
              label="Dostęp ważny do"
              description="Maksymalnie 24 godziny."
              :error="anonymizationShowValidation && !anonymizationExpiryValid
                ? 'Wybierz czas w ciągu najbliższych 24 godzin.'
                : undefined"
              required
            >
              <UInput
                v-model="anonymizationGrantForm.expiresAt"
                class="w-full"
                type="datetime-local"
                :min="anonymizationExpiryMin"
                :max="anonymizationExpiryMax"
              />
            </UFormField>

            <UFormField
              name="anonymizationApprover"
              label="Zatwierdzająca osoba"
              description="Musi być inna niż odbiorca grantu."
              :error="anonymizationShowValidation && !selectedAnonymizationApprover
                ? 'Wybierz osobę zatwierdzającą.'
                : undefined"
              required
            >
              <USelect
                v-model="anonymizationGrantForm.approverId"
                class="w-full"
                :items="anonymizationApprovers"
                value-key="value"
                placeholder="Wybierz osobę"
                :loading="anonymizationApproversStatus === 'pending'"
                :disabled="Boolean(anonymizationApproversError)"
              />
            </UFormField>
          </div>

          <UAlert
            v-if="anonymizationApproversError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się pobrać osób zatwierdzających"
            :description="apiErrorMessage(anonymizationApproversError)"
            :actions="[{ label: 'Ponów', onClick: () => refreshAnonymizationApprovers() }]"
          />

          <div class="anonymization-four-eyes">
            <UIcon name="i-lucide-users-round" />
            <p>
              <strong>Zasada dwóch par oczu.</strong>
              Samo wysłanie wniosku nie aktywuje dostępu. Zatwierdzenie, użycie i wygaśnięcie
              zostaną zapisane w audycie.
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton color="neutral" variant="outline" @click="anonymizationModalOpen = false">
          Anuluj
        </UButton>
        <UButton
          icon="i-lucide-send"
          :loading="anonymizationActionKey === 'create'"
          :disabled="Boolean(anonymizationApproversError)"
          @click="submitAnonymizationGrant"
        >
          Wyślij do zatwierdzenia
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="anonymizationActionModalOpen"
      :title="anonymizationActionPresentation.title"
      :description="anonymizationActionPresentation.description"
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
    >
      <template #body>
        <div class="anonymization-form">
          <div v-if="anonymizationGrant" class="anonymization-request-preview">
            <span><UIcon name="i-lucide-file-lock-2" /></span>
            <div>
              <small>{{ anonymizationGrant.requestNumber }}</small>
              <strong>{{ anonymizationGrant.clientReference }}</strong>
            </div>
          </div>
          <UFormField
            name="anonymizationActionReason"
            :label="anonymizationActionPresentation.reasonLabel"
            :description="anonymizationAction === 'approve'
              ? 'Jeśli dodajesz komentarz, wpisz co najmniej 10 znaków.'
              : 'Minimum 10 znaków; treść zostanie zapisana w audycie.'"
            :error="anonymizationActionShowValidation && !anonymizationActionReasonValid
              ? 'Wpisz co najmniej 10 znaków.'
              : undefined"
            :required="anonymizationAction !== 'approve'"
          >
            <UTextarea
              v-model="anonymizationActionReason"
              class="w-full"
              :rows="3"
              placeholder="Opisz podstawę decyzji"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="Boolean(anonymizationActionKey)"
          @click="anonymizationActionModalOpen = false"
        >
          Anuluj
        </UButton>
        <UButton
          :color="anonymizationActionPresentation.color"
          :icon="anonymizationActionPresentation.icon"
          :loading="Boolean(anonymizationActionKey)"
          @click="submitAnonymizationAction"
        >
          {{ anonymizationActionPresentation.label }}
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.user-meta {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.user-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.access-loading {
  display: grid;
  gap: 18px;
}

.access-loading__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, .75fr);
  gap: 18px;
}

.read-only-alert {
  margin-bottom: 20px;
}

.admin-access,
.secondary-view {
  display: grid;
  gap: 22px;
  padding-bottom: 20px;
}

.view-intro,
.secondary-view__intro,
.simple-card-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.view-intro > div,
.secondary-view__intro {
  max-width: 720px;
}

.section-eyebrow {
  display: block;
  margin-bottom: 5px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.view-intro h2,
.secondary-view__intro h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 26px;
  line-height: 1.15;
}

.view-intro p,
.secondary-view__intro > p {
  margin: 7px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.55;
}

.access-stats,
.overview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
  overflow: hidden;
}

.access-stats article,
.overview-grid article {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 13px;
  align-items: center;
  min-width: 0;
  padding: 18px 20px;
}

.access-stats article + article,
.overview-grid article + article {
  border-left: 1px solid var(--ui-border);
}

.access-stat__icon,
.overview-grid article > span {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.access-stat__icon--warning {
  color: var(--ui-warning);
}

.access-stats small,
.overview-grid small {
  display: block;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .02em;
}

.access-stats strong,
.overview-grid strong {
  display: inline-block;
  margin-top: 1px;
  color: var(--ui-text-highlighted);
  font-size: 21px;
  font-weight: 600;
  line-height: 1.2;
}

.access-stats p,
.overview-grid p {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.access-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(310px, .7fr);
  gap: 20px;
  align-items: start;
}

.access-editor {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.access-section,
.effective-panel {
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.access-section {
  padding: 20px;
}

.access-section--sensitive {
  border-color: color-mix(in srgb, var(--ui-warning) 30%, var(--ui-border));
}

.section-heading,
.section-heading > div,
.effective-panel__heading,
.role-row__title,
.exception-card__title,
.effective-item__title {
  display: flex;
  align-items: center;
}

.section-heading,
.effective-panel__heading,
.role-row__title,
.exception-card__title,
.effective-item__title {
  justify-content: space-between;
}

.section-heading {
  gap: 20px;
  padding-bottom: 17px;
}

.section-heading > div {
  gap: 11px;
  min-width: 0;
}

.section-heading > span:last-child {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}

.section-heading__index {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 750;
}

.section-heading__index--warning {
  background: color-mix(in srgb, var(--ui-warning) 15%, var(--ui-bg));
  color: var(--ui-warning);
}

.section-heading h3,
.effective-panel h3,
.simple-card-heading h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 17px;
  line-height: 1.25;
}

.section-heading p,
.effective-panel__description {
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.role-list {
  display: grid;
  border-top: 1px solid var(--ui-border);
}

.role-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 13px;
  align-items: start;
  min-width: 0;
  padding: 17px 4px;
  border-bottom: 1px solid var(--ui-border);
  transition:
    background-color var(--oe-motion-fast),
    border-color var(--oe-motion-fast);
}

.role-row:last-child {
  border-bottom: 0;
}

.role-row--selected {
  background: color-mix(in srgb, var(--ui-bg-muted) 70%, transparent);
}

.role-row--sensitive.role-row--selected {
  background: color-mix(in srgb, var(--ui-warning) 5%, var(--ui-bg));
}

.role-row__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-top: -5px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.role-row--sensitive .role-row__icon {
  color: var(--ui-warning);
}

.role-row__copy {
  min-width: 0;
}

.role-row__title {
  justify-content: flex-start;
  gap: 8px;
}

.role-row h4,
.exception-card h4 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.role-row__copy > p,
.exception-card__top > div > p {
  max-width: 610px;
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.permission-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
}

.permission-list span {
  padding: 3px 7px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.2;
}

.role-row__count {
  display: grid;
  justify-items: end;
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.25;
  text-transform: uppercase;
  white-space: nowrap;
}

.role-row__count strong {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.exception-card {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  background: var(--ui-bg-muted);
  transition: border-color var(--oe-motion-fast);
}

.exception-card--active {
  border-color: color-mix(in srgb, var(--ui-warning) 45%, var(--ui-border));
}

.exception-card__top {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 13px;
  align-items: start;
  padding: 17px;
}

.exception-card__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg));
  color: var(--ui-warning);
  font-size: 17px;
}

.exception-card__title {
  justify-content: flex-start;
  gap: 8px;
}

.exception-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, .42fr);
  gap: 14px;
  padding: 17px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.four-eyes-note {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  padding: 13px 17px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
}

.four-eyes-note > svg {
  margin-top: 1px;
  color: var(--ui-warning);
  font-size: 17px;
}

.four-eyes-note strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.four-eyes-note p {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.45;
}

.effective-panel {
  position: sticky;
  top: 18px;
  padding: 20px;
}

.effective-panel__score {
  display: grid;
  place-items: center;
  min-width: 42px;
  height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.effective-panel__description {
  padding-bottom: 15px;
  border-bottom: 1px solid var(--ui-border);
}

.effective-list {
  display: grid;
}

.effective-list article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  padding: 13px 0;
  border-bottom: 1px solid var(--ui-border);
  opacity: .62;
}

.effective-list article.effective-item--granted {
  opacity: 1;
}

.effective-item__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 14px;
}

.effective-item--granted .effective-item__icon {
  color: var(--ui-success);
}

.effective-item--sensitive.effective-item--granted .effective-item__icon {
  color: var(--ui-warning);
}

.effective-item__title {
  gap: 8px;
}

.effective-item__title strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.effective-item__title svg {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.effective-item--granted .effective-item__title svg {
  color: var(--ui-success);
}

.effective-item--sensitive.effective-item--granted .effective-item__title svg {
  color: var(--ui-warning);
}

.effective-list p {
  margin: 2px 0 5px;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.effective-list small {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.effective-panel__principle {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 9px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.effective-panel__principle > svg {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.effective-panel__principle strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 10px;
}

.effective-panel__principle p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.4;
}

.save-bar {
  position: sticky;
  z-index: 10;
  bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-bg) 94%, transparent);
  box-shadow: 0 14px 38px rgb(0 0 0 / 12%);
  backdrop-filter: blur(14px);
}

.save-bar > div:first-child {
  display: flex;
  align-items: center;
  gap: 10px;
}

.save-bar > div:first-child > span {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-warning);
}

.save-bar strong,
.save-bar small {
  display: block;
}

.save-bar strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.save-bar small {
  margin-top: 1px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.save-bar__actions {
  display: flex;
  gap: 8px;
}

.save-bar-enter-active,
.save-bar-leave-active {
  transition:
    opacity var(--oe-motion-base),
    transform var(--oe-motion-base);
}

.save-bar-enter-from,
.save-bar-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.overview-grid article {
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 88px;
  padding: 16px 18px;
}

.overview-grid article > span {
  width: 40px;
  height: 40px;
  margin: 0;
}

.overview-grid__copy {
  min-width: 0;
}

.overview-grid__copy small {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.overview-grid__copy p {
  margin-top: 3px;
  overflow: visible;
  line-height: 1.35;
  text-overflow: clip;
  white-space: normal;
}

.overview-grid article > strong {
  margin: 0;
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  font-weight: 550;
  line-height: 1;
  text-align: right;
  white-space: nowrap;
}

.simple-card-heading h3 {
  margin-top: 3px;
}

.overview-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.overview-panel {
  min-width: 0;
}

.overview-panel--audit {
  grid-column: 1 / -1;
}

.overview-access-list {
  display: grid;
}

.overview-access-list > div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border);
}

.overview-access-list > div:last-child {
  border-bottom: 0;
}

.overview-access-list > div > svg {
  color: var(--ui-success);
}

.overview-access-list span {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
}

.overview-access-list small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.overview-structure-loading {
  display: grid;
  gap: 11px;
}

.overview-structure-error {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 108px;
  color: var(--ui-error);
}

.overview-structure-error p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.overview-structure-list {
  display: grid;
}

.overview-structure-list article {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
  min-width: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border);
}

.overview-structure-list article:last-child {
  border-bottom: 0;
}

.overview-structure-list article > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.overview-structure-list article > div {
  min-width: 0;
}

.overview-structure-list strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.overview-structure-list p {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-structure-list small {
  color: var(--ui-text-muted);
  font-size: 10px;
  text-align: right;
  white-space: nowrap;
}

.audit-heading-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}

.audit-log-list {
  min-width: 0;
}

.audit-log-list--full {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.audit-log-list__head,
.audit-log-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1.35fr) minmax(180px, .58fr) minmax(190px, .64fr);
  gap: 12px;
}

.audit-log-list__head {
  align-items: center;
  padding: 9px 0 10px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.audit-log-list--full .audit-log-list__head {
  padding-right: 18px;
  padding-left: 18px;
}

.audit-log-row {
  align-items: start;
  min-width: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--ui-border);
}

.audit-log-list--full .audit-log-row {
  padding: 16px 18px;
}

.audit-load-more {
  display: flex;
  width: fit-content;
  margin: 14px auto;
}

.audit-log-row:last-child {
  border-bottom: 0;
}

.audit-log-row__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 15px;
}

.audit-log-row__icon--success {
  background: color-mix(in srgb, var(--ui-success) 10%, var(--ui-bg-muted));
  color: var(--ui-success);
}

.audit-log-row__icon--warning {
  background: color-mix(in srgb, var(--ui-warning) 10%, var(--ui-bg-muted));
  color: var(--ui-warning);
}

.audit-log-row__icon--error {
  background: color-mix(in srgb, var(--ui-error) 10%, var(--ui-bg-muted));
  color: var(--ui-error);
}

.audit-log-row__content,
.audit-log-row__actor > div,
.audit-log-row__meta {
  min-width: 0;
}

.audit-log-row__content > strong,
.audit-log-row__actor strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.audit-log-row__content > p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.audit-log-row__diff {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 7px;
}

.audit-log-row__diff small {
  margin-right: 2px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .02em;
}

.audit-log-row__diff span {
  padding: 2px 6px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.audit-log-row__diff svg {
  width: 11px;
  height: 11px;
  color: var(--ui-text-dimmed);
}

.audit-log-row__diff .audit-log-row__after {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.audit-log-row__actor {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.audit-log-row__actor strong,
.audit-log-row__actor small,
.audit-log-row__meta time,
.audit-log-row__meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audit-log-row__actor small {
  display: block;
  margin-top: 1px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.audit-log-row__meta {
  text-align: right;
}

.audit-log-row__meta time,
.audit-log-row__meta small {
  display: block;
}

.audit-log-row__meta time {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.audit-log-row__meta small {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
}

.audit-log-row__reason {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 8px !important;
}

.audit-log-row__reason svg {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  margin-top: 1px;
}

.secondary-view__intro {
  display: block;
}

.membership-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.membership-panel {
  display: grid;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.membership-grid--loading .membership-panel {
  gap: 14px;
  padding: 18px;
}

.membership-panel__header,
.membership-panel__title,
.membership-row,
.membership-row__name {
  display: flex;
  align-items: center;
}

.membership-panel__header {
  justify-content: space-between;
  gap: 14px;
  padding: 17px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.membership-panel__title {
  gap: 11px;
  min-width: 0;
}

.membership-panel__title > span,
.membership-row__icon,
.membership-empty > span {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.membership-panel h3,
.membership-empty h4 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.membership-panel__title p,
.membership-row__copy p,
.membership-empty p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.membership-list {
  display: grid;
}

.membership-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(145px, auto) auto;
  gap: 11px;
  min-width: 0;
  padding: 14px 15px 14px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.membership-row__icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--ui-text-muted);
  font-size: 15px;
}

.membership-row__copy {
  min-width: 0;
}

.membership-row__copy a {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.membership-row__copy a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.membership-row__name {
  gap: 7px;
  min-width: 0;
}

.membership-row__role {
  width: 178px;
}

.membership-row__badge {
  justify-self: end;
  white-space: nowrap;
}

.membership-row__remove {
  align-self: center;
}

.membership-empty {
  display: grid;
  justify-items: center;
  min-height: 190px;
  padding: 28px 20px;
  text-align: center;
}

.membership-empty > span {
  width: 44px;
  height: 44px;
  margin-bottom: 11px;
  color: var(--ui-text-muted);
  font-size: 19px;
}

.membership-empty p {
  max-width: 310px;
  margin: 5px 0 15px;
}

.membership-panel__footer {
  justify-self: start;
  margin: 7px 9px 9px;
}

.assignment-form {
  display: grid;
  gap: 16px;
}

.history-list {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.history-list article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.history-list article:last-child {
  border-bottom: 0;
}

.history-list article > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-success);
}

.history-list strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.history-list p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.history-list time {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.history-empty {
  display: grid;
  justify-items: center;
  padding: 54px 24px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-surface);
  text-align: center;
}

.history-empty > span {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 12px;
  border-radius: 14px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 21px;
}

.history-empty h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.history-empty p {
  margin: 5px 0 16px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.accreditation-placeholder {
  min-height: 300px;
}

.accreditation-placeholder > span {
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
  color: var(--ui-primary);
}

.accreditation-placeholder h3 {
  margin-top: 12px;
}

.accreditation-placeholder p {
  max-width: 560px;
  margin-bottom: 0;
  line-height: 1.6;
}

.admin-access {
  gap: 12px;
  padding-bottom: 0;
}

@media (min-width: 761px) {
  :deep(.crm-page-header) {
    margin-top: -8px;
    margin-bottom: 14px;
  }
}

.access-workspace {
  grid-template-columns: minmax(0, 7fr) minmax(360px, 5fr);
  gap: 12px;
}

.access-editor {
  gap: 12px;
}

.access-side {
  position: sticky;
  top: 18px;
  display: grid;
  gap: 12px;
  min-width: 0;
}

.access-section,
.effective-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.access-section,
.effective-panel {
  padding: 0;
}

.access-panel-heading,
.effective-panel__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px;
  border-bottom: 1px solid var(--ui-border);
}

.access-panel-heading h2,
.effective-panel__heading h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
}

.access-panel-heading p,
.effective-panel__heading p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.access-panel-heading > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}

.role-list {
  border-top: 0;
}

.role-list__head {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) minmax(106px, auto) minmax(92px, auto);
  gap: 12px;
  padding: 9px 18px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.role-list__head span:first-child {
  grid-column: 1 / 3;
}

.role-list__head span:last-child {
  text-align: right;
}

.role-row {
  grid-template-columns: 34px minmax(0, 1fr) minmax(106px, auto) minmax(92px, auto);
  gap: 12px;
  align-items: center;
  padding: 9px 18px;
}

.role-row__icon {
  width: 34px;
  height: 34px;
  margin-top: 0;
}

.role-row__title {
  flex-wrap: wrap;
}

.role-row h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.role-row__copy > p {
  margin: 4px 0 0;
}

.role-row__assignment {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  min-height: 44px;
  font-size: 11px;
  cursor: pointer;
}

.role-row__origin {
  color: var(--ui-text-muted);
  font-size: 11px;
  text-align: right;
}

.access-tier {
  border-color: var(--ui-border);
}

.access-tier--sensitive {
  border-color: color-mix(in srgb, var(--ui-warning) 34%, var(--ui-border));
}

.access-tier--high-risk {
  border-color: color-mix(in srgb, var(--ui-error) 38%, var(--ui-border));
}

.approval-only-panel {
  width: min(100%, 1100px);
  margin: 0 auto;
}

.approval-only-panel__body {
  margin: 18px;
}

.approval-only-panel > .risk-access-row {
  background: color-mix(in srgb, var(--ui-error) 2%, var(--ui-bg));
}

.access-tier__heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 18px;
  border-bottom: 1px solid var(--ui-border);
}

.access-tier--sensitive .access-tier__heading {
  border-bottom-color: color-mix(in srgb, var(--ui-warning) 24%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-warning) 5%, var(--ui-bg));
}

.access-tier--high-risk .access-tier__heading {
  border-bottom-color: color-mix(in srgb, var(--ui-error) 28%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-error) 5%, var(--ui-bg));
}

.access-tier__heading h2 {
  margin: 2px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
}

.access-tier__heading p {
  margin: 4px 0 0;
  max-width: 62ch;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.access-tier__icon,
.access-tier-row__icon,
.risk-access-row__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  font-size: 18px;
}

.access-tier--sensitive .access-tier__icon,
.access-tier-row--sensitive .access-tier-row__icon {
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 11%, var(--ui-bg));
}

.access-tier--high-risk .access-tier__icon,
.risk-access-row__icon {
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 12%, var(--ui-bg));
}

.access-tier-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) minmax(112px, auto) minmax(112px, auto);
  gap: 12px;
  align-items: center;
  padding: 16px 18px;
}

.access-tier-row--selected {
  background: color-mix(in srgb, var(--ui-warning) 3%, var(--ui-bg));
}

.access-tier-row__copy h3,
.risk-access-row__copy h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
}

.access-tier-row__copy > p,
.risk-access-row__copy > p {
  margin: 4px 0 0;
  max-width: 64ch;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.access-tier-row__scope,
.risk-access-row__rules {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 10px;
}

.access-tier-row__scope span,
.risk-access-row__rules span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.35;
}

.access-tier-row__scope svg {
  color: var(--ui-warning);
}

.risk-access-row__rules svg {
  color: var(--ui-error);
}

.access-tier-row__assignment {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  color: var(--ui-text-muted);
  font-size: 11px;
  cursor: pointer;
}

.access-tier-row__origin {
  color: var(--ui-text-muted);
  font-size: 10px;
  text-align: right;
}

.risk-access-list {
  background: color-mix(in srgb, var(--ui-error) 2%, var(--ui-bg));
}

.risk-access-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) minmax(230px, .72fr);
  gap: 14px;
  align-items: start;
  padding: 18px;
}

.risk-access-row--anonymization {
  grid-template-columns: 38px minmax(0, 1fr) minmax(280px, 320px);
}

.risk-access-row--anonymization .risk-access-row__title {
  justify-content: flex-start;
}

.risk-access-row + .risk-access-row {
  border-top: 1px solid color-mix(in srgb, var(--ui-error) 24%, var(--ui-border));
}

.risk-access-row__title,
.risk-access-row__grant-heading,
.risk-access-row__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.risk-access-row__control,
.risk-access-row__grant {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding-left: 16px;
  border-left: 1px solid color-mix(in srgb, var(--ui-error) 22%, var(--ui-border));
}

.risk-access-row__control small,
.risk-access-row__grant small {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.risk-access-row__grant > p {
  margin: 0;
  color: var(--ui-text);
  font-size: 12px;
  line-height: 1.55;
}

.risk-access-row__control--grant-empty {
  align-self: center;
}

.risk-access-row--anonymization .risk-access-row__control,
.risk-access-row--anonymization .risk-access-row__grant {
  border-left-color: color-mix(in srgb, var(--ui-error) 14%, var(--ui-border));
}

.grant-empty-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.grant-empty-state__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.grant-empty-state__copy strong {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.grant-empty-state__copy strong svg {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  font-size: 14px;
}

.grant-empty-state__button {
  flex: 0 0 auto;
}

.risk-access-row__switch > span {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 600;
}

.risk-access-row__grant-heading code {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk-access-row__grant > strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.risk-access-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.effective-panel {
  position: static;
}

.effective-panel__heading {
  align-items: center;
}

.effective-list article {
  padding: 13px 18px;
}

.effective-list article.effective-item--pending {
  opacity: 1;
}

.effective-item--pending .effective-item__icon,
.effective-item--pending .effective-item__title svg {
  color: var(--ui-warning);
}

.effective-item--high-risk.effective-item--granted .effective-item__icon,
.effective-item--high-risk.effective-item--granted .effective-item__title svg {
  color: var(--ui-error);
}

.effective-list p {
  font-size: 11px;
}

.effective-list small {
  font-size: 10px;
}

.anonymization-form {
  display: grid;
  gap: 16px;
}

.anonymization-form__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.anonymization-request-preview,
.anonymization-four-eyes {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.anonymization-request-preview > span {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.anonymization-request-preview small,
.anonymization-request-preview strong {
  display: block;
}

.anonymization-request-preview small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.anonymization-request-preview strong {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.anonymization-four-eyes {
  align-items: start;
  border-color: color-mix(in srgb, var(--ui-warning) 28%, var(--ui-border));
}

.anonymization-four-eyes > svg {
  margin-top: 2px;
  color: var(--ui-warning);
}

.anonymization-four-eyes p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.anonymization-four-eyes strong {
  color: var(--ui-text-highlighted);
}

.save-bar {
  bottom: 0;
  min-height: 72px;
  padding: 14px 18px;
  border-color: color-mix(in srgb, var(--ui-warning) 34%, var(--ui-border));
  border-radius: var(--oe-radius-surface) var(--oe-radius-surface) 0 0;
  background: var(--ui-bg);
  box-shadow: none;
  backdrop-filter: none;
}

@media (min-width: 761px) {
  .save-bar {
    margin-inline-end: 142px;
  }
}

.exception-form {
  display: grid;
  gap: 16px;
}

@media (max-width: 1180px) {
  .access-workspace,
  .access-loading__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .access-side {
    position: static;
  }

  .audit-log-list__head {
    display: none;
  }

  .audit-log-row {
    grid-template-columns: 36px minmax(0, 1fr) minmax(180px, .55fr);
  }

  .audit-log-row__meta {
    display: flex;
    grid-column: 2 / -1;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
  }

  .audit-log-row__meta small {
    margin-top: 0;
    text-align: right;
  }
}

@media (max-width: 760px) {
  .view-intro,
  .simple-card-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .access-stats,
  .overview-grid,
  .membership-grid,
  .overview-detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .overview-panel--audit {
    grid-column: auto;
  }

  .access-stats article + article,
  .overview-grid article + article {
    border-top: 1px solid var(--ui-border);
    border-left: 0;
  }

  .role-row {
    grid-template-columns: 34px minmax(0, 1fr) auto;
  }

  .role-list__head {
    display: none;
  }

  .role-row__origin {
    grid-column: 2;
    justify-self: start;
    text-align: left;
  }

  .access-tier-row {
    grid-template-columns: 38px minmax(0, 1fr) auto;
  }

  .access-tier-row__origin {
    grid-column: 2;
    justify-self: start;
    text-align: left;
  }

  .risk-access-row {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .risk-access-row__control,
  .risk-access-row__grant {
    grid-column: 2;
    padding-top: 12px;
    padding-left: 0;
    border-top: 1px solid color-mix(in srgb, var(--ui-error) 22%, var(--ui-border));
    border-left: 0;
  }

  .anonymization-form__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .save-bar {
    align-items: stretch;
    bottom: 72px;
    flex-direction: column;
  }

  .save-bar__actions {
    justify-content: flex-end;
  }

  .audit-log-row {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .audit-log-row__actor,
  .audit-log-row__meta {
    grid-column: 2;
  }

  .audit-log-row__meta {
    display: grid;
    justify-content: stretch;
  }

  .audit-log-row__meta small {
    margin-top: 3px;
    text-align: left;
  }

}

@media (max-width: 520px) {
  .user-meta {
    flex-wrap: wrap;
  }

  .user-meta > span:first-child {
    width: 100%;
  }

  .membership-panel__header {
    align-items: flex-start;
  }

  .audit-heading-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .overview-structure-list article {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .overview-structure-list small {
    grid-column: 2;
    text-align: left;
  }

  .membership-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
  }

  .membership-row__role,
  .membership-row__badge {
    grid-column: 2;
    grid-row: 2;
    justify-self: start;
    width: min(100%, 220px);
  }

  .membership-row__remove {
    grid-column: 3;
    grid-row: 1;
  }

  .access-panel-heading,
  .effective-panel__heading,
  .access-tier__heading {
    align-items: flex-start;
  }

  .access-panel-heading,
  .effective-panel__heading {
    flex-direction: column;
  }

  .role-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .role-row__icon {
    display: none;
  }

  .role-row__assignment {
    grid-column: 2;
    grid-row: 1;
  }

  .role-row__origin {
    grid-column: 1;
    grid-row: 2;
  }

  .access-tier__heading {
    grid-template-columns: 38px minmax(0, 1fr);
    padding: 16px;
  }

  .access-tier__heading > :last-child {
    grid-column: 2;
    justify-self: start;
  }

  .access-tier-row {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 16px;
  }

  .access-tier-row__icon {
    display: none;
  }

  .access-tier-row__assignment {
    grid-column: 2;
    grid-row: 1;
  }

  .access-tier-row__origin {
    grid-column: 1;
    grid-row: 2;
  }

  .risk-access-row {
    grid-template-columns: 38px minmax(0, 1fr);
    padding: 16px;
  }

  .risk-access-row__title {
    align-items: flex-start;
    flex-direction: column;
  }

  .risk-access-row__control,
  .risk-access-row__grant {
    grid-column: 1 / -1;
  }

  .grant-empty-state {
    align-items: stretch;
    flex-direction: column;
  }

  .grant-empty-state__button {
    width: 100%;
    min-height: 44px;
  }

  .risk-access-row__control > :deep(button) {
    width: 100%;
    min-height: 44px;
  }

  .risk-access-row__actions > * {
    flex: 1;
  }

  .save-bar__actions > * {
    flex: 1;
  }

  .overview-access-list > div {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .overview-access-list small {
    grid-column: 2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .save-bar-enter-active,
  .save-bar-leave-active {
    transition: none;
  }
}
</style>
