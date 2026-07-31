import { serverDataBackend } from '~~/server/utils/data-api'
import { useRuntimeConfig } from '#imports'
import type { MortgageCapacityPolicy } from '@openexpert/mortgage'
import type { BookingWidgetType } from '#shared/types/booking-calculators'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  createError,
  getHeader,
  getRequestIP,
  getRequestURL,
  setHeader,
  type H3Event,
} from 'h3'
import {
  asRecord,
  hasAdministrativePermission,
  resolveTeamAdminScope,
  type CrmSession,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import {
  defaultMortgageCapacityPolicy,
  sanitizeMortgageCapacityPolicy,
} from '~~/server/utils/mortgage-capacity'

export type FacilityPermission = 'view' | 'manage'

export interface FacilityAccess {
  facility: Record<string, any>
  source: 'organization_admin' | 'facility' | 'team'
  role: 'admin' | 'member'
  canManage: boolean
}

export interface PublicWidgetCatalog {
  widget: {
    key: string
    title: string
    subtitle: string | null
    theme: 'light' | 'dark' | 'auto'
    accentColor: string
    bookingMode: 'facility' | 'expert' | 'both'
    widgetType: BookingWidgetType
    fixedExpertUserId: string | null
  }
  facility: {
    id: string
    name: string
    address: string | null
    timezone: string
  }
  services: Array<{
    id: string
    name: string
    description: string | null
    durationMinutes: number
  }>
  experts: Array<{
    userId: string
    name: string
    avatarUrl?: string | null
    serviceIds?: string[]
  }>
  consents: Array<{
    definitionId: string
    versionId: string
    title: string
    content: string
    purpose: string
    channel: 'email' | 'sms' | 'phone' | 'messaging' | 'other'
    legalBasis: string
    isRequired: boolean
  }>
  capacityPolicy: MortgageCapacityPolicy
  capacityPolicyRevision: number | null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/
const localePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/
const publicKeyPattern = /^[A-Za-z0-9._~-]{8,200}$/

export function uuidValue(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value || !uuidPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a UUID` })
  }
  return value
}

export function optionalUuidValue(input: unknown, field: string): string | null {
  if (input === null || input === undefined || input === '') return null
  return uuidValue(input, field)
}

export function publicWidgetKey(input: unknown): string {
  const value = textValue(input)
  if (!value || !publicKeyPattern.test(value)) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }
  return value
}

export function idempotencyKeyValue(input: unknown): string {
  const value = textValue(input)
  if (!value || !publicKeyPattern.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'idempotencyKey must be an 8-200 character token',
    })
  }
  return value
}

export function bookingConsentDecisionsValue(input: unknown): Array<{
  definition_id: string
  version_id: string
  granted: boolean
}> {
  if (!Array.isArray(input) || input.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: 'consentDecisions must be an array with at most 100 items',
    })
  }
  const decisions = input.map((raw, index) => {
    const decision = recordValue(raw, `consentDecisions[${index}]`)
    return {
      definition_id: uuidValue(
        decision.definitionId ?? decision.definition_id,
        `consentDecisions[${index}].definitionId`,
      ),
      version_id: uuidValue(
        decision.versionId ?? decision.version_id,
        `consentDecisions[${index}].versionId`,
      ),
      granted: booleanValue(decision.granted, `consentDecisions[${index}].granted`),
    }
  })
  if (new Set(decisions.map(decision => decision.definition_id)).size !== decisions.length) {
    throw createError({ statusCode: 400, statusMessage: 'Consent decisions contain duplicates' })
  }
  return decisions
}

export function limitedText(
  input: unknown,
  field: string,
  maxLength: number,
  options: { required?: boolean; nullable?: boolean } = {},
): string | null | undefined {
  if (input === undefined) return options.required
    ? requiredField(field)
    : undefined
  if (input === null || input === '') {
    if (options.required) return requiredField(field)
    return options.nullable ? null : undefined
  }
  if (typeof input !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text` })
  }
  const value = input.trim()
  if (!value) {
    if (options.required) return requiredField(field)
    return options.nullable ? null : undefined
  }
  if (value.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }
  return value
}

function requiredField(field: string): never {
  throw createError({ statusCode: 400, statusMessage: `${field} is required` })
}

export function booleanValue(input: unknown, field: string): boolean {
  if (typeof input !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be boolean` })
  }
  return input
}

export function integerValue(
  input: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = typeof input === 'number'
    ? input
    : (typeof input === 'string' && input.trim() ? Number(input) : Number.NaN)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an integer between ${minimum} and ${maximum}`,
    })
  }
  return value
}

export function enumValue<const T extends readonly string[]>(
  input: unknown,
  field: string,
  allowed: T,
): T[number] {
  const value = textValue(input)
  if (!value || !allowed.includes(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be one of: ${allowed.join(', ')}`,
    })
  }
  return value as T[number]
}

export function dateValue(input: unknown, field = 'date'): string {
  const value = textValue(input)
  if (!value || !datePattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must use YYYY-MM-DD` })
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, statusMessage: `${field} is not a valid date` })
  }
  return value
}

export function isoDateTimeValue(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an ISO date-time with a timezone offset`,
    })
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    throw createError({ statusCode: 400, statusMessage: `${field} is not a valid date-time` })
  }
  return parsed.toISOString()
}

export function localTimeValue(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value || !localTimePattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must use HH:mm` })
  }
  return value.length === 5 ? `${value}:00` : value
}

export function timezoneValue(input: unknown, field = 'timezone'): string {
  const value = limitedText(input, field, 100, { required: true }) as string
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
  } catch {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an IANA timezone` })
  }
  return value
}

export function emailValue(input: unknown, field: string, options: { required?: boolean } = {}): string | null {
  const value = limitedText(input, field, 320, {
    required: options.required,
    nullable: !options.required,
  })
  if (value === null || value === undefined) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a valid email` })
  }
  return value.toLowerCase()
}

export function slugValue(input: unknown, fallback: string | undefined, field = 'slug'): string {
  const raw = textValue(input) ?? textValue(fallback)
  if (!raw) requiredField(field)
  const value = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
    .replace(/-$/g, '')
  if (!value) requiredField(field)
  return value
}

export function localeValue(input: unknown, field = 'locale'): string {
  const value = limitedText(input, field, 10, { required: true }) as string
  if (!localePattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must use e.g. pl-PL` })
  }
  return value
}

export function recordValue(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an object` })
  }
  return input as Record<string, unknown>
}

export function uuidArrayValue(input: unknown, field: string, maximum = 100): string[] {
  if (!Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an array` })
  }
  if (input.length > maximum) {
    throw createError({ statusCode: 400, statusMessage: `${field} has too many items` })
  }
  return [...new Set(input.map((value, index) => uuidValue(value, `${field}[${index}]`)))]
}

export function allowedOriginsValue(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: 'allowed_origins must be an array' })
  }
  if (input.length > 20) {
    throw createError({ statusCode: 400, statusMessage: 'allowed_origins has too many items' })
  }
  const origins = input.map((item, index) => normalizeOrigin(
    limitedText(item, `allowed_origins[${index}]`, 300, { required: true }) as string,
    `allowed_origins[${index}]`,
  ))
  return [...new Set(origins)]
}

function normalizeOrigin(value: string, field = 'origin'): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url.origin
  } catch {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a valid HTTP(S) origin` })
  }
}

export async function getPublicSchedulingClient(event: H3Event): Promise<any> {
  return serverDataBackend(event) as any
}

export type BookingWidgetAnalyticsEvent =
  | 'widget_view'
  | 'widget_engaged'
  | 'calculator_started'
  | 'calculator_completed'
  | 'service_selected'
  | 'availability_search'
  | 'availability_found'
  | 'slot_selected'
  | 'contact_started'
  | 'booking_attempt'
  | 'booking_completed'

export async function recordBookingWidgetEvent(
  event: H3Event,
  input: {
    widgetKey: string
    visitId: string
    eventType: BookingWidgetAnalyticsEvent
    serviceId?: string | null
    eventId?: string | null
    isEmbedded?: boolean
  },
): Promise<void> {
  try {
    const dataApi = await getPublicSchedulingClient(event)
    const { error } = await dataApi.rpc('record_booking_widget_event', {
      p_widget_token: input.widgetKey,
      p_visit_id: input.visitId,
      p_event_type: input.eventType,
      p_service_id: input.serviceId ?? null,
      p_event_id: input.eventId ?? null,
      p_is_embedded: input.isEmbedded === true,
    })
    if (error) {
      console.error('[booking] widget analytics event was not recorded', {
        eventType: input.eventType,
        code: error.code,
      })
    }
  } catch (error) {
    console.error('[booking] widget analytics event failed', {
      eventType: input.eventType,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  }
}

export async function ensureGenericMeetingService(
  event: H3Event,
  organizationId: string,
  facilityId: string,
): Promise<Record<string, any>> {
  const backendData = serverDataBackend(event) as any
  const { data: service, error: serviceError } = await backendData
    .from('booking_services')
    .upsert({
      organization_id: organizationId,
      name: 'Spotkanie',
      slug: 'spotkanie',
      description: 'Ogólne spotkanie z ekspertem.',
      duration_minutes: 60,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      slot_interval_minutes: 15,
      min_notice_minutes: 60,
      max_advance_days: 90,
      is_active: true,
    }, { onConflict: 'organization_id,slug' })
    .select('*')
    .single()
  throwDbError(serviceError)

  const { error: facilityServiceError } = await backendData
    .from('facility_services')
    .upsert({
      organization_id: organizationId,
      facility_id: facilityId,
      service_id: service.id,
      is_active: true,
    }, { onConflict: 'organization_id,facility_id,service_id' })
  throwDbError(facilityServiceError)

  const { data: experts, error: expertsError } = await backendData
    .from('facility_memberships')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('facility_id', facilityId)
    .eq('is_bookable', true)
  throwDbError(expertsError)

  if (experts?.length) {
    const { error: assignmentsError } = await backendData
      .from('facility_service_experts')
      .upsert(
        experts.map((expert: any) => ({
          organization_id: organizationId,
          facility_id: facilityId,
          service_id: service.id,
          user_id: expert.user_id,
          is_active: true,
        })),
        { onConflict: 'organization_id,facility_id,service_id,user_id' },
      )
    throwDbError(assignmentsError)
  }

  return service
}

export async function findConfiguredGenericMeetingService(
  event: H3Event,
  organizationId: string,
  facilityId: string,
  expertUserId: string,
): Promise<Record<string, any> | null> {
  const backendData = serverDataBackend(event) as any
  const { data: service, error: serviceError } = await backendData
    .from('booking_services')
    .select('id, organization_id, name, slug, duration_minutes')
    .eq('organization_id', organizationId)
    .eq('slug', 'spotkanie')
    .eq('is_active', true)
    .maybeSingle()
  throwDbError(serviceError)
  if (!service) return null

  const [facilityServiceResult, expertAssignmentResult] = await Promise.all([
    backendData
      .from('facility_services')
      .select('service_id')
      .eq('organization_id', organizationId)
      .eq('facility_id', facilityId)
      .eq('service_id', service.id)
      .eq('is_active', true)
      .maybeSingle(),
    backendData
      .from('facility_service_experts')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('facility_id', facilityId)
      .eq('service_id', service.id)
      .eq('user_id', expertUserId)
      .eq('is_active', true)
      .maybeSingle(),
  ])
  throwDbError(facilityServiceResult.error)
  throwDbError(expertAssignmentResult.error)
  if (!facilityServiceResult.data || !expertAssignmentResult.data) return null
  return service
}

export async function assertPublicBookingRateLimit(
  event: H3Event,
  scope: 'catalog' | 'slots' | 'booking' | 'analytics',
  widgetKey: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const config = useRuntimeConfig(event)
  const rateLimitConfig = config.bookingSecurity as {
    trustProxy?: boolean | string
    rateLimitSecret?: string
  }
  const trustProxy = rateLimitConfig?.trustProxy === true || rateLimitConfig?.trustProxy === 'true'
  const clientAddress = getRequestIP(event, { xForwardedFor: trustProxy })
    || (trustProxy ? getHeader(event, 'x-real-ip') : null)
    || 'unknown'
  const rateLimitSecret = rateLimitConfig?.rateLimitSecret
    || 'openexpert-booking-rate-limit'
  const clientKey = createHmac('sha256', rateLimitSecret)
    .update(clientAddress, 'utf8')
    .digest('base64url')
  const dataApi = await getPublicSchedulingClient(event)
  const { data, error } = await dataApi.rpc('consume_booking_rate_limit', {
    p_widget_token: widgetKey,
    p_scope: scope,
    p_client_key: clientKey,
    p_limit: limit,
    p_window_seconds: Math.max(1, Math.ceil(windowMs / 1_000)),
  })
  throwDbError(error)
  const retryAfter = Number(data ?? 0)
  if (retryAfter > 0) {
    setHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too many booking requests. Try again later.' })
  }
}

function bookingPreviewSecret(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const bookingSecurity = config.bookingSecurity as { rateLimitSecret?: string }
  const secret = bookingSecurity?.rateLimitSecret
  if (!secret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Booking preview is temporarily unavailable',
    })
  }
  return secret
}

export function createBookingWidgetPreviewToken(
  event: H3Event,
  widgetKey: string,
): string {
  const expiresAt = Math.floor(Date.now() / 1_000) + 15 * 60
  const signature = createHmac('sha256', bookingPreviewSecret(event))
    .update(`booking-preview:${widgetKey}:${expiresAt}`, 'utf8')
    .digest('base64url')
  return `${expiresAt}.${signature}`
}

export function verifyBookingWidgetPreviewToken(
  event: H3Event,
  widgetKey: string,
  input: unknown,
): boolean {
  if (typeof input !== 'string') return false
  const [expiresAtRaw, signature, ...rest] = input.split('.')
  if (rest.length || !expiresAtRaw || !signature || !/^\d{10}$/.test(expiresAtRaw)) return false
  const expiresAt = Number(expiresAtRaw)
  const now = Math.floor(Date.now() / 1_000)
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + 16 * 60) return false
  const expected = createHmac('sha256', bookingPreviewSecret(event))
    .update(`booking-preview:${widgetKey}:${expiresAt}`, 'utf8')
    .digest('base64url')
  const receivedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer)
}

export async function listAccessibleFacilityIds(session: CrmSession): Promise<string[] | null> {
  if (await hasAdministrativePermission(session, 'structure.manage')) return null

  const [facilityMemberships, teamMemberships, teamAdminScope] = await Promise.all([
    session.dataApi
      .from('facility_memberships')
      .select('facility_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId),
    session.dataApi
      .from('team_memberships')
      .select('team_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId),
    resolveTeamAdminScope(session),
  ])
  throwDbError(facilityMemberships.error)
  throwDbError(teamMemberships.error)

  const facilityIds = new Set<string>(
    (facilityMemberships.data ?? []).map((row: any) => String(row.facility_id)),
  )
  const teamIds = [...new Set([
    ...(teamMemberships.data ?? []).map((row: any) => String(row.team_id)),
    ...teamAdminScope.managedTeamIds,
  ])]
  if (teamIds.length) {
    const { data, error } = await session.dataApi
      .from('team_facilities')
      .select('facility_id')
      .eq('organization_id', session.organizationId)
      .in('team_id', teamIds)
    throwDbError(error)
    for (const row of data ?? []) facilityIds.add(String(row.facility_id))
  }
  return [...facilityIds]
}

export async function requireFacilityPermission(
  session: CrmSession,
  facilityIdInput: unknown,
  permission: FacilityPermission = 'view',
): Promise<FacilityAccess> {
  const facilityId = uuidValue(facilityIdInput, 'facilityId')
  const { data: facility, error: facilityError } = await session.dataApi
    .from('facilities')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', facilityId)
    .maybeSingle()
  throwDbError(facilityError)
  if (!facility) {
    throw createError({ statusCode: 404, statusMessage: 'Facility not found' })
  }

  if (await hasAdministrativePermission(session, 'structure.manage')) {
    return {
      facility,
      source: 'organization_admin',
      role: 'admin',
      canManage: true,
    }
  }

  if (permission === 'manage') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Organization administrator required',
    })
  }

  const { data: directMembership, error: membershipError } = await session.dataApi
    .from('facility_memberships')
    .select('role')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
    .eq('user_id', session.userId)
    .maybeSingle()
  throwDbError(membershipError)

  if (directMembership) {
    return {
      facility,
      source: 'facility',
      role: 'member',
      canManage: false,
    }
  }

  const { data: links, error: linksError } = await session.dataApi
    .from('team_facilities')
    .select('team_id')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
  throwDbError(linksError)
  const teamIds = (links ?? []).map((row: any) => String(row.team_id))
  if (teamIds.length) {
    const { data: teamMembership, error: teamError } = await session.dataApi
      .from('team_memberships')
      .select('role')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .in('team_id', teamIds)
      .order('role')
    throwDbError(teamError)
    const memberships = teamMembership ?? []
    if (memberships.length) {
      // Team membership grants access to a linked facility, but a team admin
      // administers the link/team, not the facility itself.
      return {
        facility,
        source: 'team',
        role: 'member',
        canManage: false,
      }
    }
  }

  // The facility query above is evaluated with the authenticated user's RLS.
  // If it succeeded, an inherited team scope may be the access source even
  // when no direct membership/link was found by the metadata queries.
  return {
    facility,
    source: 'team',
    role: 'member',
    canManage: false,
  }
}

export async function assertOrganizationMemberIds(
  session: CrmSession,
  userIds: string[],
): Promise<void> {
  if (!userIds.length) return
  const { data, error } = await session.dataApi
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', session.organizationId)
    .in('user_id', userIds)
  throwDbError(error)
  const found = new Set((data ?? []).map((row: any) => String(row.user_id)))
  if (userIds.some(userId => !found.has(userId))) {
    throw createError({ statusCode: 400, statusMessage: 'A selected user is not an organization member' })
  }
}

export async function assertFacilityBookableMemberIds(
  session: CrmSession,
  facilityId: string,
  userIds: string[],
): Promise<void> {
  if (!userIds.length) return
  const { data, error } = await session.dataApi
    .from('facility_memberships')
    .select('user_id')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
    .eq('is_bookable', true)
    .in('user_id', userIds)
  throwDbError(error)
  const found = new Set((data ?? []).map((row: any) => String(row.user_id)))
  if (userIds.some(userId => !found.has(userId))) {
    throw createError({ statusCode: 400, statusMessage: 'A selected expert is not bookable at this facility' })
  }
}

export function openingHoursPayload(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input) || input.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'openingHours must be an array with at most 100 items' })
  }
  return input.map((raw, index) => {
    const row = recordValue(raw, `openingHours[${index}]`)
    const opensAt = localTimeValue(row.opensAt ?? row.opens_at, `openingHours[${index}].opensAt`)
    const closesAt = localTimeValue(row.closesAt ?? row.closes_at, `openingHours[${index}].closesAt`)
    if (opensAt >= closesAt) {
      throw createError({
        statusCode: 400,
        statusMessage: `openingHours[${index}] must end after it starts; split overnight hours across days`,
      })
    }
    return {
      weekday: integerValue(row.weekday, `openingHours[${index}].weekday`, 0, 6),
      opens_at: opensAt,
      closes_at: closesAt,
      is_active: row.isActive === undefined && row.is_active === undefined
        ? true
        : booleanValue(row.isActive ?? row.is_active, `openingHours[${index}].isActive`),
    }
  })
}

export function openingOverridesPayload(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input) || input.length > 366) {
    throw createError({ statusCode: 400, statusMessage: 'overrides must be an array with at most 366 items' })
  }
  const seenDates = new Set<string>()
  return input.map((raw, index) => {
    const row = recordValue(raw, `overrides[${index}]`)
    const localDate = dateValue(row.localDate ?? row.local_date, `overrides[${index}].localDate`)
    if (seenDates.has(localDate)) {
      throw createError({ statusCode: 400, statusMessage: `Duplicate opening override for ${localDate}` })
    }
    seenDates.add(localDate)
    const isClosed = row.isClosed === undefined && row.is_closed === undefined
      ? false
      : booleanValue(row.isClosed ?? row.is_closed, `overrides[${index}].isClosed`)
    const opensAt = isClosed ? null : localTimeValue(row.opensAt ?? row.opens_at, `overrides[${index}].opensAt`)
    const closesAt = isClosed ? null : localTimeValue(row.closesAt ?? row.closes_at, `overrides[${index}].closesAt`)
    if (opensAt && closesAt && opensAt >= closesAt) {
      throw createError({ statusCode: 400, statusMessage: `overrides[${index}] must end after it starts` })
    }
    return { local_date: localDate, is_closed: isClosed, opens_at: opensAt, closes_at: closesAt }
  })
}

export function availabilityRulesPayload(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input) || input.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'rules must be an array with at most 100 items' })
  }
  return input.map((raw, index) => {
    const row = recordValue(raw, `rules[${index}]`)
    const startsAt = localTimeValue(row.startsAt ?? row.starts_at, `rules[${index}].startsAt`)
    const endsAt = localTimeValue(row.endsAt ?? row.ends_at, `rules[${index}].endsAt`)
    if (startsAt >= endsAt) {
      throw createError({ statusCode: 400, statusMessage: `rules[${index}] must end after it starts` })
    }
    const validFromRaw = row.validFrom ?? row.valid_from
    const validUntilRaw = row.validUntil ?? row.valid_until
    const validFrom = validFromRaw ? dateValue(validFromRaw, `rules[${index}].validFrom`) : null
    const validUntil = validUntilRaw ? dateValue(validUntilRaw, `rules[${index}].validUntil`) : null
    if (validFrom && validUntil && validFrom > validUntil) {
      throw createError({ statusCode: 400, statusMessage: `rules[${index}] has an invalid validity range` })
    }
    return {
      weekday: integerValue(row.weekday, `rules[${index}].weekday`, 0, 6),
      starts_at: startsAt,
      ends_at: endsAt,
      valid_from: validFrom,
      valid_until: validUntil,
      is_active: row.isActive === undefined && row.is_active === undefined
        ? true
        : booleanValue(row.isActive ?? row.is_active, `rules[${index}].isActive`),
    }
  })
}

export function availabilityOverridesPayload(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input) || input.length > 366) {
    throw createError({ statusCode: 400, statusMessage: 'overrides must be an array with at most 366 items' })
  }
  const seenDates = new Set<string>()
  return input.map((raw, index) => {
    const row = recordValue(raw, `overrides[${index}]`)
    const localDate = dateValue(row.localDate ?? row.local_date, `overrides[${index}].localDate`)
    if (seenDates.has(localDate)) {
      throw createError({ statusCode: 400, statusMessage: `Duplicate availability override for ${localDate}` })
    }
    seenDates.add(localDate)
    const isUnavailable = row.isUnavailable === undefined && row.is_unavailable === undefined
      ? false
      : booleanValue(row.isUnavailable ?? row.is_unavailable, `overrides[${index}].isUnavailable`)
    const startsAt = isUnavailable ? null : localTimeValue(row.startsAt ?? row.starts_at, `overrides[${index}].startsAt`)
    const endsAt = isUnavailable ? null : localTimeValue(row.endsAt ?? row.ends_at, `overrides[${index}].endsAt`)
    if (startsAt && endsAt && startsAt >= endsAt) {
      throw createError({ statusCode: 400, statusMessage: `overrides[${index}] must end after it starts` })
    }
    return { local_date: localDate, is_unavailable: isUnavailable, starts_at: startsAt, ends_at: endsAt }
  })
}

export function bookingServiceValues(
  body: Record<string, unknown>,
  options: { create: boolean },
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const nameInput = body.name
  const name = nameInput === undefined
    ? undefined
    : limitedText(nameInput, 'name', 160, { required: true }) as string
  if (options.create && !name) requiredField('name')
  if (name) values.name = name
  if (options.create || 'slug' in body) values.slug = slugValue(body.slug, name as string)
  if ('description' in body) values.description = limitedText(body.description, 'description', 2_000, { nullable: true }) ?? null

  const integers = [
    ['durationMinutes', 'duration_minutes', 5, 1_440, 60],
    ['bufferBeforeMinutes', 'buffer_before_minutes', 0, 1_440, 0],
    ['bufferAfterMinutes', 'buffer_after_minutes', 0, 1_440, 0],
    ['slotIntervalMinutes', 'slot_interval_minutes', 5, 1_440, 15],
    ['minNoticeMinutes', 'min_notice_minutes', 0, 525_600, 60],
    ['maxAdvanceDays', 'max_advance_days', 1, 730, 90],
  ] as const
  for (const [camel, snake, minimum, maximum, defaultValue] of integers) {
    const input = body[camel] ?? body[snake]
    if (input !== undefined || options.create) {
      values[snake] = input === undefined
        ? defaultValue
        : integerValue(input, camel, minimum, maximum)
    }
  }

  if ('isActive' in body || 'is_active' in body || options.create) {
    const input = body.isActive ?? body.is_active
    values.is_active = input === undefined ? true : booleanValue(input, 'isActive')
  }
  return values
}

export function accentColorValue(input: unknown, field = 'accentColor'): string {
  if (input === null || input === '') return '#2563eb'
  const value = limitedText(input, field, 20, { required: true }) as string
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a six-digit hex color` })
  }
  return value.toLowerCase()
}

export function bookingWidgetValues(
  body: Record<string, unknown>,
  options: { create: boolean; facilityName: string },
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const name = body.name === undefined
    ? undefined
    : limitedText(body.name, 'name', 160, { required: true }) as string
  if (options.create && !name) requiredField('name')
  if (name) values.name = name
  if (options.create || 'slug' in body) values.slug = slugValue(body.slug, name ?? options.facilityName)
  if (options.create || 'title' in body) {
    values.title = body.title === undefined
      ? (name ?? options.facilityName)
      : limitedText(body.title, 'title', 200, { required: true })
  }
  if ('subtitle' in body) values.subtitle = limitedText(body.subtitle, 'subtitle', 500, { nullable: true }) ?? null
  if (options.create || 'theme' in body) {
    values.theme = body.theme === undefined
      ? 'auto'
      : enumValue(body.theme, 'theme', ['light', 'dark', 'auto'] as const)
  }
  if ('accentColor' in body || 'accent_color' in body) {
    values.accent_color = accentColorValue(body.accentColor ?? body.accent_color)
  }
  if (options.create || 'allowedOrigins' in body || 'allowed_origins' in body) {
    const input = body.allowedOrigins ?? body.allowed_origins
    values.allowed_origins = input === undefined ? [] : allowedOriginsValue(input)
  }
  if (options.create || 'bookingMode' in body || 'booking_mode' in body) {
    const input = body.bookingMode ?? body.booking_mode
    values.booking_mode = input === undefined
      ? 'both'
      : enumValue(input, 'bookingMode', ['facility', 'expert', 'both'] as const)
  }
  if (options.create || 'widgetType' in body || 'widget_type' in body) {
    const input = body.widgetType ?? body.widget_type
    values.widget_type = input === undefined
      ? 'calendar'
      : enumValue(input, 'widgetType', ['calendar', 'mortgage_capacity', 'mortgage_payment'] as const)
  }
  if (options.create) {
    values.fixed_expert_user_id = optionalUuidValue(
      body.fixedExpertUserId ?? body.fixed_expert_user_id,
      'fixedExpertUserId',
    )
  }
  if (options.create || 'locale' in body) {
    values.locale = body.locale === undefined ? 'pl-PL' : localeValue(body.locale)
  }
  if (options.create || 'isActive' in body || 'is_active' in body) {
    const input = body.isActive ?? body.is_active
    values.is_active = input === undefined ? true : booleanValue(input, 'isActive')
  }
  if (options.create || 'isDirectoryListed' in body || 'is_directory_listed' in body) {
    const input = body.isDirectoryListed ?? body.is_directory_listed
    values.is_directory_listed = input === undefined
      ? false
      : booleanValue(input, 'isDirectoryListed')
  }
  return values
}

export function assertBookingWidgetDirectoryEligibility(input: {
  isActive: boolean
  isDirectoryListed: boolean
  widgetType: BookingWidgetType
}): void {
  if (!input.isDirectoryListed) return
  if (!input.isActive) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only an active widget can be listed in the OpenExpert directory',
    })
  }
  if (input.widgetType !== 'calendar') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only a calendar widget can be listed in the OpenExpert directory',
    })
  }
}

export function decorateBookingWidget(
  event: H3Event,
  widget: Record<string, any>,
  serviceIds: string[] = [],
): Record<string, unknown> {
  const widgetKey = String(widget.public_token ?? widget.widgetKey ?? '')
  const origin = getRequestURL(event).origin
  const publicUrl = `${origin}/book/${encodeURIComponent(widgetKey)}`
  const embedUrl = `${publicUrl}?embed=1`
  const escapedEmbedUrl = embedUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  const widgetType = String(widget.widget_type ?? widget.widgetType ?? 'calendar') as BookingWidgetType
  const embedTitle = widgetType === 'mortgage_capacity'
    ? 'Kalkulator zdolności i rezerwacja spotkania'
    : widgetType === 'mortgage_payment'
      ? 'Kalkulator raty i rezerwacja spotkania'
      : 'Rezerwacja wizyty'
  const minimumHeight = widgetType === 'calendar' ? 720 : 920
  return {
    ...widget,
    widgetKey,
    publicUrl,
    embedUrl,
    embedCode: `<iframe src="${escapedEmbedUrl}" title="${embedTitle}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;min-height:${minimumHeight}px;border:0" allow="clipboard-write"></iframe>`,
    serviceIds,
  }
}

export function throwBookingError(error: { code?: string; message?: string } | null | undefined): void {
  if (!error) return
  const message = String(error.message ?? '')
  if (/idempotency_key_reused/i.test(message)) {
    throw createError({ statusCode: 409, statusMessage: 'This booking request key was already used' })
  }
  if (/customer_contact_matches_multiple_clients/i.test(message)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The contact details match more than one client. Contact the facility to book.',
    })
  }
  if (/consent_(?:catalogue|definition)_is_stale/i.test(message)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent definitions changed. Refresh the widget and try again.',
    })
  }
  if (/required_consent_not_granted|consent_contact_value_is_required/i.test(message)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The consent decisions do not match the provided contact data',
    })
  }
  if (/customer_phone_is_required/i.test(message)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'A phone number is required for this booking',
    })
  }
  if (/invalid_booking_(?:calculation|context)|customer_(?:phone|email)_is_required/i.test(message)) {
    throw createError({ statusCode: 422, statusMessage: 'The booking contact or calculation data is invalid' })
  }
  if (
    error.code === '23P01'
    || error.code === '23505'
    || /booking_conflict|slot_(?:unavailable|already_booked)|appointment_conflict|no_available_expert|facility_closed/i.test(message)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'This slot is no longer available' })
  }
  if (error.code === '22P02' || /widget_not_found|widget_inactive/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }
  if (
    /service_not_available|expert_not_available|outside_booking_window|booking_widget_(?:requires_expert|does_not_allow_expert_selection|is_fixed_to_another_expert)|invalid_booking_(?:request|replay_request)/i.test(message)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'The selected booking option is not available' })
  }
  if (/invalid_staff_booking_request|expert_not_bookable_for_service/i.test(message)) {
    throw createError({ statusCode: 400, statusMessage: 'The staff booking request is invalid' })
  }
  if (/facility_membership_required/i.test(message)) {
    throw createError({ statusCode: 403, statusMessage: 'Facility access is required' })
  }
  if (/booking_widget_origin_not_allowed/i.test(message)) {
    throw createError({ statusCode: 403, statusMessage: 'Widget origin is not allowed' })
  }
  if (/crm_client_person_not_found/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Client person not found' })
  }
  if (/crm_client_not_found/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }
  if (/facility_(?:service_)?not_found/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Facility booking configuration not found' })
  }
  console.error('[booking] database operation failed', {
    code: error.code,
    message: error.message,
  })
  throw createError({ statusCode: 500, statusMessage: 'Booking service is temporarily unavailable' })
}

export function catalogAllowedOrigins(raw: unknown): string[] {
  const catalog = asRecord(raw)
  const privateConfig = asRecord(catalog.private ?? catalog._private)
  const widget = asRecord(catalog.widget)
  const value = privateConfig.allowedOrigins
    ?? privateConfig.allowed_origins
    ?? widget.allowedOrigins
    ?? widget.allowed_origins
    ?? catalog.allowedOrigins
    ?? catalog.allowed_origins
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'string') return []
    try {
      return [normalizeOrigin(item)]
    } catch {
      return []
    }
  })
}

export function assertWidgetRequestOrigin(
  event: H3Event,
  allowedOrigins: string[],
  widgetKey: string,
  options: { requireSource?: boolean } = {},
): void {
  const originHeader = getHeader(event, 'origin')
  const refererHeader = getHeader(event, 'referer')
  const requestUrl = getRequestURL(event)

  let sourceOrigin: string | null = null
  let refererUrl: URL | null = null
  try {
    if (originHeader && originHeader !== 'null') sourceOrigin = normalizeOrigin(originHeader)
    if (refererHeader) {
      refererUrl = new URL(refererHeader)
      sourceOrigin ??= refererUrl.origin
    }
  } catch {
    throw createError({ statusCode: 403, statusMessage: 'Widget origin is not allowed' })
  }

  // Server-side rendering and direct API navigation may omit both headers. The
  // public key remains an unguessable capability and the booking RPC still
  // performs all business validation.
  if (!sourceOrigin) {
    if (options.requireSource) {
      throw createError({ statusCode: 403, statusMessage: 'Widget request source is required' })
    }
    return
  }

  if (sourceOrigin === requestUrl.origin) {
    if (!refererUrl || refererUrl.pathname.startsWith(`/book/${encodeURIComponent(widgetKey)}`)) return
    // Same-origin administration previews are also safe because no foreign
    // website can forge the browser's Origin header.
    return
  }

  if (!allowedOrigins.includes(sourceOrigin)) {
    throw createError({ statusCode: 403, statusMessage: 'Widget origin is not allowed' })
  }
  setHeader(event, 'Access-Control-Allow-Origin', sourceOrigin)
  setHeader(event, 'Vary', 'Origin')
}

export function sanitizePublicCatalog(raw: unknown, widgetKey: string): PublicWidgetCatalog {
  const catalog = asRecord(raw)
  const widget = asRecord(catalog.widget)
  const facility = asRecord(catalog.facility)
  const themeValue = ['light', 'dark', 'auto'].includes(String(widget.theme))
    ? String(widget.theme) as 'light' | 'dark' | 'auto'
    : 'auto'
  const addressParts = [
    facility.address,
    facility.address_line1,
    facility.address_line2,
    [facility.postal_code, facility.city].filter(Boolean).join(' '),
  ]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => String(value).trim())

  const servicesRaw = Array.isArray(catalog.services) ? catalog.services : []
  const expertsRaw = Array.isArray(catalog.experts) ? catalog.experts : []
  const consentsRaw = Array.isArray(catalog.consents) ? catalog.consents : []
  const widgetTypeValue = String(widget.widgetType ?? widget.widget_type ?? 'calendar')
  const widgetType: BookingWidgetType = ['calendar', 'mortgage_capacity', 'mortgage_payment'].includes(widgetTypeValue)
    ? widgetTypeValue as BookingWidgetType
    : 'calendar'
  const fixedExpertUserIdValue = widget.fixedExpertUserId ?? widget.fixed_expert_user_id
  let capacityPolicy = defaultMortgageCapacityPolicy()
  const capacityPolicyRaw = catalog.capacityPolicy ?? catalog.capacity_policy
  if (capacityPolicyRaw && typeof capacityPolicyRaw === 'object' && !Array.isArray(capacityPolicyRaw)) {
    try {
      capacityPolicy = sanitizeMortgageCapacityPolicy(capacityPolicyRaw)
    } catch (error) {
      console.error('[booking] invalid capacity policy in public widget catalog', error)
    }
  }
  const capacityPolicyRevisionValue = Number(
    catalog.capacityPolicyRevision ?? catalog.capacity_policy_revision ?? 0,
  )
  const capacityPolicyRevision = widgetType === 'mortgage_capacity'
    && Number.isSafeInteger(capacityPolicyRevisionValue)
    && capacityPolicyRevisionValue >= 0
    ? capacityPolicyRevisionValue
    : widgetType === 'mortgage_capacity' ? 0 : null

  return {
    widget: {
      key: widgetKey,
      title: String(widget.title ?? facility.name ?? ''),
      subtitle: typeof widget.subtitle === 'string' && widget.subtitle.trim()
        ? widget.subtitle.trim()
        : null,
      theme: themeValue,
      accentColor: typeof (widget.accentColor ?? widget.accent_color) === 'string'
        ? String(widget.accentColor ?? widget.accent_color)
        : '#2563eb',
      bookingMode: ['facility', 'expert', 'both'].includes(String(widget.bookingMode ?? widget.booking_mode))
        ? String(widget.bookingMode ?? widget.booking_mode) as 'facility' | 'expert' | 'both'
        : 'both',
      widgetType,
      fixedExpertUserId: fixedExpertUserIdValue ? String(fixedExpertUserIdValue) : null,
    },
    facility: {
      id: String(facility.id ?? ''),
      name: String(facility.name ?? ''),
      address: addressParts.length ? addressParts.join(', ') : null,
      timezone: String(facility.timezone ?? 'Europe/Warsaw'),
    },
    services: servicesRaw.flatMap((input) => {
      const service = asRecord(input)
      if (!service.id || !service.name) return []
      return [{
        id: String(service.id),
        name: String(service.name),
        description: typeof service.description === 'string' && service.description.trim()
          ? service.description.trim()
          : null,
        durationMinutes: Number(service.durationMinutes ?? service.duration_minutes ?? 0),
      }]
    }),
    experts: expertsRaw.flatMap((input) => {
      const expert = asRecord(input)
      const userId = expert.userId ?? expert.user_id
      if (!userId) return []
      const serviceIds = expert.serviceIds ?? expert.service_ids
      return [{
        userId: String(userId),
        name: String(expert.name ?? expert.full_name ?? ''),
        avatarUrl: typeof (expert.avatarUrl ?? expert.avatar_url) === 'string'
          ? String(expert.avatarUrl ?? expert.avatar_url)
          : null,
        ...(Array.isArray(serviceIds)
          ? { serviceIds: serviceIds.map(String) }
          : {}),
      }]
    }),
    consents: consentsRaw.flatMap((input) => {
      const consent = asRecord(input)
      const definitionId = consent.definitionId ?? consent.definition_id
      const versionId = consent.versionId ?? consent.version_id
      const title = consent.title ?? consent.displayTitle ?? consent.display_title
      const channel = String(consent.channel ?? '')
      if (
        !definitionId
        || !versionId
        || !title
        || !['email', 'sms', 'phone', 'messaging', 'other'].includes(channel)
      ) return []
      return [{
        definitionId: String(definitionId),
        versionId: String(versionId),
        title: String(title),
        content: String(consent.content ?? ''),
        purpose: String(consent.purpose ?? ''),
        channel: channel as 'email' | 'sms' | 'phone' | 'messaging' | 'other',
        legalBasis: String(consent.legalBasis ?? consent.legal_basis ?? ''),
        isRequired: consent.isRequired === true || consent.is_required === true,
      }]
    }),
    capacityPolicy,
    capacityPolicyRevision,
  }
}
