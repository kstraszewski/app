<script setup lang="ts">
import type { BookingWidgetType } from '#shared/types/booking-calculators'
import type { TeamGraphPayload } from '~/types/organization'
import type {
  Appointment,
  BookingWidget,
  CalendarConnection,
  CalendarProvider,
  Facility,
  FacilityAppointmentsPayload,
  FacilityCalendarConnectionsPayload,
  FacilityDetailPayload,
  FacilityHoursPayload,
  FacilityListPayload,
  FacilityMember,
  FacilityMembersPayload,
  FacilityServicesPayload,
  FacilityTeamLinksPayload,
  FacilityWidgetsPayload,
  OrganizationMembersPayload,
} from '~/types/scheduling'

type FacilityForm = {
  name: string
  slug: string
  timezone: string
  addressLine1: string
  addressLine2: string
  postalCode: string
  city: string
  countryCode: string
  phone: string
  email: string
  isActive: boolean
}

type PeriodEditor = {
  startsAt: string
  endsAt: string
}

type DayEditor = {
  weekday: number
  label: string
  enabled: boolean
  periods: PeriodEditor[]
}

type OpeningOverrideEditor = {
  localDate: string
  isClosed: boolean
  opensAt: string
  closesAt: string
}

type ExpertOverrideEditor = {
  localDate: string
  isUnavailable: boolean
  startsAt: string
  endsAt: string
}

type MemberDraft = {
  role: 'admin' | 'member'
  isBookable: boolean
  bookingPriority: number
}

type WidgetDraft = {
  name: string
  title: string
  subtitle: string
  theme: 'light' | 'dark' | 'auto'
  accentColor: string
  allowedOrigins: string
  bookingMode: 'facility' | 'expert' | 'both'
  widgetType: BookingWidgetType
  fixedExpertUserId: string
  locale: string
  isActive: boolean
  serviceIds: string[]
}

type CalendarState = {
  available: boolean
  data: FacilityCalendarConnectionsPayload
  error: string
}

type CalendarCard = {
  provider: CalendarProvider
  label: string
  icon: string
  enabled: boolean
  connection: CalendarConnection | null
}

type AppointmentClientOption = {
  id: string
  display_name: string
  primary_email: string | null
  primary_phone: string | null
  status_code: string
}

type StaffAppointmentSlot = {
  startsAt: string
  endsAt: string
  expertUserId: string
  expertName: string
}

type FacilityWorkspace = {
  detail: FacilityDetailPayload | null
  members: FacilityMembersPayload
  teamLinks: FacilityTeamLinksPayload
  hours: FacilityHoursPayload
  services: FacilityServicesPayload
  widgets: FacilityWidgetsPayload
  facilityCalendar: CalendarState
  expertCalendar: CalendarState
}

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Szczegóły placówki — OpenExpert CRM' })

const route = useRoute()
const router = useRouter()
const { organizationSlug, crmApiPath, orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const currentUrl = useRequestURL()

const selectedFacilityId = ref(Array.isArray(route.params.facilityId)
  ? String(route.params.facilityId[0] ?? '')
  : String(route.params.facilityId ?? ''))
const facilitySearch = ref('')
const activeSection = ref(typeof route.query.section === 'string' ? route.query.section : 'overview')
const createFacilityOpen = ref(false)
const createWidgetOpen = ref(false)
const createAppointmentOpen = ref(false)
const disconnectOpen = ref(false)
const connectionToDisconnect = ref<CalendarConnection | null>(null)
const savingFacility = ref(false)
const savingTeamLink = ref(false)
const savingMember = ref(false)
const savingHours = ref(false)
const savingExpertSchedule = ref(false)
const savingWidget = ref(false)
const savingAppointment = ref(false)
const syncingConnectionId = ref('')
const teamToLink = ref('')
const selectedExpertId = ref('')
const selectedWidgetId = ref('')
const expertSchedulePending = ref(false)
const expertScheduleError = ref('')
const appointmentStatus = ref('all')
const appointmentExpertId = ref('all')
const appointmentOffset = ref(0)
const appointmentPageSize = 50
const appointmentClientSearch = ref('')
const appointmentClientResults = ref<AppointmentClientOption[]>([])
const appointmentClientPending = ref(false)
const selectedAppointmentClient = ref<AppointmentClientOption | null>(null)
const staffAppointmentSlots = ref<StaffAppointmentSlot[]>([])
const selectedStaffAppointmentSlot = ref<StaffAppointmentSlot | null>(null)
const staffAppointmentSlotsPending = ref(false)
const staffAppointmentSlotsError = ref('')
const staffAppointmentIdempotencyIntent = ref('')
let staffSlotsRequestId = 0
let appointmentClientRequestId = 0
let expertScheduleRequestId = 0

const weekdayLabels = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela']
const sectionItems = [
  { label: 'Dane', value: 'overview', icon: 'i-lucide-building-2' },
  { label: 'Zespół', value: 'people', icon: 'i-lucide-users' },
  { label: 'Godziny', value: 'hours', icon: 'i-lucide-clock-3' },
  { label: 'Eksperci', value: 'experts', icon: 'i-lucide-users-round' },
  { label: 'Widget', value: 'widget', icon: 'i-lucide-code-xml' },
  { label: 'Kalendarze', value: 'calendars', icon: 'i-lucide-calendar-sync' },
  { label: 'Wizyty', value: 'appointments', icon: 'i-lucide-calendar-check-2' },
]
if (!sectionItems.some(item => item.value === activeSection.value)) activeSection.value = 'overview'
watch(activeSection, (section) => {
  if (!import.meta.client || route.query.section === section) return
  void router.replace({ query: { ...route.query, section } })
})
const timezoneItems = [
  'Europe/Warsaw',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Prague',
  'UTC',
]
const roleItems = [
  { label: 'Członek', value: 'member' },
]
const themeItems = [
  { label: 'Automatyczny', value: 'auto' },
  { label: 'Jasny', value: 'light' },
  { label: 'Ciemny', value: 'dark' },
]
const bookingModeItems = [
  { label: 'Placówka i ekspert', value: 'both' },
  { label: 'Tylko placówka', value: 'facility' },
  { label: 'Tylko ekspert', value: 'expert' },
]
const widgetTypeItems: Array<{ label: string, value: BookingWidgetType, description: string }> = [
  {
    label: 'Kalkulator zdolności',
    value: 'mortgage_capacity',
    description: 'Najpierw szacuje zdolność, następnie prowadzi do umówienia spotkania.',
  },
  {
    label: 'Kalkulator raty',
    value: 'mortgage_payment',
    description: 'Najpierw wylicza ratę, następnie prowadzi do umówienia spotkania.',
  },
  {
    label: 'Kalendarz',
    value: 'calendar',
    description: 'Od razu pokazuje formularz wyboru terminu.',
  },
]
const appointmentStatusItems = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Potwierdzone', value: 'confirmed' },
  { label: 'Rezerwacje czasowe', value: 'hold' },
  { label: 'Anulowane', value: 'cancelled' },
]
const calendarProviderItems: Array<{ provider: CalendarProvider, label: string, icon: string }> = [
  { provider: 'google', label: 'Google Calendar', icon: 'i-lucide-calendar-days' },
  { provider: 'microsoft', label: 'Outlook / Microsoft 365', icon: 'i-lucide-calendar-range' },
]

const facilityForm = reactive<FacilityForm>(blankFacilityForm())
const createFacilityForm = reactive<FacilityForm>(blankFacilityForm())
const memberForm = reactive({
  userId: '',
  role: 'member' as 'admin' | 'member',
  isBookable: true,
  bookingPriority: 100,
})
const memberDrafts = reactive<Record<string, MemberDraft>>({})
const openingDays = ref<DayEditor[]>(blankWeek())
const openingOverrides = ref<OpeningOverrideEditor[]>([])
const openingOverrideForm = reactive<OpeningOverrideEditor>({
  localDate: '',
  isClosed: true,
  opensAt: '09:00',
  closesAt: '17:00',
})
const expertDays = ref<DayEditor[]>(blankWeek())
const expertOverrides = ref<ExpertOverrideEditor[]>([])
const expertOverrideForm = reactive<ExpertOverrideEditor>({
  localDate: '',
  isUnavailable: true,
  startsAt: '09:00',
  endsAt: '17:00',
})
const widgetDraft = reactive<WidgetDraft>(blankWidgetDraft())
const widgetForm = reactive<WidgetDraft>(blankWidgetDraft())
const staffAppointmentForm = reactive({
  serviceId: '',
  expertUserId: '',
  localDate: '',
  notes: '',
  idempotencyKey: '',
})
const requestFetch = useRequestFetch()

const facilitiesRequest = useAsyncData<FacilityListPayload>(
  `facilities-${organizationSlug.value}`,
  () => requestFetch(orgApiPath('/facilities')),
  { default: (): FacilityListPayload => ({ data: [], role: 'expert', canCreate: false }) },
)
const teamsRequest = useAsyncData<Pick<TeamGraphPayload, 'teams'>>(
  `facility-teams-${organizationSlug.value}`,
  () => requestFetch(orgApiPath('/teams')),
  { default: (): Pick<TeamGraphPayload, 'teams'> => ({ teams: [] }) },
)
const organizationMembersRequest = useAsyncData<OrganizationMembersPayload>(
  `facility-members-${organizationSlug.value}`,
  () => requestFetch(orgApiPath('/members')),
  { default: (): OrganizationMembersPayload => ({ currentUserId: '', role: 'expert', canAssignOthers: false, members: [] }) },
)

const [facilitiesResource, teamsResource, organizationMembersResource] = await Promise.all([
  facilitiesRequest,
  teamsRequest,
  organizationMembersRequest,
])
const { data: facilitiesPayload, status: facilitiesStatus, error: facilitiesError, refresh: refreshFacilities } = facilitiesResource
const { data: teamsPayload } = teamsResource
const { data: organizationMembersPayload } = organizationMembersResource

watch(() => route.params.facilityId, (facilityId) => {
  selectedFacilityId.value = Array.isArray(facilityId)
    ? String(facilityId[0] ?? '')
    : String(facilityId ?? '')
}, { immediate: true })

const { data: workspace, status: workspaceStatus, error: workspaceError, refresh: refreshWorkspace } = await useLazyAsyncData<FacilityWorkspace>(
  `facility-workspace-${organizationSlug.value}`,
  async () => {
    const facilityId = selectedFacilityId.value
    if (!facilityId) return emptyWorkspace()
    const encodedFacilityId = encodeURIComponent(facilityId)
    const base = orgApiPath(`/facilities/${encodedFacilityId}`)
    const currentUserId = organizationMembersPayload.value.currentUserId

    const [detail, members, teamLinks, hours, services, widgets, facilityCalendar, expertCalendar] = await Promise.all([
      requestFetch<FacilityDetailPayload>(base),
      requestFetch<FacilityMembersPayload>(`${base}/members`),
      requestFetch<FacilityTeamLinksPayload>(`${base}/team-links`),
      requestFetch<FacilityHoursPayload>(`${base}/hours`),
      requestFetch<FacilityServicesPayload>(`${base}/services`),
      requestFetch<FacilityWidgetsPayload>(`${base}/widgets`),
      loadCalendarState('facility', facilityId),
      currentUserId
        ? loadCalendarState('expert', currentUserId)
        : Promise.resolve(emptyCalendarState()),
    ])

    return { detail, members, teamLinks, hours, services, widgets, facilityCalendar, expertCalendar }
  },
  {
    server: false,
    watch: [selectedFacilityId],
    default: emptyWorkspace,
  },
)

const {
  data: appointmentsPayload,
  status: appointmentsStatus,
  error: appointmentsError,
  refresh: refreshAppointments,
} = await useLazyAsyncData<FacilityAppointmentsPayload>(
  `facility-appointments-${organizationSlug.value}`,
  () => requestFetch<FacilityAppointmentsPayload>(orgApiPath('/appointments'), {
    query: {
      facilityId: selectedFacilityId.value,
      status: appointmentStatus.value === 'all' ? undefined : appointmentStatus.value,
      expertUserId: appointmentExpertId.value === 'all' ? undefined : appointmentExpertId.value,
      limit: appointmentPageSize,
      offset: appointmentOffset.value,
    },
  }),
  {
    watch: [selectedFacilityId, appointmentStatus, appointmentExpertId, appointmentOffset],
    default: (): FacilityAppointmentsPayload => ({ data: [], count: 0 }),
  },
)

const facilities = computed(() => facilitiesPayload.value.data)
const visibleFacilities = computed(() => {
  const query = facilitySearch.value.trim().toLocaleLowerCase('pl')
  if (!query) return facilities.value
  return facilities.value.filter(facility => [facility.name, facility.city, facility.slug]
    .some(value => String(value ?? '').toLocaleLowerCase('pl').includes(query)))
})
const selectedFacility = computed(() => workspace.value.detail?.data
  ?? facilities.value.find(facility => facility.id === selectedFacilityId.value)
  ?? null)
const access = computed(() => workspace.value.detail?.access ?? null)
const canManage = computed(() => Boolean(access.value?.canManage))
const workspacePending = computed(() => Boolean(selectedFacilityId.value)
  && (workspaceStatus.value === 'idle' || workspaceStatus.value === 'pending'))
const facilityMembers = computed(() => workspace.value.members.data)
const memberRows = computed(() => facilityMembers.value.map(member => ({
  member,
  draft: memberDrafts[member.user_id] ?? {
    role: member.role,
    isBookable: member.is_bookable,
    bookingPriority: member.booking_priority,
  },
})))
const facilityMemberIds = computed(() => new Set(facilityMembers.value.map(member => member.user_id)))
const linkedTeamIds = computed(() => new Set(workspace.value.teamLinks.data.map(link => link.team_id)))
const availableTeamItems = computed(() => teamsPayload.value.teams
  .filter(team => !linkedTeamIds.value.has(team.id))
  .map(team => ({ label: team.name, value: team.id })))
const availableOrganizationMemberItems = computed(() => organizationMembersPayload.value.members
  .filter(member => !facilityMemberIds.value.has(member.userId))
  .map(member => ({ label: member.fullName || member.email, value: member.userId })))
const bookableExperts = computed(() => facilityMembers.value.filter(member => member.is_bookable))
const expertItems = computed(() => bookableExperts.value.map(member => ({
  label: facilityMemberLabel(member),
  value: member.user_id,
})))
const currentUserId = computed(() => organizationMembersPayload.value.currentUserId)
const currentUserFacilityMember = computed(() => facilityMembers.value.find(member => (
  member.user_id === currentUserId.value
)) ?? null)
const canCreatePersonalWidget = computed(() => Boolean(currentUserFacilityMember.value?.is_bookable))
const canCreateWidget = computed(() => canManage.value || canCreatePersonalWidget.value)
const canEditSelectedExpert = computed(() => canManage.value
  || selectedExpertId.value === currentUserId.value)
const wholeFacilitySelection = '__whole_facility__'
const widgetExpertScopeSelection = computed({
  get: () => widgetForm.fixedExpertUserId || wholeFacilitySelection,
  set: value => { widgetForm.fixedExpertUserId = value === wholeFacilitySelection ? '' : value },
})
const activeServices = computed(() => workspace.value.services.data.filter(service => service.isAvailable && service.is_active))
const personalWidgetServices = computed(() => activeServices.value.filter(service => (
  service.expertUserIds.includes(currentUserId.value)
)))
const creatableWidgetServices = computed(() => {
  const fixedExpertUserId = canManage.value ? widgetForm.fixedExpertUserId : currentUserId.value
  if (!fixedExpertUserId) return activeServices.value
  return activeServices.value.filter(service => service.expertUserIds.includes(fixedExpertUserId))
})
const widgetExpertScopeItems = computed(() => [
  { label: 'Cała placówka', value: wholeFacilitySelection },
  ...expertItems.value.map(expert => ({
    label: `Ekspert: ${expert.label}`,
    value: expert.value,
  })),
])
const bookableExpertIds = computed(() => new Set(bookableExperts.value.map(member => member.user_id)))
const staffAppointmentServices = computed(() => activeServices.value.filter(service => (
  service.expertUserIds.some(userId => bookableExpertIds.value.has(userId))
)))
const selectedStaffAppointmentService = computed(() => activeServices.value.find(service => (
  service.id === staffAppointmentForm.serviceId
)) ?? null)
const staffAppointmentExpertItems = computed(() => {
  const allowedExpertIds = new Set(selectedStaffAppointmentService.value?.expertUserIds ?? [])
  return bookableExperts.value
    .filter(member => allowedExpertIds.has(member.user_id))
    .map(member => ({ label: facilityMemberLabel(member), value: member.user_id }))
})
const selectedWidget = computed(() => workspace.value.widgets.data.find(widget => widget.id === selectedWidgetId.value) ?? null)
const canEditSelectedWidget = computed(() => Boolean(selectedWidget.value) && (
  canManage.value || (
    currentUserFacilityMember.value?.is_bookable === true
    && selectedWidget.value?.fixed_expert_user_id === currentUserId.value
  )
))
const widgetServicesForEditor = computed(() => {
  const fixedExpertUserId = selectedWidget.value?.fixed_expert_user_id
  if (fixedExpertUserId) {
    return activeServices.value.filter(service => service.expertUserIds.includes(fixedExpertUserId))
  }
  return canManage.value || !canEditSelectedWidget.value
    ? activeServices.value
    : personalWidgetServices.value
})
const widgetItems = computed(() => workspace.value.widgets.data.map(widget => ({
  label: `${widget.name} · ${widgetTypeLabel(widget.widget_type)}${widget.fixed_expert_user_id === currentUserId.value ? ' · mój' : ''}`,
  value: widget.id,
})))
const widgetPreviewUrl = computed(() => selectedWidget.value
  ? absoluteUrl(selectedWidget.value.embedUrl || `/book/${selectedWidget.value.widgetKey}?embed=1`)
  : '')
const iframeSnippet = computed(() => selectedWidget.value?.embedCode || '')
const scriptSnippet = computed(() => {
  if (!selectedWidget.value) return ''
  return `<script src="${absoluteUrl('/booking-widget.js')}" data-openexpert-widget="${selectedWidget.value.widgetKey}" data-theme="${selectedWidget.value.theme}" async><\/script>`
})
const filteredAppointments = computed(() => appointmentsPayload.value.data)
const appointmentPageStart = computed(() => appointmentsPayload.value.count
  ? appointmentOffset.value + 1
  : 0)
const appointmentPageEnd = computed(() => Math.min(
  appointmentOffset.value + filteredAppointments.value.length,
  appointmentsPayload.value.count,
))
const facilityCalendarCards = computed<CalendarCard[]>(() => buildCalendarCards(workspace.value.facilityCalendar))
const expertCalendarCards = computed<CalendarCard[]>(() => buildCalendarCards(workspace.value.expertCalendar))

watch(() => workspace.value.detail?.data, (facility) => {
  if (!facility) return
  Object.assign(facilityForm, facilityToForm(facility))
}, { immediate: true })

watch([selectedFacilityId, appointmentStatus, appointmentExpertId], () => {
  appointmentOffset.value = 0
})

watch([selectedFacilityId, createAppointmentOpen], ([, isOpen]) => {
  if (!isOpen) return
  if (!staffAppointmentServices.value.some(service => service.id === staffAppointmentForm.serviceId)) {
    staffAppointmentForm.serviceId = staffAppointmentServices.value[0]?.id ?? ''
  }
})

watch(staffAppointmentExpertItems, (items) => {
  if (items.some(item => item.value === staffAppointmentForm.expertUserId)) return
  staffAppointmentForm.expertUserId = items[0]?.value ?? ''
}, { immediate: true })

watch(appointmentClientSearch, (value) => {
  const selected = selectedAppointmentClient.value
  if (selected && value.trim() !== selected.display_name) selectedAppointmentClient.value = null
})

watch(
  () => [
    createAppointmentOpen.value,
    selectedFacilityId.value,
    staffAppointmentForm.serviceId,
    staffAppointmentForm.expertUserId,
    staffAppointmentForm.localDate,
  ],
  () => { void loadStaffAppointmentSlots() },
)

watch(facilityMembers, (members) => {
  for (const key of Object.keys(memberDrafts)) delete memberDrafts[key]
  for (const member of members) {
    memberDrafts[member.user_id] = {
      role: member.role,
      isBookable: member.is_bookable,
      bookingPriority: member.booking_priority,
    }
  }
}, { immediate: true })

watch(() => workspace.value.hours, hydrateOpeningHours, { immediate: true })

watch(bookableExperts, (experts) => {
  if (experts.some(member => member.user_id === selectedExpertId.value)) return
  const currentUserId = organizationMembersPayload.value.currentUserId
  selectedExpertId.value = experts.find(member => member.user_id === currentUserId)?.user_id ?? experts[0]?.user_id ?? ''
}, { immediate: true })

watch([selectedFacilityId, selectedExpertId], () => {
  if (import.meta.client) void loadExpertSchedule()
}, { immediate: true })

watch(() => workspace.value.widgets.data, (widgets) => {
  if (!widgets.some(widget => widget.id === selectedWidgetId.value)) selectedWidgetId.value = widgets[0]?.id ?? ''
}, { immediate: true })

watch(selectedWidget, (widget) => {
  Object.assign(widgetDraft, widget ? widgetToDraft(widget) : blankWidgetDraft())
}, { immediate: true })

watch(() => widgetForm.fixedExpertUserId, (fixedExpertUserId) => {
  if (fixedExpertUserId) widgetForm.bookingMode = 'expert'
  widgetForm.serviceIds = creatableWidgetServices.value.map(service => service.id)
})

function blankFacilityForm(): FacilityForm {
  return {
    name: '',
    slug: '',
    timezone: 'Europe/Warsaw',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    countryCode: 'PL',
    phone: '',
    email: '',
    isActive: true,
  }
}

function blankWidgetDraft(): WidgetDraft {
  return {
    name: '',
    title: 'Umów spotkanie',
    subtitle: '',
    theme: 'auto',
    accentColor: '#171717',
    allowedOrigins: '',
    bookingMode: 'both',
    widgetType: 'calendar',
    fixedExpertUserId: '',
    locale: 'pl-PL',
    isActive: true,
    serviceIds: [],
  }
}

function blankWeek(): DayEditor[] {
  return weekdayLabels.map((label, weekday) => ({
    weekday,
    label,
    enabled: weekday < 5,
    periods: [{ startsAt: '09:00', endsAt: '17:00' }],
  }))
}

function emptyCalendarState(): CalendarState {
  return { available: false, data: { data: [], providers: [] }, error: '' }
}

function emptyWorkspace(): FacilityWorkspace {
  return {
    detail: null,
    members: { data: [] },
    teamLinks: { data: [] },
    hours: { openingHours: [], overrides: [] },
    services: { data: [], catalog: [] },
    widgets: { data: [] },
    facilityCalendar: emptyCalendarState(),
    expertCalendar: emptyCalendarState(),
  }
}

async function loadCalendarState(ownerKind: 'facility' | 'expert', ownerId: string): Promise<CalendarState> {
  try {
    const data = await requestFetch<FacilityCalendarConnectionsPayload>(orgApiPath('/calendar-connections'), {
      query: { ownerKind, ownerId },
    })
    return { available: true, data, error: '' }
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number; status?: number }).statusCode
      ?? (error as { status?: number }).status
    return {
      available: false,
      data: { data: [], providers: [] },
      error: statusCode === 404 ? '' : apiErrorMessage(error),
    }
  }
}

function facilityToForm(facility: Facility): FacilityForm {
  return {
    name: facility.name,
    slug: facility.slug,
    timezone: facility.timezone,
    addressLine1: facility.address_line1 ?? '',
    addressLine2: facility.address_line2 ?? '',
    postalCode: facility.postal_code ?? '',
    city: facility.city ?? '',
    countryCode: facility.country_code || 'PL',
    phone: facility.phone ?? '',
    email: facility.email ?? '',
    isActive: facility.is_active,
  }
}

function facilityPayload(form: FacilityForm) {
  return {
    name: form.name.trim(),
    slug: form.slug.trim() || undefined,
    timezone: form.timezone,
    addressLine1: form.addressLine1.trim() || null,
    addressLine2: form.addressLine2.trim() || null,
    postalCode: form.postalCode.trim() || null,
    city: form.city.trim() || null,
    countryCode: form.countryCode.trim().toUpperCase(),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    isActive: form.isActive,
  }
}

function widgetToDraft(widget: BookingWidget): WidgetDraft {
  return {
    name: widget.name,
    title: widget.title,
    subtitle: widget.subtitle ?? '',
    theme: widget.theme,
    accentColor: widget.accent_color || '#171717',
    allowedOrigins: (widget.allowed_origins ?? []).join('\n'),
    bookingMode: widget.booking_mode,
    widgetType: widget.widget_type,
    fixedExpertUserId: widget.fixed_expert_user_id ?? '',
    locale: widget.locale || 'pl-PL',
    isActive: widget.is_active,
    serviceIds: widget.serviceIds.filter(serviceId => (
      activeServices.value.some(service => service.id === serviceId)
    )),
  }
}

function parseOrigins(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

function trimTime(value: string | null | undefined, fallback = '09:00') {
  return value ? value.slice(0, 5) : fallback
}

function hydrateOpeningHours(hours: FacilityHoursPayload) {
  openingDays.value = weekdayLabels.map((label, weekday) => {
    const periods = hours.openingHours
      .filter(period => period.weekday === weekday && period.is_active)
      .map(period => ({ startsAt: trimTime(period.opens_at), endsAt: trimTime(period.closes_at, '17:00') }))
    return {
      weekday,
      label,
      enabled: periods.length > 0,
      periods: periods.length ? periods : [{ startsAt: '09:00', endsAt: '17:00' }],
    }
  })
  openingOverrides.value = hours.overrides.map((item) => {
    return {
      localDate: item.local_date,
      isClosed: item.is_closed,
      opensAt: trimTime(item.opens_at),
      closesAt: trimTime(item.closes_at, '17:00'),
    }
  })
}

function hydrateExpertSchedule(payload: { rules: Array<Record<string, any>>, overrides: Array<Record<string, any>> }) {
  expertDays.value = weekdayLabels.map((label, weekday) => {
    const periods = payload.rules
      .filter(rule => Number(rule.weekday) === weekday && rule.is_active !== false)
      .map(rule => ({
        startsAt: trimTime(String(rule.starts_at ?? rule.startsAt ?? '09:00')),
        endsAt: trimTime(String(rule.ends_at ?? rule.endsAt ?? '17:00'), '17:00'),
      }))
    return {
      weekday,
      label,
      enabled: periods.length > 0,
      periods: periods.length ? periods : [{ startsAt: '09:00', endsAt: '17:00' }],
    }
  })
  expertOverrides.value = payload.overrides.map((item) => {
    return {
      localDate: String(item.local_date ?? item.localDate ?? ''),
      isUnavailable: Boolean(item.is_unavailable ?? item.isUnavailable),
      startsAt: trimTime(item.starts_at ?? item.startsAt),
      endsAt: trimTime(item.ends_at ?? item.endsAt, '17:00'),
    }
  })
}

function selectFacility(facilityId: string) {
  selectedFacilityId.value = facilityId
  activeSection.value = 'overview'
}

function changeAppointmentPage(delta: number) {
  appointmentOffset.value = Math.max(0, appointmentOffset.value + delta * appointmentPageSize)
}

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function staffSlotTime(slot: StaffAppointmentSlot) {
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: selectedFacility.value?.timezone || 'Europe/Warsaw',
  }).format(new Date(slot.startsAt))
}

function openCreateAppointment() {
  const timezone = selectedFacility.value?.timezone || 'Europe/Warsaw'
  staffAppointmentForm.serviceId = staffAppointmentServices.value[0]?.id ?? ''
  staffAppointmentForm.expertUserId = ''
  staffAppointmentForm.localDate = dateInTimezone(timezone)
  staffAppointmentForm.notes = ''
  staffAppointmentForm.idempotencyKey = ''
  staffAppointmentIdempotencyIntent.value = ''
  appointmentClientSearch.value = ''
  appointmentClientResults.value = []
  selectedAppointmentClient.value = null
  selectedStaffAppointmentSlot.value = null
  staffAppointmentSlots.value = []
  staffAppointmentSlotsError.value = ''
  createAppointmentOpen.value = true
  void searchAppointmentClients()
}

async function searchAppointmentClients() {
  const requestId = ++appointmentClientRequestId
  appointmentClientPending.value = true
  try {
    const result = await $fetch<{ data: AppointmentClientOption[] }>(crmApiPath('/clients'), {
      query: {
        q: appointmentClientSearch.value.trim() || undefined,
        limit: 12,
      },
    })
    if (requestId !== appointmentClientRequestId) return
    appointmentClientResults.value = result.data ?? []
  } catch (error: unknown) {
    if (requestId !== appointmentClientRequestId) return
    appointmentClientResults.value = []
    showActionError('Nie udało się wyszukać klientów', error)
  } finally {
    if (requestId === appointmentClientRequestId) appointmentClientPending.value = false
  }
}

function chooseAppointmentClient(client: AppointmentClientOption) {
  selectedAppointmentClient.value = client
  appointmentClientSearch.value = client.display_name
}

async function loadStaffAppointmentSlots() {
  const requestId = ++staffSlotsRequestId
  selectedStaffAppointmentSlot.value = null
  staffAppointmentSlots.value = []
  staffAppointmentSlotsError.value = ''
  if (
    !createAppointmentOpen.value
    || !selectedFacilityId.value
    || !staffAppointmentForm.serviceId
    || !staffAppointmentForm.expertUserId
    || !staffAppointmentForm.localDate
  ) {
    staffAppointmentSlotsPending.value = false
    return
  }
  staffAppointmentSlotsPending.value = true
  try {
    const result = await $fetch<{ slots: StaffAppointmentSlot[] }>(
      orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/appointment-slots`),
      {
        query: {
          serviceId: staffAppointmentForm.serviceId,
          expertUserId: staffAppointmentForm.expertUserId,
          date: staffAppointmentForm.localDate,
        },
      },
    )
    if (requestId !== staffSlotsRequestId) return
    staffAppointmentSlots.value = result.slots ?? []
  } catch (error: unknown) {
    if (requestId !== staffSlotsRequestId) return
    staffAppointmentSlotsError.value = apiErrorMessage(error)
  } finally {
    if (requestId === staffSlotsRequestId) staffAppointmentSlotsPending.value = false
  }
}

async function createStaffAppointment() {
  const client = selectedAppointmentClient.value
  const slot = selectedStaffAppointmentSlot.value
  if (
    !client
    || !slot
    || !selectedFacilityId.value
    || !staffAppointmentForm.serviceId
    || !staffAppointmentForm.expertUserId
  ) return

  const intent = JSON.stringify({
    facilityId: selectedFacilityId.value,
    serviceId: staffAppointmentForm.serviceId,
    expertUserId: staffAppointmentForm.expertUserId,
    clientId: client.id,
    startsAt: slot.startsAt,
    notes: staffAppointmentForm.notes.trim() || null,
  })
  if (staffAppointmentIdempotencyIntent.value !== intent) {
    staffAppointmentIdempotencyIntent.value = intent
    staffAppointmentForm.idempotencyKey = crypto.randomUUID()
  }

  savingAppointment.value = true
  try {
    await $fetch(orgApiPath('/appointments'), {
      method: 'POST',
      body: {
        facilityId: selectedFacilityId.value,
        serviceId: staffAppointmentForm.serviceId,
        expertUserId: staffAppointmentForm.expertUserId,
        clientId: client.id,
        startsAt: slot.startsAt,
        notes: staffAppointmentForm.notes.trim() || null,
        idempotencyKey: staffAppointmentForm.idempotencyKey,
      },
    })
    createAppointmentOpen.value = false
    await refreshAppointments()
    toast.add({
      title: 'Wizyta została umówiona',
      description: `${client.display_name} · ${staffSlotTime(slot)}`,
      color: 'success',
      icon: 'i-lucide-calendar-check-2',
    })
  } catch (error: unknown) {
    showActionError('Nie udało się umówić wizyty', error)
    const candidate = error as {
      statusCode?: number
      status?: number
      response?: { status?: number }
      data?: { statusMessage?: string }
      message?: string
    }
    const statusCode = Number(
      candidate.statusCode ?? candidate.status ?? candidate.response?.status ?? 0,
    )
    const detail = candidate.data?.statusMessage || candidate.message || ''
    if (statusCode === 409 && /slot|termin|available/i.test(detail)) {
      await loadStaffAppointmentSlots()
    }
  } finally {
    savingAppointment.value = false
  }
}

function facilityAddress(facility: Facility | null) {
  if (!facility) return ''
  return [facility.address_line1, facility.address_line2, [facility.postal_code, facility.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
}

function facilityMemberLabel(member: FacilityMember) {
  return member.user?.full_name || member.user?.email || member.user_id
}

function memberRoleLabel(role: 'admin' | 'member') {
  return role === 'admin' ? 'Administrator' : 'Członek'
}

function accessSourceLabel(source: string | undefined) {
  if (source === 'organization_admin') return 'administrator organizacji'
  if (source === 'facility') return 'członkostwo placówki'
  if (source === 'team') return 'dostęp przez zespół'
  return 'dostęp do placówki'
}

function appointmentStatusLabel(status: Appointment['status']) {
  if (status === 'confirmed') return 'Potwierdzona'
  if (status === 'hold') return 'Rezerwacja czasowa'
  return 'Anulowana'
}

function appointmentStatusColor(status: Appointment['status']) {
  if (status === 'confirmed') return 'success' as const
  if (status === 'hold') return 'warning' as const
  return 'neutral' as const
}

function calendarStatusLabel(status: string | undefined) {
  if (status === 'active' || status === 'connected') return 'Połączony'
  if (status === 'pending') return 'Łączenie'
  if (status === 'reconnect_required') return 'Wymaga ponownego połączenia'
  if (status === 'revoked') return 'Dostęp odwołany'
  if (status === 'error') return 'Błąd'
  return 'Niepołączony'
}

function calendarStatusColor(status: string | undefined) {
  if (status === 'active' || status === 'connected') return 'success' as const
  if (status === 'pending') return 'warning' as const
  if (status === 'error' || status === 'reconnect_required' || status === 'revoked') return 'error' as const
  return 'neutral' as const
}

function isCalendarConnected(connection: CalendarConnection | null) {
  return connection?.status === 'active' || connection?.status === 'connected'
}

function widgetModeDescription(mode: WidgetDraft['bookingMode']) {
  if (mode === 'facility') return 'Klient wybiera termin, a system może przypisać dowolnego dostępnego eksperta placówki.'
  if (mode === 'expert') return 'Klient musi najpierw wskazać konkretnego eksperta.'
  return 'Klient może wybrać eksperta albo pozostawić wybór dowolnemu dostępnemu ekspertowi placówki.'
}

function widgetTypeLabel(type: BookingWidgetType) {
  return widgetTypeItems.find(item => item.value === type)?.label ?? 'Kalendarz'
}

function widgetTypeDescription(type: BookingWidgetType) {
  return widgetTypeItems.find(item => item.value === type)?.description ?? ''
}

function widgetExpertLabel(userId: string | null | undefined) {
  if (!userId) return 'Cała placówka'
  const expert = bookableExperts.value.find(member => member.user_id === userId)
  return expert ? facilityMemberLabel(expert) : 'Przypisany ekspert'
}

function calendarConnectLabel(card: CalendarCard) {
  const providerLabel = card.provider === 'google' ? 'Google Calendar' : 'Outlook'
  return card.connection ? `Połącz ponownie z ${providerLabel}` : `Synchronizuj z ${providerLabel}`
}

function connectionFor(state: CalendarState, provider: CalendarProvider) {
  return state.data.data.find(connection => connection.provider === provider) ?? null
}

function providerOptionFor(state: CalendarState, provider: CalendarProvider) {
  return state.data.providers?.find(option => option.provider === provider) ?? null
}

function providerEnabled(state: CalendarState, provider: CalendarProvider) {
  const option = providerOptionFor(state, provider)
  return state.available && (option ? option.enabled : true)
}

function buildCalendarCards(state: CalendarState): CalendarCard[] {
  return calendarProviderItems.map(item => ({
    ...item,
    enabled: providerEnabled(state, item.provider),
    connection: connectionFor(state, item.provider),
  }))
}

function connectionEmail(connection: CalendarConnection | null) {
  return connection?.providerAccountEmail ?? connection?.provider_account_email ?? ''
}

function connectionCalendarName(connection: CalendarConnection | null) {
  return connection?.externalCalendarName ?? connection?.external_calendar_name ?? ''
}

function connectionLastSync(connection: CalendarConnection | null) {
  return connection?.lastSyncedAt ?? connection?.last_synced_at ?? null
}

function connectionError(connection: CalendarConnection | null) {
  return connection?.errorMessage ?? connection?.error_message ?? ''
}

function formatDateTime(value: string | null | undefined, timezone = selectedFacility.value?.timezone || 'Europe/Warsaw') {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value))
}

function absoluteUrl(value: string) {
  try {
    return new URL(value, currentUrl.origin).toString()
  } catch {
    return value
  }
}

function apiErrorMessage(error: unknown) {
  const candidate = error as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }
  return candidate.data?.statusMessage
    || candidate.data?.message
    || candidate.statusMessage
    || candidate.message
    || 'Nie udało się wykonać operacji.'
}

function showActionError(title: string, error: unknown) {
  toast.add({
    title,
    description: apiErrorMessage(error),
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
}

function addPeriod(day: DayEditor) {
  day.periods.push({ startsAt: '09:00', endsAt: '17:00' })
}

function openCreateFacility() {
  createFacilityOpen.value = true
}

function openCreateWidget() {
  Object.assign(widgetForm, blankWidgetDraft(), canManage.value
    ? {}
    : {
        fixedExpertUserId: currentUserId.value,
        bookingMode: 'expert' as const,
      })
  widgetForm.serviceIds = creatableWidgetServices.value.map(service => service.id)
  createWidgetOpen.value = true
}

function removeOpeningOverride(index: number) {
  openingOverrides.value.splice(index, 1)
}

function removeExpertOverride(index: number) {
  expertOverrides.value.splice(index, 1)
}

function removePeriod(day: DayEditor, index: number) {
  if (day.periods.length === 1) {
    day.enabled = false
    return
  }
  day.periods.splice(index, 1)
}

async function createFacility() {
  if (!facilitiesPayload.value.canCreate || !createFacilityForm.name.trim()) return
  savingFacility.value = true
  try {
    const result = await $fetch<{ data: Facility }>(orgApiPath('/facilities'), {
      method: 'POST',
      body: facilityPayload(createFacilityForm),
    })
    Object.assign(createFacilityForm, blankFacilityForm())
    createFacilityOpen.value = false
    await refreshFacilities()
    selectedFacilityId.value = result.data.id
    await refreshWorkspace()
    toast.add({ title: 'Placówka została utworzona', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error: unknown) {
    showActionError('Nie udało się utworzyć placówki', error)
  } finally {
    savingFacility.value = false
  }
}

async function saveFacility() {
  if (!canManage.value || !selectedFacilityId.value) return
  savingFacility.value = true
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}`), {
      method: 'PATCH',
      body: facilityPayload(facilityForm),
    })
    await Promise.all([refreshFacilities(), refreshWorkspace()])
    toast.add({ title: 'Dane placówki zostały zapisane', color: 'success', icon: 'i-lucide-save' })
  } catch (error: unknown) {
    showActionError('Nie udało się zapisać placówki', error)
  } finally {
    savingFacility.value = false
  }
}

async function addTeamLink() {
  if (!canManage.value || !teamToLink.value || !selectedFacilityId.value) return
  savingTeamLink.value = true
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/team-links`), {
      method: 'POST',
      body: { teamId: teamToLink.value },
    })
    teamToLink.value = ''
    await refreshWorkspace()
    toast.add({ title: 'Zespół został powiązany z placówką', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się powiązać zespołu', error)
  } finally {
    savingTeamLink.value = false
  }
}

async function removeTeamLink(teamId: string) {
  if (!canManage.value || !selectedFacilityId.value) return
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/team-links/${encodeURIComponent(teamId)}`), {
      method: 'DELETE',
    })
    await refreshWorkspace()
    toast.add({ title: 'Powiązanie z zespołem zostało usunięte', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się usunąć powiązania', error)
  }
}

async function addFacilityMember() {
  if (!canManage.value || !memberForm.userId || !selectedFacilityId.value) return
  savingMember.value = true
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/members`), {
      method: 'POST',
      body: { ...memberForm },
    })
    Object.assign(memberForm, { userId: '', role: 'member', isBookable: true, bookingPriority: 100 })
    await refreshWorkspace()
    toast.add({ title: 'Członek został dodany do placówki', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się dodać członka', error)
  } finally {
    savingMember.value = false
  }
}

async function saveFacilityMember(userId: string) {
  const draft = memberDrafts[userId]
  if (!canManage.value || !draft || !selectedFacilityId.value) return
  savingMember.value = true
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/members/${encodeURIComponent(userId)}`), {
      method: 'PATCH',
      body: draft,
    })
    await refreshWorkspace()
    toast.add({ title: 'Uprawnienia członka zostały zapisane', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się zapisać członka', error)
  } finally {
    savingMember.value = false
  }
}

async function removeFacilityMember(userId: string) {
  if (!canManage.value || !selectedFacilityId.value) return
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/members/${encodeURIComponent(userId)}`), {
      method: 'DELETE',
    })
    await refreshWorkspace()
    toast.add({ title: 'Członek został usunięty z placówki', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się usunąć członka', error)
  }
}

function addOpeningOverride() {
  if (!openingOverrideForm.localDate) return
  openingOverrides.value = [
    ...openingOverrides.value.filter(override => override.localDate !== openingOverrideForm.localDate),
    { ...openingOverrideForm },
  ].sort((left, right) => left.localDate.localeCompare(right.localDate))
  Object.assign(openingOverrideForm, { localDate: '', isClosed: true, opensAt: '09:00', closesAt: '17:00' })
}

async function saveOpeningHours() {
  if (!canManage.value || !selectedFacilityId.value) return
  savingHours.value = true
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/hours`), {
      method: 'PUT',
      body: {
        openingHours: openingDays.value.flatMap(day => day.enabled
          ? day.periods.map(period => ({
              weekday: day.weekday,
              opensAt: period.startsAt,
              closesAt: period.endsAt,
              isActive: true,
            }))
          : []),
        overrides: openingOverrides.value.map(override => ({
          localDate: override.localDate,
          isClosed: override.isClosed,
          opensAt: override.isClosed ? null : override.opensAt,
          closesAt: override.isClosed ? null : override.closesAt,
        })),
      },
    })
    await refreshWorkspace()
    toast.add({ title: 'Godziny otwarcia zostały zapisane', color: 'success', icon: 'i-lucide-clock-3' })
  } catch (error: unknown) {
    showActionError('Nie udało się zapisać godzin otwarcia', error)
  } finally {
    savingHours.value = false
  }
}

async function loadExpertSchedule() {
  const requestId = ++expertScheduleRequestId
  const facilityId = selectedFacilityId.value
  const expertId = selectedExpertId.value
  if (!facilityId || !expertId) {
    expertDays.value = blankWeek().map(day => ({ ...day, enabled: false }))
    expertOverrides.value = []
    expertSchedulePending.value = false
    return
  }
  expertSchedulePending.value = true
  expertScheduleError.value = ''
  try {
    const payload = await $fetch<{ rules: Array<Record<string, any>>, overrides: Array<Record<string, any>> }>(
      orgApiPath(`/facilities/${encodeURIComponent(facilityId)}/expert-schedules`),
      { query: { userId: expertId } },
    )
    if (
      requestId !== expertScheduleRequestId
      || facilityId !== selectedFacilityId.value
      || expertId !== selectedExpertId.value
    ) return
    hydrateExpertSchedule(payload)
  } catch (error: unknown) {
    if (requestId !== expertScheduleRequestId) return
    expertScheduleError.value = apiErrorMessage(error)
  } finally {
    if (requestId === expertScheduleRequestId) expertSchedulePending.value = false
  }
}

function copyFacilityHoursToExpert() {
  expertDays.value = openingDays.value.map(day => ({
    ...day,
    periods: day.periods.map(period => ({ ...period })),
  }))
}

function addExpertOverride() {
  if (!expertOverrideForm.localDate) return
  expertOverrides.value = [
    ...expertOverrides.value.filter(override => override.localDate !== expertOverrideForm.localDate),
    { ...expertOverrideForm },
  ].sort((left, right) => left.localDate.localeCompare(right.localDate))
  Object.assign(expertOverrideForm, { localDate: '', isUnavailable: true, startsAt: '09:00', endsAt: '17:00' })
}

async function saveExpertSchedule() {
  if (!canEditSelectedExpert.value || !selectedFacilityId.value || !selectedExpertId.value) return
  savingExpertSchedule.value = true
  try {
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/expert-schedules`), {
      method: 'PUT',
      body: {
        userId: selectedExpertId.value,
        rules: expertDays.value.flatMap(day => day.enabled
          ? day.periods.map(period => ({
              weekday: day.weekday,
              startsAt: period.startsAt,
              endsAt: period.endsAt,
              validFrom: null,
              validUntil: null,
              isActive: true,
            }))
          : []),
        overrides: expertOverrides.value.map(override => ({
          localDate: override.localDate,
          isUnavailable: override.isUnavailable,
          startsAt: override.isUnavailable ? null : override.startsAt,
          endsAt: override.isUnavailable ? null : override.endsAt,
        })),
      },
    })
    await loadExpertSchedule()
    toast.add({ title: 'Grafik eksperta został zapisany', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się zapisać grafiku eksperta', error)
  } finally {
    savingExpertSchedule.value = false
  }
}

async function createWidget() {
  if (
    !canCreateWidget.value
    || !selectedFacilityId.value
    || !widgetForm.name.trim()
    || !widgetForm.serviceIds.length
  ) return
  savingWidget.value = true
  try {
    const fixedExpertUserId = canManage.value
      ? widgetForm.fixedExpertUserId
      : currentUserId.value
    const allowedServiceIds = new Set(creatableWidgetServices.value.map(service => service.id))
    const result = await $fetch<{ data: BookingWidget }>(
      orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/widgets`),
      {
        method: 'POST',
        body: {
          ...widgetForm,
          fixedExpertUserId: fixedExpertUserId || null,
          bookingMode: fixedExpertUserId ? 'expert' : widgetForm.bookingMode,
          serviceIds: [...allowedServiceIds],
          subtitle: widgetForm.subtitle.trim() || null,
          allowedOrigins: parseOrigins(widgetForm.allowedOrigins),
        },
      },
    )
    Object.assign(widgetForm, blankWidgetDraft())
    createWidgetOpen.value = false
    await refreshWorkspace()
    selectedWidgetId.value = result.data.id
    toast.add({ title: 'Widget rezerwacji został utworzony', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się utworzyć widgetu', error)
  } finally {
    savingWidget.value = false
  }
}

async function saveWidget() {
  if (!canEditSelectedWidget.value || !selectedFacilityId.value || !selectedWidget.value) return
  savingWidget.value = true
  try {
    const allowedServiceIds = new Set(widgetServicesForEditor.value.map(service => service.id))
    await $fetch(
      orgApiPath(`/facilities/${encodeURIComponent(selectedFacilityId.value)}/widgets/${encodeURIComponent(selectedWidget.value.id)}`),
      {
        method: 'PATCH',
        body: {
          name: widgetDraft.name,
          title: widgetDraft.title,
          theme: widgetDraft.theme,
          accentColor: widgetDraft.accentColor,
          widgetType: widgetDraft.widgetType,
          locale: widgetDraft.locale,
          isActive: widgetDraft.isActive,
          bookingMode: selectedWidget.value.fixed_expert_user_id ? 'expert' : widgetDraft.bookingMode,
          serviceIds: [...allowedServiceIds],
          subtitle: widgetDraft.subtitle.trim() || null,
          allowedOrigins: parseOrigins(widgetDraft.allowedOrigins),
        },
      },
    )
    await refreshWorkspace()
    toast.add({ title: 'Widget został zapisany', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się zapisać widgetu', error)
  } finally {
    savingWidget.value = false
  }
}

async function copyText(value: string, label: string) {
  if (!value || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: `${label} skopiowany`, color: 'success', icon: 'i-lucide-copy-check' })
  } catch (error: unknown) {
    showActionError('Nie udało się skopiować kodu', error)
  }
}

function connectCalendar(
  state: CalendarState,
  provider: CalendarProvider,
  ownerKind: 'facility' | 'expert',
  ownerId: string,
) {
  if (!import.meta.client || !providerEnabled(state, provider)) return
  const returnTo = `/org/${organizationSlug.value}/facilities/${selectedFacilityId.value}?section=calendars`
  const path = `${orgApiPath(`/calendar-connections/${provider}/connect`)}?${new URLSearchParams({
    ownerKind,
    ownerId,
    returnTo,
  }).toString()}`
  window.location.assign(path)
}

async function syncCalendar(connection: CalendarConnection) {
  syncingConnectionId.value = connection.id
  try {
    await $fetch(orgApiPath(`/calendar-connections/${encodeURIComponent(connection.id)}/sync`), { method: 'POST' })
    await refreshWorkspace()
    toast.add({ title: 'Synchronizacja została uruchomiona', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się uruchomić synchronizacji', error)
  } finally {
    syncingConnectionId.value = ''
  }
}

function askDisconnect(connection: CalendarConnection) {
  connectionToDisconnect.value = connection
  disconnectOpen.value = true
}

async function disconnectCalendar() {
  const connection = connectionToDisconnect.value
  if (!connection) return
  try {
    await $fetch(orgApiPath(`/calendar-connections/${encodeURIComponent(connection.id)}`), { method: 'DELETE' })
    disconnectOpen.value = false
    connectionToDisconnect.value = null
    await refreshWorkspace()
    toast.add({ title: 'Kalendarz został odłączony', color: 'success' })
  } catch (error: unknown) {
    showActionError('Nie udało się odłączyć kalendarza', error)
  }
}
</script>

<template>
  <CrmShell title="Szczegóły placówki" eyebrow="Administracja organizacji · placówki">
    <template #actions>
      <UButton
        :to="orgPath('/facilities')"
        color="neutral"
        variant="outline"
        icon="i-lucide-arrow-left"
      >
        Wszystkie placówki
      </UButton>
    </template>

    <UAlert
      v-if="facilitiesError"
      color="error"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać placówek"
      :description="apiErrorMessage(facilitiesError)"
    />

    <section class="facility-workspace">
        <div v-if="!selectedFacilityId" class="workspace-empty">
          <UIcon name="i-lucide-map-pinned" />
          <h2>Wybierz placówkę</h2>
          <p>Po wybraniu skonfigurujesz jej zespół, dostępność, widget rezerwacji i kalendarze.</p>
        </div>

        <div v-else-if="workspacePending" class="workspace-loading">
          <USkeleton class="h-28 w-full" />
          <USkeleton class="h-12 w-full" />
          <USkeleton class="h-96 w-full" />
        </div>

        <UAlert
          v-else-if="workspaceError"
          color="error"
          icon="i-lucide-circle-alert"
          title="Nie udało się otworzyć placówki"
          :description="apiErrorMessage(workspaceError)"
        />

        <template v-else-if="selectedFacility">
          <header class="workspace-header">
            <div class="workspace-header__identity">
              <div class="workspace-header__mark">
                <UIcon name="i-lucide-building-2" />
              </div>
              <div>
                <div class="workspace-header__title">
                  <h2>{{ selectedFacility.name }}</h2>
                  <UBadge :color="selectedFacility.is_active ? 'success' : 'neutral'" variant="subtle">
                    {{ selectedFacility.is_active ? 'Aktywna' : 'Nieaktywna' }}
                  </UBadge>
                </div>
                <p>{{ facilityAddress(selectedFacility) || 'Adres nie został jeszcze uzupełniony' }}</p>
              </div>
            </div>
            <div class="workspace-header__meta">
              <span>{{ selectedFacility.timezone }}</span>
              <span>·</span>
              <span>{{ accessSourceLabel(access?.source) }}</span>
              <UBadge :color="canManage ? 'primary' : 'neutral'" variant="outline">
                {{ canManage ? 'Możesz zarządzać' : 'Tylko odczyt' }}
              </UBadge>
            </div>
          </header>

          <UAlert
            v-if="!canManage"
            color="neutral"
            variant="subtle"
            icon="i-lucide-eye"
            title="Dostęp tylko do odczytu"
            description="Dane placówki zmienia jej administrator. Nadal możesz zarządzać własnym grafikiem i kalendarzem, jeśli jesteś członkiem tej placówki."
          />

          <div class="workspace-tabs">
            <UTabs v-model="activeSection" :items="sectionItems" class="w-full" />
          </div>

          <section v-if="activeSection === 'overview'" class="workspace-section">
            <div class="section-heading">
              <div>
                <p class="section-kicker">Dane placówki</p>
                <h3>Tożsamość i dane kontaktowe</h3>
                <p>Informacje widoczne w rezerwacjach i komunikacji z klientem.</p>
              </div>
            </div>

            <form class="form-stack" @submit.prevent="saveFacility">
              <div class="form-grid form-grid--two">
                <UFormField name="facilityName" label="Nazwa" required>
                  <UInput v-model="facilityForm.name" class="w-full" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilitySlug" label="Slug" description="Stabilny identyfikator w adresach URL.">
                  <UInput v-model="facilityForm.slug" class="w-full" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilityTimezone" label="Strefa czasowa" required>
                  <USelect v-model="facilityForm.timezone" :items="timezoneItems" class="w-full" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilityCountry" label="Kod kraju">
                  <UInput v-model="facilityForm.countryCode" class="w-full" maxlength="2" :disabled="!canManage" />
                </UFormField>
              </div>

              <div class="form-grid form-grid--two">
                <UFormField name="facilityAddress1" label="Adres">
                  <UInput v-model="facilityForm.addressLine1" class="w-full" placeholder="Ulica i numer" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilityAddress2" label="Dodatkowy adres">
                  <UInput v-model="facilityForm.addressLine2" class="w-full" placeholder="Lokal, piętro" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilityPostalCode" label="Kod pocztowy">
                  <UInput v-model="facilityForm.postalCode" class="w-full" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilityCity" label="Miasto">
                  <UInput v-model="facilityForm.city" class="w-full" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilityPhone" label="Telefon">
                  <UInput v-model="facilityForm.phone" class="w-full" type="tel" :disabled="!canManage" />
                </UFormField>
                <UFormField name="facilityEmail" label="E-mail">
                  <UInput v-model="facilityForm.email" class="w-full" type="email" :disabled="!canManage" />
                </UFormField>
              </div>

              <div class="switch-row">
                <div>
                  <strong>Placówka aktywna</strong>
                  <p>Nieaktywna placówka nie powinna przyjmować nowych rezerwacji.</p>
                </div>
                <USwitch v-model="facilityForm.isActive" :disabled="!canManage" aria-label="Placówka aktywna" />
              </div>

              <div v-if="canManage" class="form-actions">
                <UButton type="submit" icon="i-lucide-save" :loading="savingFacility">
                  Zapisz dane placówki
                </UButton>
              </div>
            </form>
          </section>

          <section v-else-if="activeSection === 'people'" class="workspace-section">
            <div class="section-heading">
              <div>
                <p class="section-kicker">Dostęp</p>
                <h3>Zespoły i członkowie placówki</h3>
                <p>Zespół daje dostęp organizacyjny, a członkostwo określa rolę i możliwość przyjmowania wizyt.</p>
              </div>
            </div>

            <div class="content-grid content-grid--split">
              <article class="panel-card">
                <div class="panel-card__head">
                  <div>
                    <h4>Powiązane zespoły</h4>
                    <p>{{ workspace.teamLinks.data.length }} aktywnych powiązań</p>
                  </div>
                  <UIcon name="i-lucide-network" />
                </div>

                <UAlert
                  v-if="!canManage"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-lock-keyhole"
                  title="Zarządza administrator placówki"
                  description="Powiązania zespołów zmienia administrator placówki lub organizacji."
                />

                <div v-if="workspace.teamLinks.data.length" class="compact-list">
                  <div v-for="link in workspace.teamLinks.data" :key="link.team_id" class="compact-row">
                    <span class="compact-row__icon"><UIcon name="i-lucide-users-round" /></span>
                    <div>
                      <strong>{{ link.team?.name || link.team_id }}</strong>
                      <small>{{ link.team?.kind || 'zespół' }}</small>
                    </div>
                    <UButton
                      v-if="canManage"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-unlink"
                      square
                      aria-label="Usuń powiązanie zespołu"
                      @click="removeTeamLink(link.team_id)"
                    />
                  </div>
                </div>
                <p v-else class="empty-line">Brak powiązanych zespołów.</p>

                <div v-if="canManage" class="inline-form">
                  <UFormField name="teamToLink" label="Dodaj zespół" class="inline-form__field">
                    <USelect
                      v-model="teamToLink"
                      :items="availableTeamItems"
                      value-key="value"
                      class="w-full"
                      placeholder="Wybierz zespół"
                    />
                  </UFormField>
                  <UButton
                    icon="i-lucide-link"
                    :disabled="!teamToLink"
                    :loading="savingTeamLink"
                    @click="addTeamLink"
                  >
                    Powiąż
                  </UButton>
                </div>
              </article>

              <article class="panel-card">
                <div class="panel-card__head">
                  <div>
                    <h4>Dodaj członka</h4>
                    <p>Bezpośrednia rola w placówce</p>
                  </div>
                  <UIcon name="i-lucide-user-plus" />
                </div>

                <div v-if="canManage" class="form-stack form-stack--compact">
                  <UFormField name="newFacilityMember" label="Użytkownik">
                    <USelect
                      v-model="memberForm.userId"
                      :items="availableOrganizationMemberItems"
                      value-key="value"
                      class="w-full"
                      placeholder="Wybierz członka organizacji"
                    />
                  </UFormField>
                  <div class="form-grid form-grid--two">
                    <UFormField name="newFacilityMemberRole" label="Rola">
                      <USelect v-model="memberForm.role" :items="roleItems" value-key="value" class="w-full" />
                    </UFormField>
                    <UFormField name="newFacilityMemberPriority" label="Priorytet przydziału">
                      <UInputNumber v-model="memberForm.bookingPriority" :min="0" :max="10000" class="w-full" />
                    </UFormField>
                  </div>
                  <div class="switch-row switch-row--compact">
                    <div>
                      <strong>Może przyjmować rezerwacje</strong>
                      <p>Użytkownik pojawi się jako ekspert w grafiku.</p>
                    </div>
                    <USwitch v-model="memberForm.isBookable" />
                  </div>
                  <UButton
                    icon="i-lucide-user-plus"
                    :disabled="!memberForm.userId"
                    :loading="savingMember"
                    @click="addFacilityMember"
                  >
                    Dodaj do placówki
                  </UButton>
                </div>
                <p v-else class="empty-line">Nie masz uprawnień do dodawania członków.</p>
              </article>
            </div>

            <div class="member-list">
              <article v-for="row in memberRows" :key="row.member.user_id" class="member-card">
                <div class="member-card__identity">
                  <UAvatar :alt="facilityMemberLabel(row.member)" size="lg" />
                  <div>
                    <strong>{{ facilityMemberLabel(row.member) }}</strong>
                    <p>{{ row.member.user?.email || row.member.user_id }}</p>
                    <UBadge color="neutral" variant="subtle">{{ memberRoleLabel(row.member.role) }}</UBadge>
                  </div>
                </div>
                <div class="member-card__settings">
                  <UFormField :name="`memberRole-${row.member.user_id}`" label="Rola">
                    <USelect
                      v-model="row.draft.role"
                      :items="roleItems"
                      value-key="value"
                      class="w-full"
                      :disabled="!canManage"
                    />
                  </UFormField>
                  <UFormField :name="`memberPriority-${row.member.user_id}`" label="Priorytet">
                    <UInputNumber
                      v-model="row.draft.bookingPriority"
                      :min="0"
                      :max="10000"
                      class="w-full"
                      :disabled="!canManage"
                    />
                  </UFormField>
                  <div class="member-card__bookable">
                    <span>Rezerwacje</span>
                    <USwitch v-model="row.draft.isBookable" :disabled="!canManage" />
                  </div>
                </div>
                <div v-if="canManage" class="member-card__actions">
                  <UButton
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-save"
                    :loading="savingMember"
                    @click="saveFacilityMember(row.member.user_id)"
                  >
                    Zapisz
                  </UButton>
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-user-minus"
                    square
                    aria-label="Usuń członka placówki"
                    @click="removeFacilityMember(row.member.user_id)"
                  />
                </div>
              </article>
              <div v-if="!memberRows.length" class="workspace-empty workspace-empty--small">
                <UIcon name="i-lucide-users" />
                <p>Ta placówka nie ma jeszcze bezpośrednich członków.</p>
              </div>
            </div>
          </section>

          <section v-else-if="activeSection === 'hours'" class="workspace-section">
            <div class="section-heading section-heading--actions">
              <div>
                <p class="section-kicker">Dostępność placówki</p>
                <h3>Godziny otwarcia</h3>
                <p>Każdy dzień może zawierać kilka przedziałów, np. z przerwą w środku dnia.</p>
              </div>
              <UButton v-if="canManage" icon="i-lucide-save" :loading="savingHours" @click="saveOpeningHours">
                Zapisz godziny
              </UButton>
            </div>

            <div class="schedule-card">
              <div v-for="day in openingDays" :key="day.weekday" class="schedule-day">
                <div class="schedule-day__label">
                  <USwitch v-model="day.enabled" :disabled="!canManage" :aria-label="`${day.label} otwarte`" />
                  <strong>{{ day.label }}</strong>
                </div>
                <div v-if="day.enabled" class="schedule-day__periods">
                  <div v-for="(period, index) in day.periods" :key="`${day.weekday}-${index}`" class="period-row">
                    <UInput v-model="period.startsAt" type="time" :disabled="!canManage" aria-label="Godzina otwarcia" />
                    <span>—</span>
                    <UInput v-model="period.endsAt" type="time" :disabled="!canManage" aria-label="Godzina zamknięcia" />
                    <UButton
                      v-if="canManage"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-x"
                      square
                      aria-label="Usuń przedział"
                      @click="removePeriod(day, index)"
                    />
                    <UButton
                      v-if="canManage && index === day.periods.length - 1"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-plus"
                      square
                      aria-label="Dodaj przedział"
                      title="Dodaj przedział"
                      @click="addPeriod(day)"
                    />
                  </div>
                </div>
                <span v-else class="schedule-day__closed">Zamknięte</span>
              </div>
            </div>

            <div class="subsection-heading">
              <div>
                <h4>Wyjątki w kalendarzu</h4>
                <p>Święta, dni zamknięte lub niestandardowe godziny.</p>
              </div>
            </div>

            <div v-if="canManage" class="override-form">
              <UFormField name="openingOverrideDate" label="Data">
                <UInput v-model="openingOverrideForm.localDate" type="date" />
              </UFormField>
              <div class="override-form__switch">
                <span>Zamknięte</span>
                <USwitch v-model="openingOverrideForm.isClosed" />
              </div>
              <UFormField v-if="!openingOverrideForm.isClosed" name="openingOverrideFrom" label="Od">
                <UInput v-model="openingOverrideForm.opensAt" type="time" />
              </UFormField>
              <UFormField v-if="!openingOverrideForm.isClosed" name="openingOverrideTo" label="Do">
                <UInput v-model="openingOverrideForm.closesAt" type="time" />
              </UFormField>
              <UButton icon="i-lucide-plus" :disabled="!openingOverrideForm.localDate" @click="addOpeningOverride">
                Dodaj wyjątek
              </UButton>
            </div>

            <div v-if="openingOverrides.length" class="override-list">
              <div v-for="(override, index) in openingOverrides" :key="override.localDate" class="override-row">
                <UIcon :name="override.isClosed ? 'i-lucide-calendar-x-2' : 'i-lucide-calendar-clock'" />
                <strong>{{ override.localDate }}</strong>
                <span>{{ override.isClosed ? 'Zamknięte' : `${override.opensAt}–${override.closesAt}` }}</span>
                <UButton
                  v-if="canManage"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  square
                  aria-label="Usuń wyjątek"
                  @click="removeOpeningOverride(index)"
                />
              </div>
            </div>
            <p v-else class="empty-line">Brak wyjątków w godzinach otwarcia.</p>
          </section>

          <section v-else-if="activeSection === 'experts'" class="workspace-section">
            <div class="section-heading">
              <div>
                <p class="section-kicker">Rezerwacje</p>
                <h3>Grafiki ekspertów</h3>
                <p>Dostępny termin jest przecięciem godzin placówki, grafiku eksperta i wolnego czasu.</p>
              </div>
            </div>

            <article class="panel-card panel-card--wide">
              <div class="panel-card__head panel-card__head--actions">
                <div>
                  <h4>Grafik eksperta</h4>
                  <p>Regularna dostępność i wyjątki dla wybranej osoby.</p>
                </div>
                <div class="panel-card__controls">
                  <USelect
                    v-model="selectedExpertId"
                    :items="expertItems"
                    value-key="value"
                    class="expert-select"
                    placeholder="Wybierz eksperta"
                  />
                  <UButton
                    v-if="selectedExpertId && canEditSelectedExpert"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-copy"
                    @click="copyFacilityHoursToExpert"
                  >
                    Kopiuj godziny placówki
                  </UButton>
                  <UButton
                    v-if="selectedExpertId && canEditSelectedExpert"
                    icon="i-lucide-save"
                    :loading="savingExpertSchedule"
                    :disabled="expertSchedulePending"
                    @click="saveExpertSchedule"
                  >
                    Zapisz grafik
                  </UButton>
                </div>
              </div>

              <UAlert
                v-if="selectedExpertId && !canEditSelectedExpert"
                color="neutral"
                variant="subtle"
                icon="i-lucide-eye"
                title="Grafik tylko do odczytu"
                description="Możesz edytować własny grafik. Grafik innego eksperta zmienia administrator placówki."
              />
              <UAlert
                v-if="expertScheduleError"
                color="error"
                icon="i-lucide-circle-alert"
                title="Nie udało się pobrać grafiku"
                :description="expertScheduleError"
              />

              <div v-if="expertSchedulePending" class="form-stack">
                <USkeleton v-for="index in 5" :key="index" class="h-14 w-full" />
              </div>
              <div v-else-if="selectedExpertId" class="schedule-card schedule-card--nested">
                <div v-for="day in expertDays" :key="day.weekday" class="schedule-day">
                  <div class="schedule-day__label">
                    <USwitch
                      v-model="day.enabled"
                      :disabled="!canEditSelectedExpert"
                      :aria-label="`${day.label} dostępny`"
                    />
                    <strong>{{ day.label }}</strong>
                  </div>
                  <div v-if="day.enabled" class="schedule-day__periods">
                    <div v-for="(period, index) in day.periods" :key="`${day.weekday}-${index}`" class="period-row">
                      <UInput v-model="period.startsAt" type="time" :disabled="!canEditSelectedExpert" aria-label="Dostępny od" />
                      <span>—</span>
                      <UInput v-model="period.endsAt" type="time" :disabled="!canEditSelectedExpert" aria-label="Dostępny do" />
                      <UButton
                        v-if="canEditSelectedExpert"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-x"
                        square
                        aria-label="Usuń przedział"
                        @click="removePeriod(day, index)"
                      />
                      <UButton
                        v-if="canEditSelectedExpert && index === day.periods.length - 1"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-plus"
                        square
                        aria-label="Dodaj przedział"
                        title="Dodaj przedział"
                        @click="addPeriod(day)"
                      />
                    </div>
                  </div>
                  <span v-else class="schedule-day__closed">Niedostępny</span>
                </div>
              </div>
              <div v-else class="workspace-empty workspace-empty--small">
                <UIcon name="i-lucide-user-round-search" />
                <p>Oznacz członka jako przyjmującego rezerwacje, aby utworzyć jego grafik.</p>
              </div>

              <template v-if="selectedExpertId">
                <div v-if="canEditSelectedExpert" class="override-form override-form--expert">
                  <UFormField name="expertOverrideDate" label="Wyjątek dnia">
                    <UInput v-model="expertOverrideForm.localDate" type="date" />
                  </UFormField>
                  <div class="override-form__switch">
                    <span>Niedostępny cały dzień</span>
                    <USwitch v-model="expertOverrideForm.isUnavailable" />
                  </div>
                  <UFormField v-if="!expertOverrideForm.isUnavailable" name="expertOverrideFrom" label="Od">
                    <UInput v-model="expertOverrideForm.startsAt" type="time" />
                  </UFormField>
                  <UFormField v-if="!expertOverrideForm.isUnavailable" name="expertOverrideTo" label="Do">
                    <UInput v-model="expertOverrideForm.endsAt" type="time" />
                  </UFormField>
                  <UButton icon="i-lucide-plus" :disabled="!expertOverrideForm.localDate" @click="addExpertOverride">
                    Dodaj
                  </UButton>
                </div>
                <div v-if="expertOverrides.length" class="override-list">
                  <div v-for="(override, index) in expertOverrides" :key="override.localDate" class="override-row">
                    <UIcon :name="override.isUnavailable ? 'i-lucide-calendar-x-2' : 'i-lucide-calendar-clock'" />
                    <strong>{{ override.localDate }}</strong>
                    <span>{{ override.isUnavailable ? 'Niedostępny' : `${override.startsAt}–${override.endsAt}` }}</span>
                    <UButton
                      v-if="canEditSelectedExpert"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      square
                      aria-label="Usuń wyjątek eksperta"
                      @click="removeExpertOverride(index)"
                    />
                  </div>
                </div>
              </template>
            </article>

          </section>

          <section v-else-if="activeSection === 'widget'" class="workspace-section">
            <div class="section-heading section-heading--actions">
              <div>
                <p class="section-kicker">Rezerwacje online</p>
                <h3>Widgety rezerwacyjne</h3>
                <p>Wybierz kalkulator zdolności, kalkulator raty albo kalendarz i skopiuj kod osadzenia.</p>
              </div>
              <UButton v-if="canCreateWidget" icon="i-lucide-plus" @click="openCreateWidget">
                Nowy widget
              </UButton>
            </div>

            <UAlert
              v-if="canCreatePersonalWidget && !canManage"
              color="neutral"
              variant="subtle"
              icon="i-lucide-user-round-check"
              title="Możesz utworzyć własny widget"
              description="Widget będzie automatycznie przypisany do Ciebie i pokaże Twoje wolne terminy w tej placówce."
            />

            <div v-if="workspace.widgets.data.length" class="widget-layout">
              <div class="form-stack">
                <UFormField name="selectedWidget" label="Konfiguracja widgetu">
                  <USelect v-model="selectedWidgetId" :items="widgetItems" value-key="value" class="w-full" />
                </UFormField>

                <template v-if="selectedWidget">
                  <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-calendar-user"
                    :title="selectedWidget.fixed_expert_user_id ? `Widget eksperta: ${widgetExpertLabel(selectedWidget.fixed_expert_user_id)}` : 'Widget całej placówki'"
                    :description="selectedWidget.fixed_expert_user_id ? 'Klient rezerwuje spotkanie bezpośrednio z przypisanym ekspertem.' : 'Klient może wybrać eksperta zgodnie z konfiguracją widgetu.'"
                  />

                  <div class="form-grid form-grid--two">
                    <UFormField name="widgetType" label="Typ widgetu" :description="widgetTypeDescription(widgetDraft.widgetType)">
                      <USelect
                        v-model="widgetDraft.widgetType"
                        :items="widgetTypeItems"
                        value-key="value"
                        class="w-full"
                        :disabled="!canEditSelectedWidget"
                      />
                    </UFormField>
                    <UFormField name="widgetName" label="Nazwa wewnętrzna">
                      <UInput v-model="widgetDraft.name" class="w-full" :disabled="!canEditSelectedWidget" />
                    </UFormField>
                    <UFormField name="widgetLocale" label="Kod języka" description="Metadane widgetu; obecny formularz jest dostępny po polsku.">
                      <UInput v-model="widgetDraft.locale" class="w-full" :disabled="!canEditSelectedWidget" />
                    </UFormField>
                    <UFormField name="widgetTitle" label="Nagłówek">
                      <UInput v-model="widgetDraft.title" class="w-full" :disabled="!canEditSelectedWidget" />
                    </UFormField>
                    <UFormField name="widgetSubtitle" label="Podtytuł">
                      <UInput v-model="widgetDraft.subtitle" class="w-full" :disabled="!canEditSelectedWidget" />
                    </UFormField>
                    <UFormField name="widgetTheme" label="Motyw">
                      <USelect v-model="widgetDraft.theme" :items="themeItems" value-key="value" class="w-full" :disabled="!canEditSelectedWidget" />
                    </UFormField>
                    <UFormField name="widgetAccent" label="Kolor akcentu">
                      <UInput v-model="widgetDraft.accentColor" class="w-full" type="color" :disabled="!canEditSelectedWidget" />
                    </UFormField>
                  </div>

                  <UFormField name="widgetMode" label="Sposób wyboru eksperta" :description="widgetModeDescription(widgetDraft.bookingMode)">
                    <USelect
                      v-model="widgetDraft.bookingMode"
                      :items="bookingModeItems"
                      value-key="value"
                      class="w-full"
                      :disabled="!canEditSelectedWidget || Boolean(selectedWidget.fixed_expert_user_id)"
                    />
                  </UFormField>

                  <UFormField
                    name="widgetOrigins"
                    label="Dozwolone domeny"
                    description="Jedna domena w wierszu. Puste pole pozwala użyć widgetu bez ograniczenia domeny."
                  >
                    <UTextarea v-model="widgetDraft.allowedOrigins" class="w-full" :rows="3" :disabled="!canEditSelectedWidget" placeholder="https://example.pl" />
                  </UFormField>

                  <div class="switch-row switch-row--compact">
                    <div>
                      <strong>Widget aktywny</strong>
                      <p>Nieaktywny widget nie powinien przyjmować nowych rezerwacji.</p>
                    </div>
                    <USwitch v-model="widgetDraft.isActive" :disabled="!canEditSelectedWidget" />
                  </div>

                  <div v-if="canEditSelectedWidget" class="form-actions">
                    <UButton icon="i-lucide-save" :loading="savingWidget" @click="saveWidget">
                      Zapisz widget
                    </UButton>
                  </div>
                </template>
              </div>

              <div v-if="selectedWidget" class="widget-preview-column">
                <div class="widget-preview-head">
                  <div>
                    <strong>Podgląd</strong>
                    <p>Osadzony formularz placówki</p>
                  </div>
                  <UButton
                    :to="absoluteUrl(selectedWidget.publicUrl)"
                    target="_blank"
                    external
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-external-link"
                  >
                    Otwórz stronę
                  </UButton>
                </div>
                <div class="widget-preview-frame">
                  <iframe :src="widgetPreviewUrl" :title="`Podgląd widgetu ${selectedWidget.name}`" loading="lazy" />
                </div>
              </div>
            </div>

            <div v-else class="workspace-empty workspace-empty--small">
              <UIcon name="i-lucide-code-xml" />
              <p>Utwórz widget, aby rozpocząć przyjmowanie rezerwacji online.</p>
              <UButton v-if="canCreateWidget" icon="i-lucide-plus" variant="outline" @click="openCreateWidget">
                Utwórz widget
              </UButton>
            </div>

            <div v-if="selectedWidget" class="embed-grid">
              <article class="code-card">
                <div class="code-card__head">
                  <div>
                    <strong>Iframe</strong>
                    <p>Pełny formularz osadzony w wybranym miejscu strony.</p>
                  </div>
                  <UButton color="neutral" variant="ghost" icon="i-lucide-copy" @click="copyText(iframeSnippet, 'Kod iframe')">
                    Kopiuj
                  </UButton>
                </div>
                <pre><code>{{ iframeSnippet }}</code></pre>
              </article>
              <article class="code-card">
                <div class="code-card__head">
                  <div>
                    <strong>Responsywny skrypt osadzający</strong>
                    <p>Skrypt wstawia formularz inline i automatycznie dopasowuje jego wysokość.</p>
                  </div>
                  <UButton color="neutral" variant="ghost" icon="i-lucide-copy" @click="copyText(scriptSnippet, 'Kod skryptu')">
                    Kopiuj
                  </UButton>
                </div>
                <pre><code>{{ scriptSnippet }}</code></pre>
              </article>
            </div>
          </section>

          <section v-else-if="activeSection === 'calendars'" class="workspace-section">
            <div class="section-heading">
              <div>
                <p class="section-kicker">Integracje</p>
                <h3>Synchronizacja kalendarzy</h3>
                <p>Połączenia służą do wykrywania zajętości i docelowo dwukierunkowej synchronizacji spotkań.</p>
              </div>
            </div>

            <article class="calendar-context">
              <div class="calendar-context__head">
                <div class="calendar-context__icon"><UIcon name="i-lucide-building-2" /></div>
                <div>
                  <h4>Kalendarz placówki</h4>
                  <p>Wspólne blokady i zdarzenia dla {{ selectedFacility.name }}.</p>
                </div>
                <UBadge color="neutral" variant="subtle">Tylko administrator placówki</UBadge>
              </div>

              <UAlert
                v-if="!canManage"
                color="neutral"
                variant="subtle"
                icon="i-lucide-lock-keyhole"
                title="Nie możesz zmieniać kalendarza placówki"
                description="Połączeniem zarządza administrator placówki lub organizacji."
              />
              <UAlert
                v-else-if="workspace.facilityCalendar.error"
                color="error"
                icon="i-lucide-circle-alert"
                title="Nie udało się sprawdzić integracji"
                :description="workspace.facilityCalendar.error"
              />
              <UAlert
                v-else-if="!workspace.facilityCalendar.available"
                color="neutral"
                variant="subtle"
                icon="i-lucide-plug-zap"
                title="Integracje kalendarza placówki nie są jeszcze dostępne"
                description="Przyciski pojawią się, gdy backend integracji zostanie skonfigurowany."
              />

              <div v-if="canManage" class="calendar-grid">
                <article v-for="card in facilityCalendarCards" :key="`facility-${card.provider}`" class="calendar-card">
                  <div class="calendar-card__head">
                    <span class="calendar-card__provider"><UIcon :name="card.icon" /></span>
                    <div>
                      <strong>{{ card.label }}</strong>
                      <p>Kalendarz wspólny placówki</p>
                    </div>
                    <UBadge :color="calendarStatusColor(card.connection?.status)" variant="subtle">
                      {{ card.enabled ? calendarStatusLabel(card.connection?.status) : 'Niedostępny' }}
                    </UBadge>
                  </div>

                  <dl v-if="card.connection" class="calendar-card__details">
                    <div><dt>Konto</dt><dd>{{ connectionEmail(card.connection) || '—' }}</dd></div>
                    <div><dt>Kalendarz</dt><dd>{{ connectionCalendarName(card.connection) || 'Domyślny' }}</dd></div>
                    <div><dt>Ostatnia synchronizacja</dt><dd>{{ formatDateTime(connectionLastSync(card.connection)) }}</dd></div>
                  </dl>
                  <p v-else class="calendar-card__empty">Połącz konto, aby uwzględniać zdarzenia w dostępności placówki.</p>
                  <UAlert
                    v-if="connectionError(card.connection)"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    title="Błąd synchronizacji"
                    :description="connectionError(card.connection)"
                  />

                  <div class="calendar-card__actions">
                    <UButton
                      v-if="!isCalendarConnected(card.connection)"
                      :disabled="!card.enabled"
                      :icon="card.provider === 'google' ? 'i-lucide-calendar-plus' : 'i-lucide-calendar-plus-2'"
                      @click="connectCalendar(workspace.facilityCalendar, card.provider, 'facility', selectedFacility.id)"
                    >
                      {{ calendarConnectLabel(card) }}
                    </UButton>
                    <UButton
                      v-if="isCalendarConnected(card.connection) && card.connection"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-refresh-cw"
                      :loading="syncingConnectionId === card.connection.id"
                      @click="syncCalendar(card.connection)"
                    >
                      Synchronizuj teraz
                    </UButton>
                    <UButton
                      v-if="card.connection"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-unlink"
                      @click="askDisconnect(card.connection)"
                    >
                      Odłącz
                    </UButton>
                  </div>
                </article>
              </div>
            </article>

            <article class="calendar-context">
              <div class="calendar-context__head">
                <div class="calendar-context__icon"><UIcon name="i-lucide-user-round" /></div>
                <div>
                  <h4>Mój kalendarz eksperta</h4>
                  <p>Prywatna zajętość bieżącego użytkownika w tej placówce.</p>
                </div>
                <UBadge color="primary" variant="subtle">Twoje połączenie</UBadge>
              </div>

              <UAlert
                v-if="!currentUserFacilityMember"
                color="neutral"
                variant="subtle"
                icon="i-lucide-user-round-x"
                title="Nie jesteś członkiem tej placówki"
                description="Własny kalendarz może połączyć każdy bezpośredni członek placówki."
              />
              <UAlert
                v-else-if="workspace.expertCalendar.error"
                color="error"
                icon="i-lucide-circle-alert"
                title="Nie udało się sprawdzić Twoich integracji"
                :description="workspace.expertCalendar.error"
              />
              <UAlert
                v-else-if="!workspace.expertCalendar.available"
                color="neutral"
                variant="subtle"
                icon="i-lucide-plug-zap"
                title="Integracje kalendarza eksperta nie są jeszcze dostępne"
                description="Przyciski pojawią się, gdy backend integracji zostanie skonfigurowany."
              />

              <div v-if="currentUserFacilityMember" class="calendar-grid">
                <article v-for="card in expertCalendarCards" :key="`expert-${card.provider}`" class="calendar-card">
                  <div class="calendar-card__head">
                    <span class="calendar-card__provider"><UIcon :name="card.icon" /></span>
                    <div>
                      <strong>{{ card.label }}</strong>
                      <p>Osobisty kalendarz eksperta</p>
                    </div>
                    <UBadge :color="calendarStatusColor(card.connection?.status)" variant="subtle">
                      {{ card.enabled ? calendarStatusLabel(card.connection?.status) : 'Niedostępny' }}
                    </UBadge>
                  </div>

                  <dl v-if="card.connection" class="calendar-card__details">
                    <div><dt>Konto</dt><dd>{{ connectionEmail(card.connection) || '—' }}</dd></div>
                    <div><dt>Kalendarz</dt><dd>{{ connectionCalendarName(card.connection) || 'Domyślny' }}</dd></div>
                    <div><dt>Ostatnia synchronizacja</dt><dd>{{ formatDateTime(connectionLastSync(card.connection)) }}</dd></div>
                  </dl>
                  <p v-else class="calendar-card__empty">Połącz swoje konto, aby prywatne zajęte terminy blokowały rezerwacje.</p>
                  <UAlert
                    v-if="connectionError(card.connection)"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    title="Błąd synchronizacji"
                    :description="connectionError(card.connection)"
                  />

                  <div class="calendar-card__actions">
                    <UButton
                      v-if="!isCalendarConnected(card.connection)"
                      :disabled="!card.enabled"
                      icon="i-lucide-calendar-plus"
                      @click="connectCalendar(workspace.expertCalendar, card.provider, 'expert', organizationMembersPayload.currentUserId)"
                    >
                      {{ calendarConnectLabel(card) }}
                    </UButton>
                    <UButton
                      v-if="isCalendarConnected(card.connection) && card.connection"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-refresh-cw"
                      :loading="syncingConnectionId === card.connection.id"
                      @click="syncCalendar(card.connection)"
                    >
                      Synchronizuj teraz
                    </UButton>
                    <UButton
                      v-if="card.connection"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-unlink"
                      @click="askDisconnect(card.connection)"
                    >
                      Odłącz
                    </UButton>
                  </div>
                </article>
              </div>
            </article>
          </section>

          <section v-else-if="activeSection === 'appointments'" class="workspace-section">
            <div class="section-heading section-heading--actions">
              <div>
                <p class="section-kicker">Terminarz</p>
                <h3>Wizyty w placówce</h3>
                <p>{{ appointmentsPayload.count }} wizyt dla bieżących filtrów.</p>
              </div>
              <div class="appointment-filters">
                <UButton
                  icon="i-lucide-calendar-plus-2"
                  :disabled="!staffAppointmentServices.length"
                  @click="openCreateAppointment"
                >
                  Umów wizytę
                </UButton>
                <USelect
                  v-model="appointmentStatus"
                  :items="appointmentStatusItems"
                  value-key="value"
                  aria-label="Filtr statusu wizyt"
                />
                <USelect
                  v-model="appointmentExpertId"
                  :items="[{ label: 'Wszyscy eksperci', value: 'all' }, ...expertItems]"
                  value-key="value"
                  aria-label="Filtr eksperta"
                />
              </div>
            </div>

            <div v-if="appointmentsStatus === 'pending'" class="appointment-list">
              <USkeleton v-for="index in 3" :key="index" class="h-24 w-full" />
            </div>
            <UAlert
              v-else-if="appointmentsError"
              color="error"
              variant="subtle"
              icon="i-lucide-calendar-x-2"
              title="Nie udało się pobrać wizyt"
              :description="apiErrorMessage(appointmentsError)"
            />
            <div v-else-if="filteredAppointments.length" class="appointment-list">
              <article v-for="appointment in filteredAppointments" :key="appointment.id" class="appointment-card">
                <div class="appointment-card__date">
                  <UIcon name="i-lucide-calendar-clock" />
                  <div>
                    <strong>{{ formatDateTime(appointment.starts_at, appointment.timezone) }}</strong>
                    <small>do {{ formatDateTime(appointment.ends_at, appointment.timezone) }}</small>
                  </div>
                </div>
                <div class="appointment-card__customer">
                  <NuxtLink :to="orgPath(`/clients/${appointment.client_id}`)">
                    <strong>{{ appointment.customer_name }}</strong>
                  </NuxtLink>
                  <a :href="`mailto:${appointment.customer_email}`">{{ appointment.customer_email }}</a>
                  <span v-if="appointment.customer_phone">{{ appointment.customer_phone }}</span>
                </div>
                <div class="appointment-card__service">
                  <strong>{{ appointment.serviceName }}</strong>
                  <span>{{ appointment.expertName || 'Ekspert przypisywany automatycznie' }}</span>
                </div>
                <UBadge :color="appointmentStatusColor(appointment.status)" variant="subtle">
                  {{ appointmentStatusLabel(appointment.status) }}
                </UBadge>
                <p v-if="appointment.notes" class="appointment-card__notes">{{ appointment.notes }}</p>
              </article>
            </div>
            <div v-if="appointmentsPayload.count > appointmentPageSize" class="pagination-row">
              <span>Pozycje {{ appointmentPageStart }}–{{ appointmentPageEnd }} z {{ appointmentsPayload.count }}</span>
              <div>
                <UButton
                  icon="i-lucide-chevron-left"
                  color="neutral"
                  variant="outline"
                  :disabled="appointmentOffset === 0"
                  @click="changeAppointmentPage(-1)"
                >Poprzednie</UButton>
                <UButton
                  trailing-icon="i-lucide-chevron-right"
                  color="neutral"
                  variant="outline"
                  :disabled="appointmentPageEnd >= appointmentsPayload.count"
                  @click="changeAppointmentPage(1)"
                >Następne</UButton>
              </div>
            </div>
            <div v-if="appointmentsStatus !== 'pending' && !appointmentsError && !filteredAppointments.length" class="workspace-empty workspace-empty--small">
              <UIcon name="i-lucide-calendar-check-2" />
              <p>Brak wizyt pasujących do wybranych filtrów.</p>
            </div>
          </section>
        </template>
      </section>

    <UModal
      v-model:open="createAppointmentOpen"
      title="Umów wizytę z klientem"
      description="Wybierz klienta CRM, eksperta i dostępny termin."
      :ui="{ content: 'sm:max-w-4xl', footer: 'justify-end' }"
    >
      <template #body>
        <form id="create-appointment-form" class="form-stack" @submit.prevent="createStaffAppointment">
          <section class="appointment-booking-section">
            <div class="appointment-booking-section__heading">
              <span>1</span>
              <div>
                <h3>Klient</h3>
                <p>Każda wizyta musi wskazywać istniejący obiekt klienta.</p>
              </div>
            </div>
            <UFormField name="appointmentClient" label="Wyszukaj klienta" required>
              <UFieldGroup class="w-full">
                <UInput
                  v-model="appointmentClientSearch"
                  class="w-full"
                  icon="i-lucide-search"
                  placeholder="Nazwa, e-mail lub telefon"
                  @keydown.enter.prevent="searchAppointmentClients"
                />
                <UButton
                  type="button"
                  color="neutral"
                  variant="outline"
                  :loading="appointmentClientPending"
                  @click="searchAppointmentClients"
                >
                  Szukaj
                </UButton>
              </UFieldGroup>
            </UFormField>
            <div v-if="appointmentClientPending" class="appointment-client-results">
              <USkeleton v-for="index in 3" :key="index" class="h-14 w-full" />
            </div>
            <div v-else-if="appointmentClientResults.length" class="appointment-client-results">
              <button
                v-for="client in appointmentClientResults"
                :key="client.id"
                type="button"
                class="appointment-client-option"
                :class="{ 'appointment-client-option--selected': selectedAppointmentClient?.id === client.id }"
                :aria-pressed="selectedAppointmentClient?.id === client.id"
                @click="chooseAppointmentClient(client)"
              >
                <span>
                  <strong>{{ client.display_name }}</strong>
                  <small>{{ client.primary_email || client.primary_phone || 'Brak danych kontaktowych' }}</small>
                </span>
                <CrmStatusBadge :status="client.status_code" />
              </button>
            </div>
            <UAlert
              v-else
              color="neutral"
              variant="subtle"
              icon="i-lucide-user-search"
              title="Nie znaleziono klienta"
              description="Dodaj klienta wraz ze zgodami w module klientów, a następnie wróć do umawiania wizyty."
              :actions="[{ label: 'Przejdź do klientów', to: orgPath('/clients') }]"
            />
          </section>

          <section class="appointment-booking-section">
            <div class="appointment-booking-section__heading">
              <span>2</span>
              <div>
                <h3>Ekspert i dzień</h3>
                <p>Dostępność uwzględnia godziny placówki, grafik eksperta i kalendarze zewnętrzne.</p>
              </div>
            </div>
            <div class="form-grid form-grid--two">
              <UFormField name="appointmentExpert" label="Ekspert" required>
                <USelect
                  v-model="staffAppointmentForm.expertUserId"
                  class="w-full"
                  :items="staffAppointmentExpertItems"
                  value-key="value"
                  placeholder="Wybierz eksperta"
                />
              </UFormField>
              <UFormField name="appointmentDate" label="Data" required>
                <UInput
                  v-model="staffAppointmentForm.localDate"
                  class="w-full"
                  type="date"
                  :min="dateInTimezone(selectedFacility?.timezone || 'Europe/Warsaw')"
                />
              </UFormField>
            </div>
          </section>

          <section class="appointment-booking-section">
            <div class="appointment-booking-section__heading">
              <span>3</span>
              <div>
                <h3>Dostępny termin</h3>
                <p>Wybierz konkretną godzinę spotkania.</p>
              </div>
            </div>
            <div v-if="staffAppointmentSlotsPending" class="staff-slot-grid">
              <USkeleton v-for="index in 6" :key="index" class="h-14 w-full" />
            </div>
            <UAlert
              v-else-if="staffAppointmentSlotsError"
              color="error"
              variant="subtle"
              :description="staffAppointmentSlotsError"
            />
            <div v-else-if="staffAppointmentSlots.length" class="staff-slot-grid" role="radiogroup" aria-label="Dostępne terminy">
              <button
                v-for="slot in staffAppointmentSlots"
                :key="`${slot.startsAt}-${slot.expertUserId}`"
                type="button"
                class="staff-slot"
                :class="{ 'staff-slot--selected': selectedStaffAppointmentSlot?.startsAt === slot.startsAt && selectedStaffAppointmentSlot?.expertUserId === slot.expertUserId }"
                role="radio"
                :aria-checked="selectedStaffAppointmentSlot?.startsAt === slot.startsAt && selectedStaffAppointmentSlot?.expertUserId === slot.expertUserId"
                @click="selectedStaffAppointmentSlot = slot"
              >
                <strong>{{ staffSlotTime(slot) }}</strong>
                <small>{{ slot.expertName }}</small>
              </button>
            </div>
            <div v-else class="workspace-empty workspace-empty--small">
              <UIcon name="i-lucide-calendar-x-2" />
              <p>Brak wolnych terminów dla wybranego dnia.</p>
            </div>
          </section>

          <UFormField name="appointmentNotes" label="Notatka do wizyty" hint="Opcjonalnie">
            <UTextarea v-model="staffAppointmentForm.notes" class="w-full" :rows="3" autoresize :maxrows="6" />
          </UFormField>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="create-appointment-form"
          icon="i-lucide-calendar-check-2"
          :disabled="appointmentClientPending || !selectedAppointmentClient || !selectedStaffAppointmentSlot || !staffAppointmentForm.serviceId || !staffAppointmentForm.expertUserId"
          :loading="savingAppointment"
        >
          Umów wizytę
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="createFacilityOpen"
      title="Nowa placówka"
      description="Utwórz miejsce, do którego klienci będą mogli umawiać spotkania."
      :ui="{ content: 'sm:max-w-3xl', footer: 'justify-end' }"
    >
      <template #body>
        <form id="create-facility-form" class="form-stack" @submit.prevent="createFacility">
          <div class="form-grid form-grid--two">
            <UFormField name="createFacilityName" label="Nazwa" required>
              <UInput v-model="createFacilityForm.name" class="w-full" autofocus />
            </UFormField>
            <UFormField name="createFacilitySlug" label="Slug" description="Opcjonalny — może zostać wygenerowany automatycznie.">
              <UInput v-model="createFacilityForm.slug" class="w-full" />
            </UFormField>
            <UFormField name="createFacilityTimezone" label="Strefa czasowa" required>
              <USelect v-model="createFacilityForm.timezone" :items="timezoneItems" class="w-full" />
            </UFormField>
            <UFormField name="createFacilityCountry" label="Kod kraju">
              <UInput v-model="createFacilityForm.countryCode" class="w-full" maxlength="2" />
            </UFormField>
            <UFormField name="createFacilityAddress" label="Adres">
              <UInput v-model="createFacilityForm.addressLine1" class="w-full" />
            </UFormField>
            <UFormField name="createFacilityAddress2" label="Lokal / piętro">
              <UInput v-model="createFacilityForm.addressLine2" class="w-full" />
            </UFormField>
            <UFormField name="createFacilityPostalCode" label="Kod pocztowy">
              <UInput v-model="createFacilityForm.postalCode" class="w-full" />
            </UFormField>
            <UFormField name="createFacilityCity" label="Miasto">
              <UInput v-model="createFacilityForm.city" class="w-full" />
            </UFormField>
            <UFormField name="createFacilityPhone" label="Telefon">
              <UInput v-model="createFacilityForm.phone" type="tel" class="w-full" />
            </UFormField>
            <UFormField name="createFacilityEmail" label="E-mail">
              <UInput v-model="createFacilityForm.email" type="email" class="w-full" />
            </UFormField>
          </div>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="create-facility-form"
          icon="i-lucide-building-2"
          :disabled="!createFacilityForm.name.trim()"
          :loading="savingFacility"
        >
          Utwórz placówkę
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="createWidgetOpen"
      title="Nowy widget"
      description="Wybierz początek ścieżki klienta i osobę, z którą będzie można zarezerwować spotkanie."
      :ui="{ content: 'sm:max-w-3xl', footer: 'justify-end' }"
    >
      <template #body>
        <form id="create-widget-form" class="form-stack" @submit.prevent="createWidget">
          <UFormField name="newWidgetType" label="Typ widgetu" :description="widgetTypeDescription(widgetForm.widgetType)" required>
            <USelect v-model="widgetForm.widgetType" :items="widgetTypeItems" value-key="value" class="w-full" />
          </UFormField>

          <UFormField
            v-if="canManage"
            name="newWidgetExpert"
            label="Odbiorca spotkań"
            description="Widget eksperta pokazuje tylko jego wolne terminy. Tego zakresu nie można później zmienić."
          >
            <USelect v-model="widgetExpertScopeSelection" :items="widgetExpertScopeItems" value-key="value" class="w-full" />
          </UFormField>
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-user-round-check"
            title="Twój osobisty widget"
            :description="`Spotkania trafią bezpośrednio do: ${widgetExpertLabel(currentUserId)}.`"
          />

          <div class="form-grid form-grid--two">
            <UFormField name="newWidgetName" label="Nazwa wewnętrzna" required>
              <UInput v-model="widgetForm.name" class="w-full" />
            </UFormField>
            <UFormField name="newWidgetTitle" label="Nagłówek">
              <UInput v-model="widgetForm.title" class="w-full" />
            </UFormField>
            <UFormField name="newWidgetSubtitle" label="Podtytuł">
              <UInput v-model="widgetForm.subtitle" class="w-full" />
            </UFormField>
            <UFormField name="newWidgetTheme" label="Motyw">
              <USelect v-model="widgetForm.theme" :items="themeItems" value-key="value" class="w-full" />
            </UFormField>
          </div>
          <UFormField name="newWidgetMode" label="Sposób wyboru eksperta" :description="widgetModeDescription(widgetForm.bookingMode)">
            <USelect
              v-model="widgetForm.bookingMode"
              :items="bookingModeItems"
              value-key="value"
              class="w-full"
              :disabled="Boolean(widgetForm.fixedExpertUserId) || !canManage"
            />
          </UFormField>
          <UFormField name="newWidgetOrigins" label="Dozwolone domeny" description="Jedna domena w wierszu; pole może pozostać puste.">
            <UTextarea v-model="widgetForm.allowedOrigins" class="w-full" :rows="3" placeholder="https://example.pl" />
          </UFormField>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="create-widget-form"
          icon="i-lucide-code-xml"
          :disabled="!canCreateWidget || !widgetForm.name.trim() || !widgetForm.serviceIds.length"
          :loading="savingWidget"
        >
          Utwórz widget
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="disconnectOpen"
      title="Odłączyć kalendarz?"
      description="Nowe zmiany nie będą synchronizowane, dopóki konto nie zostanie połączone ponownie."
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton color="error" icon="i-lucide-unlink" @click="disconnectCalendar">Odłącz kalendarz</UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.facility-layout {
  display: grid;
  grid-template-columns: minmax(240px, 296px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.facility-sidebar,
.facility-workspace,
.panel-card,
.calendar-context,
.service-card,
.code-card {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.facility-sidebar {
  position: sticky;
  top: 24px;
  display: grid;
  gap: 16px;
  padding: 16px;
}

.facility-sidebar__head,
.workspace-header,
.workspace-header__identity,
.workspace-header__title,
.workspace-header__meta,
.section-heading,
.section-heading--actions,
.subsection-heading,
.subsection-heading--actions,
.panel-card__head,
.panel-card__head--actions,
.panel-card__controls,
.compact-row,
.inline-form,
.member-card,
.member-card__identity,
.member-card__settings,
.member-card__actions,
.service-card__head,
.widget-preview-head,
.code-card__head,
.calendar-context__head,
.calendar-card__head,
.calendar-card__actions,
.appointment-filters,
.appointment-card__date,
.form-actions {
  display: flex;
  align-items: center;
}

.facility-sidebar__head,
.workspace-header,
.section-heading--actions,
.subsection-heading--actions,
.panel-card__head,
.service-card__head,
.widget-preview-head,
.code-card__head {
  justify-content: space-between;
}

.facility-sidebar__head strong {
  color: var(--ui-text-highlighted);
  font-size: 28px;
  line-height: 1;
}

.section-kicker {
  margin: 0 0 6px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.facility-list {
  display: grid;
  gap: 8px;
}

.facility-list-item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 8px;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius);
  background: transparent;
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
  transition: background var(--oe-motion-fast), border-color var(--oe-motion-fast);
}

.facility-list-item:hover,
.facility-list-item--active {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.facility-list-item--active {
  box-shadow: inset 3px 0 0 var(--ui-primary);
}

.facility-list-item__icon,
.workspace-header__mark,
.compact-row__icon,
.calendar-context__icon,
.calendar-card__provider {
  display: grid;
  place-items: center;
  flex: none;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.facility-list-item__icon {
  width: 34px;
  height: 34px;
}

.facility-list-item__body {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.facility-list-item__body strong,
.facility-list-item__body small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facility-list-item__body strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.facility-list-item__body small,
.panel-card__head p,
.widget-preview-head p,
.code-card__head p,
.calendar-card__head p,
.member-card p,
.appointment-card span,
.appointment-card small {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.facility-list-item__status {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-color-success-500);
}

.facility-list-item__status--off {
  background: var(--ui-text-muted);
}

.empty-compact,
.workspace-empty,
.workspace-loading {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 180px;
  padding: 24px;
  color: var(--ui-text-muted);
  text-align: center;
}

.empty-compact p,
.workspace-empty p {
  max-width: 480px;
  margin: 0;
}

.empty-compact > .iconify,
.workspace-empty > .iconify {
  width: 28px;
  height: 28px;
}

.workspace-empty h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
}

.workspace-empty--small {
  min-height: 140px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--ui-radius);
}

.facility-workspace {
  min-width: 0;
  padding: clamp(18px, 3vw, 30px);
}

.workspace-header {
  gap: 20px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--ui-border);
}

.workspace-header__identity {
  gap: 14px;
  min-width: 0;
}

.workspace-header__mark {
  width: 48px;
  height: 48px;
  font-size: 20px;
}

.workspace-header__title {
  gap: 10px;
  flex-wrap: wrap;
}

.workspace-header h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 550;
  letter-spacing: -.025em;
}

.workspace-header p,
.section-heading p,
.subsection-heading p,
.calendar-context__head p,
.switch-row p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.workspace-header__meta {
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.workspace-tabs {
  margin: 20px 0 28px;
  overflow-x: auto;
}

.workspace-section,
.form-stack,
.panel-card,
.service-card,
.calendar-context,
.calendar-card,
.code-card,
.assignment-block {
  display: grid;
  gap: 20px;
}

.section-heading,
.subsection-heading {
  gap: 16px;
  align-items: flex-start;
}

.section-heading h3,
.subsection-heading h4,
.panel-card h4,
.service-card h4,
.calendar-context h4,
.calendar-card strong,
.code-card strong {
  margin: 0;
  color: var(--ui-text-highlighted);
}

.section-heading h3 {
  font-size: 22px;
  font-weight: 550;
  letter-spacing: -.02em;
}

.subsection-heading {
  margin-top: 12px;
  padding-top: 28px;
  border-top: 1px solid var(--ui-border);
}

.form-grid,
.content-grid,
.service-list,
.embed-grid,
.calendar-grid,
.number-grid,
.checkbox-grid,
.widget-layout {
  display: grid;
  gap: 16px;
}

.form-grid--two,
.content-grid--split,
.service-list,
.embed-grid,
.calendar-grid,
.widget-layout {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.number-grid {
  grid-template-columns: repeat(5, minmax(110px, 1fr));
}

.checkbox-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-stack--compact {
  gap: 14px;
}

.form-actions {
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.switch-row strong,
.assignment-block > strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.switch-row--compact {
  padding: 12px 14px;
}

.panel-card,
.service-card,
.calendar-context {
  padding: 20px;
}

.panel-card__head {
  gap: 16px;
  align-items: flex-start;
}

.panel-card__head > .iconify {
  color: var(--ui-text-muted);
}

.panel-card__head--actions {
  align-items: center;
}

.panel-card__controls {
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.expert-select {
  min-width: 220px;
}

.compact-list,
.member-list,
.appointment-list,
.override-list {
  display: grid;
  gap: 10px;
}

.compact-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
}

.compact-row__icon {
  width: 34px;
  height: 34px;
}

.compact-row > div,
.member-card__identity > div,
.appointment-card__customer,
.appointment-card__service {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.compact-row small,
.empty-line {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.empty-line {
  margin: 0;
}

.inline-form {
  gap: 10px;
  align-items: flex-end;
}

.inline-form__field {
  flex: 1;
}

.member-card {
  gap: 18px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.member-card__identity {
  flex: 1 1 240px;
  gap: 12px;
}

.member-card__settings {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 110px 100px;
  gap: 12px;
  flex: 2 1 440px;
}

.member-card__bookable {
  display: grid;
  align-content: end;
  justify-items: start;
  gap: 8px;
  padding-bottom: 2px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.member-card__actions {
  gap: 6px;
}

.schedule-card {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
}

.schedule-card--nested {
  background: var(--ui-bg-muted);
}

.schedule-day {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ui-border);
}

.schedule-day:last-child {
  border-bottom: 0;
}

.schedule-day__label {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.schedule-day__periods {
  display: grid;
  gap: 8px;
  justify-items: start;
}

.period-row {
  display: grid;
  grid-template-columns: 120px auto 120px 34px 34px;
  gap: 8px;
  align-items: center;
}

.schedule-day__closed {
  min-height: 32px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 32px;
}

.override-form {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) auto minmax(110px, .7fr) minmax(110px, .7fr) auto;
  gap: 12px;
  align-items: end;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.override-form__switch {
  display: grid;
  gap: 8px;
  justify-items: start;
  min-height: 58px;
  align-content: end;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.override-row {
  display: grid;
  grid-template-columns: 24px 130px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  color: var(--ui-text-muted);
  font-size: 13px;
}

.override-row strong {
  color: var(--ui-text-highlighted);
}

.service-card__head {
  align-items: flex-start;
}

.service-card__head h4 {
  margin-top: 9px;
  font-size: 18px;
}

.assignment-block {
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.widget-preview-column {
  min-width: 0;
}

.widget-preview-head {
  gap: 16px;
  margin-bottom: 10px;
}

.widget-preview-frame {
  overflow: hidden;
  min-height: 620px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.widget-preview-frame iframe {
  width: 100%;
  height: 620px;
  border: 0;
}

.embed-grid {
  margin-top: 8px;
}

.code-card {
  min-width: 0;
  padding: 16px;
}

.code-card__head {
  gap: 12px;
  align-items: flex-start;
}

.code-card pre {
  overflow-x: auto;
  margin: 0;
  padding: 14px;
  border-radius: var(--ui-radius);
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}

.calendar-context__head {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 12px;
}

.calendar-context__icon,
.calendar-card__provider {
  width: 42px;
  height: 42px;
}

.calendar-card {
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.calendar-card__head {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 10px;
}

.calendar-card__details {
  display: grid;
  gap: 8px;
  margin: 0;
}

.calendar-card__details div {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ui-border);
}

.calendar-card__details dt,
.calendar-card__details dd,
.calendar-card__empty {
  margin: 0;
  font-size: 12px;
}

.calendar-card__details dt,
.calendar-card__empty {
  color: var(--ui-text-muted);
}

.calendar-card__details dd {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  text-overflow: ellipsis;
}

.calendar-card__actions {
  gap: 8px;
  flex-wrap: wrap;
}

.appointment-filters {
  gap: 10px;
}

.appointment-booking-section {
  display: grid;
  gap: 16px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ui-border);
}

.appointment-booking-section__heading {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.appointment-booking-section__heading > span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 9px;
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 700;
}

.appointment-booking-section__heading h3,
.appointment-booking-section__heading p {
  margin: 0;
}

.appointment-booking-section__heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.appointment-booking-section__heading p {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.appointment-client-results {
  display: grid;
  gap: 8px;
  max-height: 250px;
  overflow-y: auto;
}

.appointment-client-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
}

.appointment-client-option:hover,
.appointment-client-option--selected {
  border-color: var(--ui-primary);
  background: var(--ui-bg-muted);
}

.appointment-client-option span,
.appointment-client-option strong,
.appointment-client-option small {
  display: block;
}

.appointment-client-option strong {
  color: var(--ui-text-highlighted);
}

.appointment-client-option small {
  margin-top: 2px;
  color: var(--ui-text-muted);
}

.staff-slot-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}

.staff-slot {
  display: grid;
  gap: 2px;
  min-height: 54px;
  padding: 9px 11px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
}

.staff-slot:hover,
.staff-slot--selected {
  border-color: var(--ui-primary);
  background: var(--ui-bg-muted);
}

.staff-slot--selected {
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}

.staff-slot strong {
  color: var(--ui-text-highlighted);
}

.staff-slot small {
  overflow: hidden;
  color: var(--ui-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.appointment-card {
  display: grid;
  grid-template-columns: minmax(230px, 1.25fr) minmax(190px, 1fr) minmax(180px, 1fr) auto;
  gap: 18px;
  align-items: center;
  padding: 15px 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.appointment-card__date {
  gap: 10px;
}

.appointment-card__date > .iconify {
  color: var(--ui-primary);
}

.appointment-card__date > div {
  display: grid;
  gap: 2px;
}

.appointment-card__customer a {
  overflow: hidden;
  color: var(--ui-primary);
  font-size: 12px;
  text-overflow: ellipsis;
}

.appointment-card__notes {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: 12px;
}

.pagination-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.pagination-row > div {
  display: flex;
  gap: 8px;
}

@media (max-width: 1180px) {
  .facility-layout,
  .widget-layout,
  .content-grid--split,
  .calendar-grid,
  .embed-grid,
  .service-list {
    grid-template-columns: 1fr;
  }

  .facility-sidebar {
    position: static;
  }

  .facility-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .number-grid {
    grid-template-columns: repeat(3, minmax(120px, 1fr));
  }

  .member-card,
  .appointment-card {
    align-items: start;
    flex-wrap: wrap;
  }

  .appointment-card {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .facility-workspace {
    padding: 16px;
  }

  .facility-list,
  .form-grid--two,
  .form-grid--three,
  .checkbox-grid,
  .number-grid,
  .appointment-card,
  .member-card__settings {
    grid-template-columns: 1fr;
  }

  .staff-slot-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-header,
  .section-heading--actions,
  .subsection-heading--actions,
  .panel-card__head--actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-header__meta,
  .panel-card__controls,
  .appointment-filters {
    justify-content: flex-start;
    width: 100%;
  }

  .appointment-filters,
  .panel-card__controls,
  .pagination-row {
    display: grid;
  }

  .expert-select {
    min-width: 0;
    width: 100%;
  }

  .schedule-day {
    grid-template-columns: 1fr;
  }

  .period-row {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) 34px 34px;
    width: 100%;
  }

  .override-form {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .override-form__switch {
    min-height: 0;
  }

  .calendar-context__head,
  .calendar-card__head {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .calendar-context__head > :last-child,
  .calendar-card__head > :last-child {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .calendar-card__details div {
    grid-template-columns: 1fr;
    gap: 3px;
  }
}
</style>
