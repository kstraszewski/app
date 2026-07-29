import type { OrganizationMember, TeamMembership, TeamNode } from './organization'
import type { BookingWidgetType } from '#shared/types/booking-calculators'

export type FacilityRole = 'admin' | 'member'
export type AppointmentStatus = 'hold' | 'confirmed' | 'cancelled'
export type AppointmentMeetingMode = 'office' | 'online'
export type CalendarEntryType = AppointmentMeetingMode | 'vacation'
export type CalendarProvider = 'google' | 'microsoft'
export type CalendarConnectionStatus = 'pending' | 'active' | 'error' | 'revoked' | 'connected' | 'reconnect_required' | 'disconnected'

export interface Facility {
  id: string
  organization_id: string
  name: string
  slug: string
  description?: string | null
  timezone: string
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  city: string | null
  country_code: string
  phone: string | null
  email: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface FacilityCoverImage {
  thumbnailUrl: string | null
  fallbackUrl: string | null
  alt: string
}

export interface FacilityListItem extends Facility {
  coverImage?: FacilityCoverImage | null
}

export interface FacilityAccess {
  source: 'organization_admin' | 'facility' | 'team'
  role: FacilityRole
  canManage: boolean
}

export interface FacilityListPayload {
  data: FacilityListItem[]
  role: 'admin' | 'expert'
  canCreate: boolean
  defaultFacilityId: string | null
}

export interface FacilityDetailPayload {
  data: Facility
  access: FacilityAccess
}

export interface FacilityImage {
  id: string
  organization_id: string
  facility_id: string
  original_filename: string
  mime_type: 'image/webp'
  size_bytes: number
  width_px: number
  height_px: number
  sort_order: number
  alt_text: string | null
  uploaded_by: string
  created_at: string
  updated_at: string
  url: string | null
}

export interface FacilityImagesPayload {
  data: FacilityImage[]
  limit: number
}

export interface FacilityMember {
  organization_id: string
  facility_id: string
  user_id: string
  role: FacilityRole
  is_bookable: boolean
  booking_priority: number
  last_assigned_at: string | null
  created_at: string
  updated_at: string
  user: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
}

export interface FacilityMembersPayload {
  data: FacilityMember[]
}

export interface UserStructureTeamAssignment {
  team: TeamNode
  membership: TeamMembership
}

export interface UserStructureFacilityAssignment {
  facility: Facility
  membership: Omit<FacilityMember, 'user'>
}

export interface UserStructureAssignmentsPayload {
  data: {
    teams: UserStructureTeamAssignment[]
    facilities: UserStructureFacilityAssignment[]
  }
  catalog: {
    teams: TeamNode[]
    facilities: Facility[]
  }
}

export interface FacilityTeamLink {
  organization_id: string
  team_id: string
  facility_id: string
  created_at: string
  team: Pick<TeamNode, 'id' | 'name' | 'slug' | 'kind'> | null
}

export interface FacilityTeamLinksPayload {
  data: FacilityTeamLink[]
}

export interface FacilityOpeningPeriod {
  id: string
  organization_id: string
  facility_id: string
  weekday: number
  opens_at: string
  closes_at: string
  is_active: boolean
}

export interface FacilityOpeningOverride {
  id: string
  organization_id: string
  facility_id: string
  local_date: string
  is_closed: boolean
  opens_at: string | null
  closes_at: string | null
}

export interface FacilityHoursPayload {
  openingHours: FacilityOpeningPeriod[]
  overrides: FacilityOpeningOverride[]
}

export interface ExpertAvailabilityRule {
  id?: string
  weekday: number
  starts_at: string
  ends_at: string
  valid_from?: string | null
  valid_until?: string | null
  is_active: boolean
}

export interface ExpertAvailabilityOverride {
  id?: string
  local_date: string
  is_unavailable: boolean
  starts_at?: string | null
  ends_at?: string | null
}

export interface ExpertSchedulePayload {
  userId?: string
  rules: ExpertAvailabilityRule[]
  overrides: ExpertAvailabilityOverride[]
}

export interface BookingService {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  slot_interval_minutes: number
  min_notice_minutes: number
  max_advance_days: number
  is_active: boolean
  isAvailable: boolean
  expertUserIds: string[]
}

export interface FacilityServicesPayload {
  data: BookingService[]
  catalog: BookingService[]
}

export interface BookingWidget {
  id: string
  organization_id: string
  facility_id: string
  public_token: string
  slug: string
  name: string
  title: string
  subtitle: string | null
  theme: 'light' | 'dark' | 'auto'
  accent_color: string | null
  allowed_origins: string[]
  booking_mode: 'facility' | 'expert' | 'both'
  widget_type: BookingWidgetType
  fixed_expert_user_id: string | null
  created_by_user_id: string | null
  locale: string
  is_active: boolean
  is_directory_listed: boolean
  created_at: string
  updated_at: string
  widgetKey: string
  publicUrl: string
  embedUrl: string
  embedCode: string
  serviceIds: string[]
  bookings30Days?: number
}

export interface FacilityWidgetsPayload {
  data: BookingWidget[]
}

export interface PersonalWidgetFacility {
  facility: Facility
  services: BookingService[]
  widgets: BookingWidget[]
}

export interface PersonalWidgetsPayload {
  currentUserId: string
  data: PersonalWidgetFacility[]
}

export interface PersonalWidgetDetailPayload {
  currentUserId: string
  facility: Facility | null
  services: BookingService[]
  previewToken: string
  widget: BookingWidget | null
}

export interface BookingWidgetAnalyticsSummary {
  views: number
  embeddedViews: number
  engagedVisits: number
  calculatorStarts: number
  calculatorCompletions: number
  serviceSelections: number
  availabilitySearches: number
  availabilityFound: number
  slotSelections: number
  contactStarts: number
  bookingAttempts: number
  bookingCompletions: number
  bookings: number
  confirmedBookings: number
  cancelledBookings: number
  lastBookingAt: string | null
}

export interface BookingWidgetAnalyticsDay {
  date: string
  views: number
  engagedVisits: number
  calculatorCompletions: number
  availabilitySearches: number
  availabilityFound: number
  slotSelections: number
  contactStarts: number
  bookingAttempts: number
  bookingCompletions: number
  bookings: number
}

export interface BookingWidgetAnalyticsService {
  serviceId: string
  name: string
  interest: number
  bookings: number
}

export interface BookingWidgetAnalytics {
  period: {
    from: string
    to: string
    timeZone: string
    trackingStartedAt: string
  }
  summary: BookingWidgetAnalyticsSummary
  daily: BookingWidgetAnalyticsDay[]
  topServices: BookingWidgetAnalyticsService[]
}

export interface BookingWidgetAnalyticsPayload {
  days: 7 | 30 | 90
  data: BookingWidgetAnalytics
}

export interface CalendarConnection {
  id: string
  provider: CalendarProvider
  status: CalendarConnectionStatus
  owner_kind?: 'facility' | 'expert'
  owner_id?: string
  provider_account_email?: string | null
  external_calendar_name?: string | null
  last_synced_at?: string | null
  error_message?: string | null
  providerAccountEmail?: string | null
  externalCalendarName?: string | null
  lastSyncedAt?: string | null
  errorMessage?: string | null
}

export interface CalendarProviderOption {
  provider: CalendarProvider
  label: string
  connectPath: string | null
  enabled: boolean
}

export interface FacilityCalendarConnectionsPayload {
  data: CalendarConnection[]
  providers?: CalendarProviderOption[]
}

export interface Appointment {
  id: string
  client_id: string
  client_person_id: string | null
  facility_id: string
  service_id: string
  expert_user_id: string | null
  widget_id: string | null
  starts_at: string
  ends_at: string
  timezone: string
  meeting_mode: AppointmentMeetingMode
  meeting_url: string | null
  status: AppointmentStatus
  hold_expires_at: string | null
  customer_name: string
  customer_email: string
  customer_phone: string | null
  notes: string | null
  booking_context?: Record<string, unknown>
  created_at: string
  updated_at: string
  facilityName: string
  serviceName: string
  expertName: string
}

export interface FacilityAppointmentsPayload {
  data: Appointment[]
  count: number
}

export interface TeamCalendarMember {
  userId: string
  email: string
  fullName: string
  avatarUrl: string | null
}

export interface TeamCalendarAppointment {
  id: string
  expertUserId: string
  startsAt: string
  endsAt: string
  status: AppointmentStatus
  meetingMode: AppointmentMeetingMode
  customerName: string
  facilityName: string
  serviceName: string
}

export interface TeamCalendarTimeOff {
  id: string
  expertUserId: string
  startsAt: string
  endsAt: string
  timezone: string
}

export interface TeamCalendarPayload {
  team: {
    id: string
    name: string
  }
  period: {
    startsFrom: string
    startsBefore: string
  }
  members: TeamCalendarMember[]
  appointments: TeamCalendarAppointment[]
  timeOff: TeamCalendarTimeOff[]
}

export interface ExpertTimeOff {
  id: string
  organization_id: string
  expert_user_id: string
  kind: 'vacation'
  starts_at: string
  ends_at: string
  timezone: string
  all_day: boolean
  notes: string | null
  created_by_user_id: string
  status: 'active' | 'cancelled'
  cancelled_at: string | null
  created_at: string
  updated_at: string
  canManage: boolean
}

export interface ExpertTimeOffPayload {
  data: ExpertTimeOff[]
  count?: number
}

export interface OrganizationMembersPayload {
  currentUserId: string
  role: 'admin' | 'expert'
  canAssignOthers: boolean
  capabilities?: {
    canManageAccess: boolean
    canManageStructure: boolean
    canReadAudit: boolean
    canRequestPrivacyGrants: boolean
    canApprovePrivacyGrants: boolean
  }
  members: OrganizationMember[]
}
