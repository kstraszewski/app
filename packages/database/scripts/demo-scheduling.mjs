import { createHash } from 'node:crypto'

const WARSAW_TIME_ZONE = 'Europe/Warsaw'
const DAY_MS = 24 * 60 * 60 * 1_000

const DEMO_IDS = Object.freeze({
  services: {
    capacityAnalysis: 'd3100001-1000-4000-8000-000000000001',
    creditConsultation: 'd3100001-1000-4000-8000-000000000002',
    documentSigning: 'd3100001-1000-4000-8000-000000000003',
  },
  openingHours: [
    'd3100002-1000-4000-8000-000000000001',
    'd3100002-1000-4000-8000-000000000002',
    'd3100002-1000-4000-8000-000000000003',
    'd3100002-1000-4000-8000-000000000004',
    'd3100002-1000-4000-8000-000000000005',
  ],
  expertRules: [
    'd3100003-1000-4000-8000-000000000001',
    'd3100003-1000-4000-8000-000000000002',
    'd3100003-1000-4000-8000-000000000003',
    'd3100003-1000-4000-8000-000000000004',
    'd3100003-1000-4000-8000-000000000005',
  ],
  facilityOverrides: {
    tomorrow: 'd3100004-1000-4000-8000-000000000001',
    closed: 'd3100004-1000-4000-8000-000000000002',
    custom: 'd3100004-1000-4000-8000-000000000003',
  },
  expertOverrides: {
    tomorrow: 'd3100005-1000-4000-8000-000000000001',
    custom: 'd3100005-1000-4000-8000-000000000002',
  },
  widgets: {
    calendar: {
      id: 'd3100006-1000-4000-8000-000000000001',
      token: 'd3100006-2000-4000-8000-000000000001',
    },
    capacity: {
      id: 'd3100006-1000-4000-8000-000000000002',
      token: 'd3100006-2000-4000-8000-000000000002',
    },
    payment: {
      id: 'd3100006-1000-4000-8000-000000000003',
      token: 'd3100006-2000-4000-8000-000000000003',
    },
  },
  appointments: [
    'd3100007-1000-4000-8000-000000000001',
    'd3100007-1000-4000-8000-000000000002',
    'd3100007-1000-4000-8000-000000000003',
    'd3100007-1000-4000-8000-000000000004',
    'd3100007-1000-4000-8000-000000000005',
    'd3100007-1000-4000-8000-000000000006',
  ],
  appointmentManageTokens: [
    'd3100007-2000-4000-8000-000000000001',
    'd3100007-2000-4000-8000-000000000002',
    'd3100007-2000-4000-8000-000000000003',
    'd3100007-2000-4000-8000-000000000004',
    'd3100007-2000-4000-8000-000000000005',
    'd3100007-2000-4000-8000-000000000006',
  ],
})

const WIDGET_IDS = Object.values(DEMO_IDS.widgets).map(widget => widget.id)
const APPOINTMENT_IDS = [...DEMO_IDS.appointments]

function errorDetail(error) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const values = Object.fromEntries(
      Object.getOwnPropertyNames(error).map(key => [key, error[key]]),
    )
    return JSON.stringify(values)
  }
  return String(error)
}

function assertNoError(error, operation) {
  if (error) throw new Error(operation + ': ' + errorDetail(error))
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Demo scheduling requires ${field}.`)
  }
  return value
}

function asDate(seedNow) {
  const value = seedNow instanceof Date ? new Date(seedNow) : new Date(seedNow)
  if (Number.isNaN(value.valueOf())) {
    throw new Error('Demo scheduling requires a valid seedNow.')
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function deterministicUuid(value) {
  const digest = sha256(value)
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-')
}

function localDateParts(date, timeZone = WARSAW_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  }
}

function localDateString(date, timeZone = WARSAW_TIME_ZONE) {
  const { year, month, day } = localDateParts(date, timeZone)
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')
}

function addCivilDays(localDate, days) {
  const [year, month, day] = localDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

function civilWeekday(localDate) {
  const [year, month, day] = localDate.split('-').map(Number)
  const sundayFirst = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
  return (sundayFirst + 6) % 7
}

function previousWeekdays(beforeDate, count) {
  const dates = []
  for (let offset = 1; dates.length < count; offset += 1) {
    const candidate = addCivilDays(beforeDate, -offset)
    if (civilWeekday(candidate) < 5) dates.push(candidate)
  }
  return dates
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return representedAsUtc - Math.floor(date.valueOf() / 1_000) * 1_000
}

function zonedDateTimeIso(localDate, localTime, timeZone = WARSAW_TIME_ZONE) {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = localTime.split(':').map(Number)
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  let offset = timeZoneOffsetMs(new Date(wallClockAsUtc), timeZone)
  let instant = wallClockAsUtc - offset
  const correctedOffset = timeZoneOffsetMs(new Date(instant), timeZone)
  if (correctedOffset !== offset) {
    offset = correctedOffset
    instant = wallClockAsUtc - offset
  }
  return new Date(instant).toISOString()
}

function localTimeString(instant, timeZone = WARSAW_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.hour}:${values.minute}`
}

function clientRecord(input, index) {
  const id = requiredString(input?.id, `clients[${index}].id`)
  const displayName = (
    input.display_name
    ?? input.displayName
    ?? `Klient demonstracyjny ${index + 1}`
  )
  const personId = input.primaryPerson?.id ?? input.personId ?? null
  return {
    id,
    personId,
    displayName: requiredString(displayName, `clients[${index}].display_name`),
    email: typeof input.primary_email === 'string'
      ? input.primary_email.trim().toLowerCase() || null
      : null,
    phone: typeof input.primary_phone === 'string'
      ? input.primary_phone.trim() || null
      : null,
  }
}

function eventStages(widgetType, serviceId, completesBooking) {
  const stages = widgetType === 'calendar'
    ? [
        ['widget_view', null],
        ['widget_engaged', null],
        ['service_selected', serviceId],
        ['availability_search', serviceId],
        ['availability_found', serviceId],
        ['slot_selected', serviceId],
        ['contact_started', serviceId],
      ]
    : [
        ['widget_view', null],
        ['widget_engaged', null],
        ['calculator_started', null],
        ['calculator_completed', null],
        ['service_selected', serviceId],
        ['availability_search', serviceId],
        ['availability_found', serviceId],
        ['slot_selected', serviceId],
        ['contact_started', serviceId],
      ]

  if (completesBooking) {
    stages.push(
      ['booking_attempt', serviceId],
      ['booking_completed', serviceId],
    )
  } else if (widgetType !== 'calendar') {
    stages.pop()
    stages.pop()
  }
  return stages
}

function buildWidgetEvents({
  organizationId,
  facilityId,
  widgets,
  serviceByWidget,
  seedNow,
}) {
  const events = []
  const visitIds = []
  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    widgets.forEach((widget, widgetIndex) => {
      const visitId = deterministicUuid(
        `openexpert:demo-scheduling:visit:${daysAgo}:${widget.widget_type}`,
      )
      visitIds.push(visitId)
      const bookingKey = `openexpert-demo-booking-${daysAgo}-${widget.widget_type}`
      const bookingEventId = sha256(bookingKey)
      const completesBooking = (daysAgo + widgetIndex) % 3 !== 1
      const anchor = seedNow.valueOf() - daysAgo * DAY_MS - 8 * 60 * 60 * 1_000
      const stages = eventStages(
        widget.widget_type,
        serviceByWidget.get(widget.id),
        completesBooking,
      )

      stages.forEach(([eventType, serviceId], stageIndex) => {
        events.push({
          organization_id: organizationId,
          facility_id: facilityId,
          widget_id: widget.id,
          visit_id: visitId,
          event_type: eventType,
          service_id: serviceId,
          event_id: ['booking_attempt', 'booking_completed'].includes(eventType)
            ? bookingEventId
            : null,
          is_embedded: (daysAgo + widgetIndex) % 2 === 0,
          occurred_at: new Date(anchor + stageIndex * 3 * 60 * 1_000).toISOString(),
        })
      })
    })
  }
  return { events, visitIds }
}

function appointmentRow({
  id,
  manageToken,
  organizationId,
  facilityId,
  service,
  expertUserId,
  client,
  widget,
  startsAt,
  endsAt,
  status,
  createdAt,
  seedNow,
  notes,
  bookingContext = {},
}) {
  const idempotencyKey = `demo-scheduling:${id}`
  const isConfirmed = status === 'confirmed'
  const isCancelled = status === 'cancelled'
  return {
    id,
    organization_id: organizationId,
    facility_id: facilityId,
    service_id: service.id,
    expert_user_id: expertUserId,
    widget_id: widget?.id ?? null,
    client_id: client.id,
    client_person_id: client.personId,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: WARSAW_TIME_ZONE,
    status,
    hold_expires_at: null,
    confirmed_at: isConfirmed ? createdAt : null,
    cancelled_at: isCancelled ? endsAt : null,
    cancellation_reason: isCancelled ? 'Termin odwołany przez klienta' : null,
    customer_name: client.displayName,
    customer_email: client.email,
    customer_phone: client.phone,
    notes,
    source: widget ? 'widget' : 'staff',
    idempotency_key: idempotencyKey,
    manage_token: manageToken,
    created_by_user_id: expertUserId,
    booking_context: bookingContext,
    request_fingerprint: widget ? sha256(idempotencyKey) : null,
    created_at: createdAt,
    updated_at: seedNow.toISOString(),
  }
}

async function deleteInChunks(queryFactory, values, operation) {
  for (let index = 0; index < values.length; index += 20) {
    const chunk = values.slice(index, index + 20)
    const { error } = await queryFactory(chunk)
    assertNoError(error, operation)
  }
}

async function tableCount(adminClient, table, filters = []) {
  let query = adminClient.from(table).select('*', { count: 'exact', head: true })
  for (const [column, operator, value] of filters) {
    if (operator === 'eq') query = query.eq(column, value)
    else if (operator === 'in') query = query.in(column, value)
    else throw new Error(`Unsupported count filter operator: ${operator}`)
  }
  const { count, error } = await query
  assertNoError(error, `Counting ${table}`)
  return count ?? 0
}

const appointmentReconcileFields = [
  'organization_id',
  'facility_id',
  'service_id',
  'expert_user_id',
  'widget_id',
  'client_id',
  'client_person_id',
  'starts_at',
  'ends_at',
  'timezone',
  'status',
  'hold_expires_at',
  'confirmed_at',
  'cancelled_at',
  'cancellation_reason',
  'customer_name',
  'customer_email',
  'customer_phone',
  'notes',
  'source',
  'idempotency_key',
  'manage_token',
  'created_by_user_id',
  'booking_context',
  'request_fingerprint',
]

const appointmentTimestampFields = new Set([
  'starts_at',
  'ends_at',
  'hold_expires_at',
  'confirmed_at',
  'cancelled_at',
])

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      key => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function appointmentValue(field, value) {
  if (value == null) return null
  if (appointmentTimestampFields.has(field)) return new Date(value).toISOString()
  if (field === 'booking_context') return stableJson(value)
  return value
}

function changedAppointmentValues(existing, desired) {
  const changed = {}
  for (const field of appointmentReconcileFields) {
    if (appointmentValue(field, existing[field]) !== appointmentValue(field, desired[field])) {
      changed[field] = desired[field]
    }
  }
  return changed
}

export async function seedDemoScheduling({
  adminClient,
  profile,
  facility,
  meetingService,
  clients,
  seedNow,
}) {
  if (!adminClient?.from || !adminClient?.rpc) {
    throw new Error('Demo scheduling requires a Supabase adminClient.')
  }
  const organizationId = requiredString(
    profile?.organization_id ?? profile?.organizationId,
    'profile.organization_id',
  )
  const expertUserId = requiredString(profile?.id, 'profile.id')
  const facilityId = requiredString(facility?.id, 'facility.id')
  const meetingServiceId = requiredString(meetingService?.id, 'meetingService.id')
  const normalizedClients = Array.isArray(clients)
    ? clients.map(clientRecord)
    : []
  if (normalizedClients.length === 0) {
    throw new Error('Demo scheduling requires at least one seeded CRM client.')
  }

  const now = asDate(seedNow)
  const nowIso = now.toISOString()
  const warsawToday = localDateString(now)
  const demoDate = addCivilDays(warsawToday, 1)
  const closedDate = addCivilDays(demoDate, 1)
  const customDate = addCivilDays(demoDate, 2)
  const analyticsStartedAt = new Date(now.valueOf() - 15 * DAY_MS).toISOString()

  const openingHours = DEMO_IDS.openingHours.map((id, weekday) => ({
    id,
    organization_id: organizationId,
    facility_id: facilityId,
    weekday,
    opens_at: '08:00:00',
    closes_at: '18:00:00',
    is_active: true,
    updated_at: nowIso,
  }))
  const { error: openingHoursError } = await adminClient
    .from('facility_opening_hours')
    .upsert(openingHours, { onConflict: 'id' })
  assertNoError(openingHoursError, 'Seeding facility opening hours')

  const expertRules = DEMO_IDS.expertRules.map((id, weekday) => ({
    id,
    organization_id: organizationId,
    facility_id: facilityId,
    user_id: expertUserId,
    weekday,
    starts_at: '09:00:00',
    ends_at: '17:00:00',
    valid_from: null,
    valid_until: null,
    is_active: true,
    updated_at: nowIso,
  }))
  const { error: expertRulesError } = await adminClient
    .from('expert_availability_rules')
    .upsert(expertRules, { onConflict: 'id' })
  assertNoError(expertRulesError, 'Seeding expert availability rules')

  const facilityOverrides = [
    {
      id: DEMO_IDS.facilityOverrides.tomorrow,
      organization_id: organizationId,
      facility_id: facilityId,
      local_date: demoDate,
      is_closed: false,
      opens_at: '08:00:00',
      closes_at: '18:00:00',
      updated_at: nowIso,
    },
    {
      id: DEMO_IDS.facilityOverrides.closed,
      organization_id: organizationId,
      facility_id: facilityId,
      local_date: closedDate,
      is_closed: true,
      opens_at: null,
      closes_at: null,
      updated_at: nowIso,
    },
    {
      id: DEMO_IDS.facilityOverrides.custom,
      organization_id: organizationId,
      facility_id: facilityId,
      local_date: customDate,
      is_closed: false,
      opens_at: '10:00:00',
      closes_at: '16:00:00',
      updated_at: nowIso,
    },
  ]
  const { error: facilityOverridesError } = await adminClient
    .from('facility_opening_overrides')
    .upsert(facilityOverrides, { onConflict: 'id' })
  assertNoError(facilityOverridesError, 'Seeding facility opening overrides')

  const expertOverrides = [
    {
      id: DEMO_IDS.expertOverrides.tomorrow,
      organization_id: organizationId,
      facility_id: facilityId,
      user_id: expertUserId,
      local_date: demoDate,
      is_unavailable: false,
      starts_at: '09:00:00',
      ends_at: '17:00:00',
      updated_at: nowIso,
    },
    {
      id: DEMO_IDS.expertOverrides.custom,
      organization_id: organizationId,
      facility_id: facilityId,
      user_id: expertUserId,
      local_date: customDate,
      is_unavailable: false,
      starts_at: '11:00:00',
      ends_at: '15:00:00',
      updated_at: nowIso,
    },
  ]
  const { error: expertOverridesError } = await adminClient
    .from('expert_availability_overrides')
    .upsert(expertOverrides, { onConflict: 'id' })
  assertNoError(expertOverridesError, 'Seeding expert availability overrides')

  const additionalServices = [
    {
      id: DEMO_IDS.services.capacityAnalysis,
      organization_id: organizationId,
      name: 'Analiza zdolności kredytowej',
      slug: 'analiza-zdolnosci-kredytowej',
      description: 'Analiza dochodów, zobowiązań i możliwego poziomu finansowania.',
      duration_minutes: 45,
      buffer_before_minutes: 15,
      buffer_after_minutes: 15,
      slot_interval_minutes: 15,
      min_notice_minutes: 60,
      max_advance_days: 90,
      is_active: true,
      updated_at: nowIso,
    },
    {
      id: DEMO_IDS.services.creditConsultation,
      organization_id: organizationId,
      name: 'Konsultacja kredytowa',
      slug: 'konsultacja-kredytowa',
      description: 'Omówienie celu, wkładu własnego i dostępnych ścieżek kredytowych.',
      duration_minutes: 60,
      buffer_before_minutes: 10,
      buffer_after_minutes: 10,
      slot_interval_minutes: 15,
      min_notice_minutes: 120,
      max_advance_days: 120,
      is_active: true,
      updated_at: nowIso,
    },
    {
      id: DEMO_IDS.services.documentSigning,
      organization_id: organizationId,
      name: 'Podpisanie dokumentów',
      slug: 'podpisanie-dokumentow',
      description: 'Spotkanie przeznaczone na przegląd i podpisanie przygotowanych dokumentów.',
      duration_minutes: 30,
      buffer_before_minutes: 0,
      buffer_after_minutes: 15,
      slot_interval_minutes: 15,
      min_notice_minutes: 180,
      max_advance_days: 60,
      is_active: true,
      updated_at: nowIso,
    },
  ]
  const { data: insertedServices, error: servicesError } = await adminClient
    .from('booking_services')
    .upsert(additionalServices, { onConflict: 'id' })
    .select('*')
  assertNoError(servicesError, 'Seeding additional booking services')

  const services = [
    {
      ...meetingService,
      id: meetingServiceId,
      organization_id: organizationId,
    },
    ...(insertedServices ?? additionalServices),
  ]
  const allServiceIds = services.map(service => service.id)
  const { error: facilityServicesError } = await adminClient
    .from('facility_services')
    .upsert(
      allServiceIds.map(serviceId => ({
        organization_id: organizationId,
        facility_id: facilityId,
        service_id: serviceId,
        is_active: true,
        updated_at: nowIso,
      })),
      { onConflict: 'organization_id,facility_id,service_id' },
    )
  assertNoError(facilityServicesError, 'Enabling demo services at the facility')

  const { error: serviceExpertsError } = await adminClient
    .from('facility_service_experts')
    .upsert(
      allServiceIds.map(serviceId => ({
        organization_id: organizationId,
        facility_id: facilityId,
        service_id: serviceId,
        user_id: expertUserId,
        is_active: true,
        updated_at: nowIso,
      })),
      { onConflict: 'organization_id,facility_id,service_id,user_id' },
    )
  assertNoError(serviceExpertsError, 'Assigning the demo expert to booking services')

  const widgetsSeed = [
    {
      id: DEMO_IDS.widgets.calendar.id,
      public_token: DEMO_IDS.widgets.calendar.token,
      organization_id: organizationId,
      facility_id: facilityId,
      name: 'Umów spotkanie',
      slug: 'umow-spotkanie',
      title: 'Umów spotkanie z ekspertem',
      subtitle: 'Wybierz usługę, dogodny termin i potwierdź rezerwację.',
      widget_type: 'calendar',
      theme: 'auto',
      accent_color: '#2563EB',
      allowed_origins: [],
      booking_mode: 'both',
      fixed_expert_user_id: null,
      created_by_user_id: expertUserId,
      locale: 'pl-PL',
      is_active: true,
      is_directory_listed: true,
      analytics_started_at: analyticsStartedAt,
      updated_at: nowIso,
    },
    {
      id: DEMO_IDS.widgets.capacity.id,
      public_token: DEMO_IDS.widgets.capacity.token,
      organization_id: organizationId,
      facility_id: facilityId,
      name: 'Kalkulator zdolności',
      slug: 'kalkulator-zdolnosci',
      title: 'Sprawdź swoją zdolność kredytową',
      subtitle: 'Oszacuj możliwości i umów rozmowę z ekspertem.',
      widget_type: 'mortgage_capacity',
      theme: 'auto',
      accent_color: '#2563EB',
      allowed_origins: [],
      booking_mode: 'expert',
      fixed_expert_user_id: expertUserId,
      created_by_user_id: expertUserId,
      locale: 'pl-PL',
      is_active: true,
      analytics_started_at: analyticsStartedAt,
      updated_at: nowIso,
    },
    {
      id: DEMO_IDS.widgets.payment.id,
      public_token: DEMO_IDS.widgets.payment.token,
      organization_id: organizationId,
      facility_id: facilityId,
      name: 'Kalkulator raty',
      slug: 'kalkulator-raty',
      title: 'Oblicz orientacyjną ratę kredytu',
      subtitle: 'Porównaj scenariusze i przejdź do konsultacji.',
      widget_type: 'mortgage_payment',
      theme: 'dark',
      accent_color: '#16A34A',
      allowed_origins: [],
      booking_mode: 'expert',
      fixed_expert_user_id: expertUserId,
      created_by_user_id: expertUserId,
      locale: 'pl-PL',
      is_active: true,
      analytics_started_at: analyticsStartedAt,
      updated_at: nowIso,
    },
  ]
  const { data: widgets, error: widgetsError } = await adminClient
    .from('booking_widgets')
    .upsert(widgetsSeed, { onConflict: 'id' })
    .select('*')
  assertNoError(widgetsError, 'Seeding booking widgets')

  const widgetByType = new Map(
    (widgets ?? widgetsSeed).map(widget => [widget.widget_type, widget]),
  )
  const calendarWidget = widgetByType.get('calendar')
  const capacityWidget = widgetByType.get('mortgage_capacity')
  const paymentWidget = widgetByType.get('mortgage_payment')
  if (!calendarWidget || !capacityWidget || !paymentWidget) {
    throw new Error('Demo booking widgets were not returned after upsert.')
  }

  const widgetServiceLinks = [
    ...allServiceIds.map(serviceId => ({
      organization_id: organizationId,
      facility_id: facilityId,
      widget_id: calendarWidget.id,
      service_id: serviceId,
    })),
    {
      organization_id: organizationId,
      facility_id: facilityId,
      widget_id: capacityWidget.id,
      service_id: meetingServiceId,
    },
    {
      organization_id: organizationId,
      facility_id: facilityId,
      widget_id: capacityWidget.id,
      service_id: DEMO_IDS.services.capacityAnalysis,
    },
    {
      organization_id: organizationId,
      facility_id: facilityId,
      widget_id: paymentWidget.id,
      service_id: meetingServiceId,
    },
    {
      organization_id: organizationId,
      facility_id: facilityId,
      widget_id: paymentWidget.id,
      service_id: DEMO_IDS.services.creditConsultation,
    },
  ]
  const { error: deleteWidgetServicesError } = await adminClient
    .from('booking_widget_services')
    .delete()
    .eq('organization_id', organizationId)
    .eq('facility_id', facilityId)
    .in('widget_id', WIDGET_IDS)
  assertNoError(deleteWidgetServicesError, 'Resetting demo widget service links')
  const { error: widgetServicesError } = await adminClient
    .from('booking_widget_services')
    .insert(widgetServiceLinks)
  assertNoError(widgetServicesError, 'Linking services to demo widgets')

  const serviceByWidget = new Map([
    [calendarWidget.id, meetingServiceId],
    [capacityWidget.id, DEMO_IDS.services.capacityAnalysis],
    [paymentWidget.id, DEMO_IDS.services.creditConsultation],
  ])
  const { events, visitIds } = buildWidgetEvents({
    organizationId,
    facilityId,
    widgets: [calendarWidget, capacityWidget, paymentWidget],
    serviceByWidget,
    seedNow: now,
  })
  await deleteInChunks(
    visitIdChunk => adminClient
      .from('booking_widget_events')
      .delete()
      .eq('organization_id', organizationId)
      .in('widget_id', WIDGET_IDS)
      .in('visit_id', visitIdChunk),
    visitIds,
    'Resetting synthetic booking widget events',
  )
  const { error: eventsError } = await adminClient
    .from('booking_widget_events')
    .insert(events)
  assertNoError(eventsError, 'Seeding synthetic booking widget events')

  const { data: existingAppointments, error: existingAppointmentsError } = await adminClient
    .from('appointments')
    .select('*')
    .eq('organization_id', organizationId)
    .in('id', APPOINTMENT_IDS)
  assertNoError(existingAppointmentsError, 'Reading existing demo appointments')
  const existingAppointmentById = new Map(
    (existingAppointments ?? []).map(appointment => [appointment.id, appointment]),
  )

  const slotArguments = {
    p_organization_id: organizationId,
    p_facility_id: facilityId,
    p_service_id: meetingServiceId,
    p_expert_user_id: expertUserId,
  }
  const { data: initialSlots, error: initialSlotsError } = await adminClient.rpc(
    'get_staff_booking_slots',
    { ...slotArguments, p_local_date: demoDate },
  )
  assertNoError(initialSlotsError, 'Reading the seeded availability for tomorrow')
  const tenOClockSlot = (initialSlots ?? []).find(
    slot => localTimeString(slot.starts_at) === '10:00',
  )
  const nineOClockStartsAt = zonedDateTimeIso(demoDate, '09:00')
  const nineOClockEndsAt = new Date(
    new Date(nineOClockStartsAt).valueOf() + 60 * 60 * 1_000,
  ).toISOString()
  const nineOClockIsAvailable = (initialSlots ?? []).some(
    slot => localTimeString(slot.starts_at) === '09:00',
  )
  const existingNineOClock = existingAppointmentById.get(DEMO_IDS.appointments[4])
  if (
    !tenOClockSlot
    || (
      !nineOClockIsAvailable
      && appointmentValue('starts_at', existingNineOClock?.starts_at)
        !== appointmentValue('starts_at', nineOClockStartsAt)
    )
  ) {
    throw new Error(
      `Demo availability must allow the seeded 09:00 booking and a free 10:00 slot on ${demoDate}.`,
    )
  }

  const { data: customSlots, error: customSlotsError } = await adminClient.rpc(
    'get_staff_booking_slots',
    { ...slotArguments, p_local_date: customDate },
  )
  assertNoError(customSlotsError, 'Reading the custom demo availability')
  const customSlotIsAvailable = (customSlots ?? []).some(
    slot => localTimeString(slot.starts_at) === '11:00',
  )
  const customStartsAt = zonedDateTimeIso(customDate, '11:00')
  const customEndsAt = new Date(
    new Date(customStartsAt).valueOf() + 60 * 60 * 1_000,
  ).toISOString()
  const existingCustom = existingAppointmentById.get(DEMO_IDS.appointments[5])
  if (
    !customSlotIsAvailable
    && appointmentValue('starts_at', existingCustom?.starts_at)
      !== appointmentValue('starts_at', customStartsAt)
  ) {
    throw new Error(`Demo custom availability must contain an 11:00 slot on ${customDate}.`)
  }

  const historicDates = previousWeekdays(warsawToday, 4)
  const historicSpecs = [
    {
      localDate: historicDates[3],
      localTime: '10:00',
      duration: 60,
      status: 'confirmed',
      service: services.find(service => service.id === meetingServiceId),
      widget: calendarWidget,
      context: { widgetType: 'calendar', version: 1 },
      notes: 'Pierwsza konsultacja i zebranie potrzeb klienta.',
    },
    {
      localDate: historicDates[2],
      localTime: '11:00',
      duration: 45,
      status: 'confirmed',
      service: services.find(service => service.id === DEMO_IDS.services.capacityAnalysis),
      widget: capacityWidget,
      context: {
        widgetType: 'mortgage_capacity',
        version: 1,
        estimatedCapacity: 648000,
      },
      notes: 'Analiza zdolności i omówienie bezpiecznego budżetu.',
    },
    {
      localDate: historicDates[1],
      localTime: '14:00',
      duration: 30,
      status: 'cancelled',
      service: services.find(service => service.id === DEMO_IDS.services.documentSigning),
      widget: calendarWidget,
      context: { widgetType: 'calendar', version: 1 },
      notes: 'Termin odwołany po zmianie dostępności klienta.',
    },
    {
      localDate: historicDates[0],
      localTime: '15:00',
      duration: 60,
      status: 'confirmed',
      service: services.find(service => service.id === DEMO_IDS.services.creditConsultation),
      widget: paymentWidget,
      context: {
        widgetType: 'mortgage_payment',
        version: 1,
        estimatedPayment: 4275,
      },
      notes: 'Porównanie raty i parametrów przykładowego kredytu.',
    },
  ]
  const appointmentsSeed = historicSpecs.map((spec, index) => {
    if (!spec.service) throw new Error('A historic demo service was not found.')
    const startsAt = zonedDateTimeIso(spec.localDate, spec.localTime)
    const endsAt = new Date(
      new Date(startsAt).valueOf() + spec.duration * 60 * 1_000,
    ).toISOString()
    const createdAt = new Date(
      new Date(startsAt).valueOf() - 2 * DAY_MS,
    ).toISOString()
    return appointmentRow({
      id: DEMO_IDS.appointments[index],
      manageToken: DEMO_IDS.appointmentManageTokens[index],
      organizationId,
      facilityId,
      service: spec.service,
      expertUserId,
      client: normalizedClients[index % normalizedClients.length],
      widget: spec.widget,
      startsAt,
      endsAt,
      status: spec.status,
      createdAt,
      seedNow: now,
      notes: spec.notes,
      bookingContext: spec.context,
    })
  })
  appointmentsSeed.push(
    appointmentRow({
      id: DEMO_IDS.appointments[4],
      manageToken: DEMO_IDS.appointmentManageTokens[4],
      organizationId,
      facilityId,
      service: services.find(service => service.id === meetingServiceId),
      expertUserId,
      client: normalizedClients[4 % normalizedClients.length],
      widget: calendarWidget,
      startsAt: nineOClockStartsAt,
      endsAt: nineOClockEndsAt,
      status: 'confirmed',
      createdAt: new Date(
        new Date(nineOClockStartsAt).valueOf() - DAY_MS,
      ).toISOString(),
      seedNow: now,
      notes: 'Potwierdzona konsultacja demonstracyjna.',
      bookingContext: { widgetType: 'calendar', version: 1 },
    }),
    appointmentRow({
      id: DEMO_IDS.appointments[5],
      manageToken: DEMO_IDS.appointmentManageTokens[5],
      organizationId,
      facilityId,
      service: services.find(service => service.id === meetingServiceId),
      expertUserId,
      client: normalizedClients[5 % normalizedClients.length],
      widget: capacityWidget,
      startsAt: customStartsAt,
      endsAt: customEndsAt,
      status: 'confirmed',
      createdAt: new Date(
        new Date(customStartsAt).valueOf() - DAY_MS,
      ).toISOString(),
      seedNow: now,
      notes: 'Konsultacja po wstępnym wyliczeniu zdolności.',
      bookingContext: {
        widgetType: 'mortgage_capacity',
        version: 1,
        estimatedCapacity: 712000,
      },
    }),
  )
  const reconciledAppointments = []
  for (const [index, desired] of appointmentsSeed.entries()) {
    const existing = existingAppointmentById.get(desired.id)
    if (!existing) {
      const { data, error } = await adminClient
        .from('appointments')
        .insert(desired)
        .select('*')
        .single()
      assertNoError(error, `Creating demo appointment ${desired.id}`)
      reconciledAppointments.push(data)
      continue
    }

    // Historical rows remain a stable history after the first seed. The two
    // future examples move forward only when the civil demo dates change.
    if (index < 4) {
      reconciledAppointments.push(existing)
      continue
    }

    const changed = changedAppointmentValues(existing, desired)
    if (Object.keys(changed).length === 0) {
      reconciledAppointments.push(existing)
      continue
    }
    const { data, error } = await adminClient
      .from('appointments')
      .update({ ...changed, updated_at: nowIso })
      .eq('organization_id', organizationId)
      .eq('id', desired.id)
      .select('*')
      .single()
    assertNoError(error, `Updating demo appointment ${desired.id}`)
    reconciledAppointments.push(data)
  }
  const appointments = reconciledAppointments

  const { data: availableSlots, error: availableSlotsError } = await adminClient.rpc(
    'get_staff_booking_slots',
    { ...slotArguments, p_local_date: demoDate },
  )
  assertNoError(availableSlotsError, 'Verifying demo availability')
  const bookedNineOClockIsReturned = (availableSlots ?? []).some(
    slot => localTimeString(slot.starts_at) === '09:00',
  )
  const tenOClockIsAvailable = (availableSlots ?? []).some(
    slot => localTimeString(slot.starts_at) === '10:00',
  )
  if (bookedNineOClockIsReturned || !tenOClockIsAvailable) {
    throw new Error(
      `Demo availability invariant failed for ${demoDate}: 09:00 must be occupied and 10:00 available.`,
    )
  }

  const counts = {
    openingHours: await tableCount(adminClient, 'facility_opening_hours', [
      ['organization_id', 'eq', organizationId],
      ['id', 'in', DEMO_IDS.openingHours],
    ]),
    facilityOverrides: await tableCount(adminClient, 'facility_opening_overrides', [
      ['organization_id', 'eq', organizationId],
      ['id', 'in', Object.values(DEMO_IDS.facilityOverrides)],
    ]),
    expertRules: await tableCount(adminClient, 'expert_availability_rules', [
      ['organization_id', 'eq', organizationId],
      ['id', 'in', DEMO_IDS.expertRules],
    ]),
    expertOverrides: await tableCount(adminClient, 'expert_availability_overrides', [
      ['organization_id', 'eq', organizationId],
      ['id', 'in', Object.values(DEMO_IDS.expertOverrides)],
    ]),
    services: services.length,
    widgets: (widgets ?? widgetsSeed).length,
    widgetServices: widgetServiceLinks.length,
    widgetEvents: events.length,
    appointments: appointments.length,
    reservations: await tableCount(adminClient, 'appointment_resource_reservations', [
      ['organization_id', 'eq', organizationId],
      ['appointment_id', 'in', APPOINTMENT_IDS],
    ]),
  }

  return {
    services,
    widgets: widgets ?? widgetsSeed,
    appointments,
    demoDate,
    availableSlotCount: (availableSlots ?? []).length,
    counts,
  }
}
