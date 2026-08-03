import { createHash } from 'node:crypto'
import { Client } from 'pg'

const CONFIRMATION = 'SEED_OPENEXPERT_PRODUCTION_SHOWCASE'
const ORGANIZATION_SLUG = 'openexpert-local'
const VERCEL_PROJECT = 'openexpert-crm'
const SEED_LOCK = 'openexpert.seed.production-showcase.v1'

const expertProfiles = new Map([
  ['local-administrator', {
    professionalTitle: 'Ekspert kredytowy i administrator',
    tagline: 'Łączę doświadczenie kredytowe z dobrze poukładanym procesem.',
    phone: '+48 91 444 20 10',
    location: 'Szczecin i online',
    bio: 'Koordynuję pracę zespołu OpenExpert i pomagam klientom bezpiecznie przejść od pierwszej analizy do uruchomienia finansowania.',
    specializations: ['Kredyty hipoteczne', 'Proces kredytowy', 'Finansowanie firm'],
    visualStyle: 'editorial',
  }],
  ['anna-nowak', {
    professionalTitle: 'Ekspertka kredytowa',
    tagline: 'Spokojnie przeprowadzę Cię przez finansowanie domu.',
    phone: '+48 22 444 20 11',
    location: 'Warszawa, Gdańsk i online',
    bio: 'Specjalizuję się w kredytach mieszkaniowych, zakupie pierwszego lokum i porównywaniu scenariuszy finansowania.',
    specializations: ['Kredyty hipoteczne', 'Pierwsze mieszkanie', 'Refinansowanie'],
    visualStyle: 'warm',
  }],
  ['marta-wojcik', {
    professionalTitle: 'Ekspertka ds. finansowania nieruchomości',
    tagline: 'Zamieniam skomplikowane wymagania banków w czytelny plan.',
    phone: '+48 61 444 20 12',
    location: 'Poznań, Gdańsk i online',
    bio: 'Pomagam uporządkować dokumenty, policzyć bezpieczny budżet i sprawnie przejść przez analizę bankową.',
    specializations: ['Zdolność kredytowa', 'Dokumentacja', 'Nieruchomości'],
    visualStyle: 'minimal',
  }],
  ['piotr-zielinski', {
    professionalTitle: 'Ekspert kredytowy',
    tagline: 'Porównuję oferty i negocjuję rozwiązania dopasowane do planu klienta.',
    phone: '+48 71 444 20 13',
    location: 'Wrocław, Poznań i online',
    bio: 'Prowadzę sprawy hipoteczne i refinansowania, dbając o przejrzyste porównanie kosztów oraz terminów.',
    specializations: ['Porównanie ofert', 'Refinansowanie', 'Kredyty hipoteczne'],
    visualStyle: 'editorial',
  }],
])

const facilities = [
  {
    slug: 'openexpert-szczecin',
    name: 'OpenExpert Szczecin Centrum',
    description: 'Główna placówka OpenExpert. Konsultacje kredytowe, analiza zdolności i obsługa dokumentów w jednym miejscu.',
    addressLine1: 'al. Piastów 30',
    postalCode: '70-064',
    city: 'Szczecin',
    phone: '+48 91 444 20 10',
    email: 'szczecin@openexpert.app',
    latitude: 53.42154,
    longitude: 14.53175,
    experts: ['local-administrator', 'anna-nowak', 'marta-wojcik'],
  },
  {
    slug: 'openexpert-warszawa-srodmiescie',
    name: 'OpenExpert Warszawa Śródmieście',
    description: 'Konsultacje hipoteczne i spotkania dotyczące finansowania nieruchomości w centrum Warszawy.',
    addressLine1: 'ul. Marszałkowska 58',
    postalCode: '00-545',
    city: 'Warszawa',
    phone: '+48 22 444 20 11',
    email: 'warszawa@openexpert.app',
    latitude: 52.22446,
    longitude: 21.01621,
    experts: ['anna-nowak', 'local-administrator'],
  },
  {
    slug: 'openexpert-poznan-jezyce',
    name: 'OpenExpert Poznań Jeżyce',
    description: 'Placówka specjalizująca się w zdolności kredytowej, zakupie pierwszego mieszkania i refinansowaniu.',
    addressLine1: 'ul. Dąbrowskiego 77A',
    postalCode: '60-529',
    city: 'Poznań',
    phone: '+48 61 444 20 12',
    email: 'poznan@openexpert.app',
    latitude: 52.41316,
    longitude: 16.90131,
    experts: ['marta-wojcik', 'piotr-zielinski'],
  },
  {
    slug: 'openexpert-wroclaw-centrum',
    name: 'OpenExpert Wrocław Centrum',
    description: 'Kompleksowe wsparcie przy kredytach hipotecznych, refinansowaniu i porównaniu ofert bankowych.',
    addressLine1: 'ul. Świdnicka 39',
    postalCode: '50-029',
    city: 'Wrocław',
    phone: '+48 71 444 20 13',
    email: 'wroclaw@openexpert.app',
    latitude: 51.10314,
    longitude: 17.03025,
    experts: ['piotr-zielinski', 'local-administrator'],
  },
  {
    slug: 'openexpert-gdansk-wrzeszcz',
    name: 'OpenExpert Gdańsk Wrzeszcz',
    description: 'Spotkania stacjonarne i online dla klientów z Trójmiasta, od wstępnej analizy po podpisanie dokumentów.',
    addressLine1: 'al. Grunwaldzka 82',
    postalCode: '80-244',
    city: 'Gdańsk',
    phone: '+48 58 444 20 14',
    email: 'gdansk@openexpert.app',
    latitude: 54.37847,
    longitude: 18.60637,
    experts: ['anna-nowak', 'marta-wojcik'],
  },
]

const services = [
  {
    slug: 'analiza-zdolnosci-kredytowej',
    name: 'Analiza zdolności kredytowej',
    description: 'Analiza dochodów, zobowiązań i bezpiecznego poziomu finansowania.',
    durationMinutes: 45,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    minNoticeMinutes: 60,
    maxAdvanceDays: 90,
  },
  {
    slug: 'konsultacja-kredytowa',
    name: 'Konsultacja kredytowa',
    description: 'Omówienie celu, wkładu własnego i dostępnych ścieżek kredytowych.',
    durationMinutes: 60,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 10,
    minNoticeMinutes: 120,
    maxAdvanceDays: 120,
  },
  {
    slug: 'porownanie-ofert-bankowych',
    name: 'Porównanie ofert bankowych',
    description: 'Porównanie kosztów, warunków i ryzyk aktualnych ofert finansowania.',
    durationMinutes: 60,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 10,
    minNoticeMinutes: 120,
    maxAdvanceDays: 90,
  },
  {
    slug: 'podpisanie-dokumentow',
    name: 'Podpisanie dokumentów',
    description: 'Przegląd i podpisanie przygotowanych dokumentów kredytowych.',
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    minNoticeMinutes: 180,
    maxAdvanceDays: 60,
  },
]

function usage() {
  return `Usage:
  node packages/database/scripts/seed-production-showcase.mjs
  node packages/database/scripts/seed-production-showcase.mjs --apply --confirm ${CONFIRMATION}

Without --apply the command validates and summarizes the production showcase fixture.
Apply mode only works with a production-scoped Vercel OIDC token for ${VERCEL_PROJECT}.
The seed updates only the ${ORGANIZATION_SLUG} organization and never creates users or roles.`
}

function parseArguments(argv) {
  const parsed = { apply: false, confirm: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--apply') parsed.apply = true
    else if (argument === '--help' || argument === '-h') parsed.help = true
    else if (argument === '--confirm') {
      parsed.confirm = argv[index + 1]
      index += 1
    }
    else if (argument.startsWith('--confirm=')) parsed.confirm = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!parsed.apply && parsed.confirm) throw new Error('--confirm requires --apply')
  if (parsed.apply && parsed.confirm !== CONFIRMATION) {
    throw new Error(`Applying requires --confirm ${CONFIRMATION}`)
  }
  return parsed
}

function stableUuid(value) {
  const bytes = createHash('sha256')
    .update(`openexpert:production-showcase:v1:${value}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function decodeJwtPayload(value) {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('VERCEL_OIDC_TOKEN is not a JWT')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

function productionConfiguration() {
  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
    throw new Error('Apply mode requires VERCEL=1 and VERCEL_ENV=production')
  }
  const databaseUrl = String(process.env.DATABASE_URL_UNPOOLED ?? '').trim()
    || requiredEnvironment('DATABASE_URL')
  const host = new URL(databaseUrl).hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Apply mode refuses a local DATABASE_URL')
  }

  const oidc = decodeJwtPayload(requiredEnvironment('VERCEL_OIDC_TOKEN'))
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (oidc.environment !== 'production' || oidc.project !== VERCEL_PROJECT) {
    throw new Error(`VERCEL_OIDC_TOKEN must target ${VERCEL_PROJECT} production`)
  }
  if (typeof oidc.sub !== 'string' || !oidc.sub.endsWith(':environment:production')) {
    throw new Error('VERCEL_OIDC_TOKEN subject is not production-scoped')
  }
  if (typeof oidc.iss !== 'string' || !oidc.iss.startsWith('https://oidc.vercel.com')) {
    throw new Error('VERCEL_OIDC_TOKEN has an unexpected issuer')
  }
  if (typeof oidc.exp !== 'number' || oidc.exp <= nowSeconds + 300) {
    throw new Error('VERCEL_OIDC_TOKEN expires too soon')
  }
  return { databaseUrl }
}

function validateFixture() {
  const facilitySlugs = new Set()
  for (const facility of facilities) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(facility.slug)) {
      throw new Error(`Invalid facility slug: ${facility.slug}`)
    }
    if (facilitySlugs.has(facility.slug)) throw new Error(`Duplicate facility: ${facility.slug}`)
    facilitySlugs.add(facility.slug)
    for (const expert of facility.experts) {
      if (!expertProfiles.has(expert)) throw new Error(`Unknown expert fixture: ${expert}`)
    }
  }
  if (new Set(services.map(service => service.slug)).size !== services.length) {
    throw new Error('Service slugs must be unique')
  }
}

async function upsertFacility(client, organizationId, facility) {
  const result = await client.query(`
    INSERT INTO public.facilities (
      id, organization_id, name, slug, description, timezone,
      address_line1, postal_code, city, country_code, phone, email,
      latitude, longitude, is_active
    ) VALUES ($1, $2, $3, $4, $5, 'Europe/Warsaw', $6, $7, $8, 'PL', $9, $10, $11, $12, true)
    ON CONFLICT (organization_id, slug) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      timezone = EXCLUDED.timezone,
      address_line1 = EXCLUDED.address_line1,
      postal_code = EXCLUDED.postal_code,
      city = EXCLUDED.city,
      country_code = EXCLUDED.country_code,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      is_active = true,
      updated_at = now()
    RETURNING id
  `, [
    stableUuid(`facility:${facility.slug}`),
    organizationId,
    facility.name,
    facility.slug,
    facility.description,
    facility.addressLine1,
    facility.postalCode,
    facility.city,
    facility.phone,
    facility.email,
    facility.latitude,
    facility.longitude,
  ])
  return String(result.rows[0].id)
}

async function applySeed(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '15s'")
    await client.query("SET LOCAL statement_timeout = '120s'")
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SEED_LOCK])

    const organizationResult = await client.query(
      'SELECT id, name FROM public.organizations WHERE slug = $1',
      [ORGANIZATION_SLUG],
    )
    if (organizationResult.rowCount !== 1) {
      throw new Error(`Expected exactly one ${ORGANIZATION_SLUG} organization`)
    }
    const organizationId = String(organizationResult.rows[0].id)

    const expertResult = await client.query(`
      SELECT u.id, u.full_name, u.avatar_url, om.role
      FROM public.organization_memberships om
      JOIN public.users u ON u.id = om.user_id
      WHERE om.organization_id = $1
        AND u.avatar_url LIKE '/avatars/experts/%.webp'
      ORDER BY u.full_name
    `, [organizationId])
    const experts = new Map()
    for (const row of expertResult.rows) {
      const key = String(row.avatar_url).match(/\/([^/]+)\.webp$/u)?.[1]
      if (key && expertProfiles.has(key)) experts.set(key, row)
    }
    const missingExperts = [...expertProfiles.keys()].filter(key => !experts.has(key))
    if (missingExperts.length) {
      throw new Error(`Missing existing demo expert accounts: ${missingExperts.join(', ')}`)
    }
    const owner = experts.get('local-administrator')

    for (const [key, profile] of expertProfiles) {
      const expert = experts.get(key)
      await client.query(`
        INSERT INTO public.expert_brand_profiles (
          organization_id, user_id, expert_name, professional_title, tagline,
          contact_email, contact_phone, website_url, location, bio,
          specializations, visual_style
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'https://www.openexpert.app', $8, $9, $10, $11)
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          expert_name = EXCLUDED.expert_name,
          professional_title = EXCLUDED.professional_title,
          tagline = EXCLUDED.tagline,
          contact_email = EXCLUDED.contact_email,
          contact_phone = EXCLUDED.contact_phone,
          website_url = EXCLUDED.website_url,
          location = EXCLUDED.location,
          bio = EXCLUDED.bio,
          specializations = EXCLUDED.specializations,
          visual_style = EXCLUDED.visual_style,
          updated_at = now()
      `, [
        organizationId,
        expert.id,
        expert.full_name,
        profile.professionalTitle,
        profile.tagline,
        `${key}@openexpert.app`,
        profile.phone,
        profile.location,
        profile.bio,
        profile.specializations,
        profile.visualStyle,
      ])
    }

    const serviceIds = []
    for (const service of services) {
      const result = await client.query(`
        INSERT INTO public.booking_services (
          id, organization_id, name, slug, description, duration_minutes,
          buffer_before_minutes, buffer_after_minutes, slot_interval_minutes,
          min_notice_minutes, max_advance_days, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 15, $9, $10, true)
        ON CONFLICT (organization_id, slug) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          duration_minutes = EXCLUDED.duration_minutes,
          buffer_before_minutes = EXCLUDED.buffer_before_minutes,
          buffer_after_minutes = EXCLUDED.buffer_after_minutes,
          slot_interval_minutes = EXCLUDED.slot_interval_minutes,
          min_notice_minutes = EXCLUDED.min_notice_minutes,
          max_advance_days = EXCLUDED.max_advance_days,
          is_active = true,
          updated_at = now()
        RETURNING id
      `, [
        stableUuid(`service:${service.slug}`),
        organizationId,
        service.name,
        service.slug,
        service.description,
        service.durationMinutes,
        service.bufferBeforeMinutes,
        service.bufferAfterMinutes,
        service.minNoticeMinutes,
        service.maxAdvanceDays,
      ])
      serviceIds.push(String(result.rows[0].id))
    }

    const facilityIds = []
    for (const facility of facilities) {
      const facilityId = await upsertFacility(client, organizationId, facility)
      facilityIds.push(facilityId)

      for (let weekday = 0; weekday < 5; weekday += 1) {
        await client.query(`
          INSERT INTO public.facility_opening_hours (
            id, organization_id, facility_id, weekday, opens_at, closes_at, is_active
          ) VALUES ($1, $2, $3, $4, '08:00', '18:00', true)
          ON CONFLICT (id) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            facility_id = EXCLUDED.facility_id,
            weekday = EXCLUDED.weekday,
            opens_at = EXCLUDED.opens_at,
            closes_at = EXCLUDED.closes_at,
            is_active = true,
            updated_at = now()
        `, [stableUuid(`facility-hours:${facility.slug}:${weekday}`), organizationId, facilityId, weekday])
      }

      for (const expertKey of facility.experts) {
        const expert = experts.get(expertKey)
        await client.query(`
          INSERT INTO public.facility_memberships (
            organization_id, facility_id, user_id, role, is_bookable, booking_priority
          ) VALUES ($1, $2, $3, $4, true, $5)
          ON CONFLICT (organization_id, facility_id, user_id) DO UPDATE SET
            role = EXCLUDED.role,
            is_bookable = true,
            booking_priority = EXCLUDED.booking_priority,
            updated_at = now()
        `, [organizationId, facilityId, expert.id, expertKey === 'local-administrator' ? 'admin' : 'member', expertKey === 'local-administrator' ? 50 : 100])

        for (let weekday = 0; weekday < 5; weekday += 1) {
          await client.query(`
            INSERT INTO public.expert_availability_rules (
              id, organization_id, facility_id, user_id, weekday,
              starts_at, ends_at, valid_from, valid_until, is_active
            ) VALUES ($1, $2, $3, $4, $5, '09:00', '17:00', NULL, NULL, true)
            ON CONFLICT (id) DO UPDATE SET
              organization_id = EXCLUDED.organization_id,
              facility_id = EXCLUDED.facility_id,
              user_id = EXCLUDED.user_id,
              weekday = EXCLUDED.weekday,
              starts_at = EXCLUDED.starts_at,
              ends_at = EXCLUDED.ends_at,
              valid_from = NULL,
              valid_until = NULL,
              is_active = true,
              updated_at = now()
          `, [stableUuid(`expert-hours:${facility.slug}:${expertKey}:${weekday}`), organizationId, facilityId, expert.id, weekday])
        }
      }

      for (const serviceId of serviceIds) {
        await client.query(`
          INSERT INTO public.facility_services (organization_id, facility_id, service_id, is_active)
          VALUES ($1, $2, $3, true)
          ON CONFLICT (organization_id, facility_id, service_id) DO UPDATE SET
            is_active = true,
            updated_at = now()
        `, [organizationId, facilityId, serviceId])
        for (const expertKey of facility.experts) {
          await client.query(`
            INSERT INTO public.facility_service_experts (
              organization_id, facility_id, service_id, user_id, is_active
            ) VALUES ($1, $2, $3, $4, true)
            ON CONFLICT (organization_id, facility_id, service_id, user_id) DO UPDATE SET
              is_active = true,
              updated_at = now()
          `, [organizationId, facilityId, serviceId, experts.get(expertKey).id])
        }
      }

      const widgetId = stableUuid(`widget:${facility.slug}:calendar`)
      const widgetToken = stableUuid(`widget-token:${facility.slug}:calendar`)
      await client.query(`
        INSERT INTO public.booking_widgets (
          id, organization_id, facility_id, name, slug, public_token, title,
          subtitle, theme, accent_color, allowed_origins, booking_mode, locale,
          is_active, widget_type, fixed_expert_user_id, created_by_user_id,
          analytics_started_at, is_directory_listed
        ) VALUES (
          $1, $2, $3, 'Umów spotkanie', 'umow-spotkanie', $4,
          'Umów spotkanie z ekspertem',
          'Wybierz usługę, eksperta i dogodny termin spotkania.',
          'auto', '#2563EB', '{}', 'both', 'pl-PL', true, 'calendar', NULL,
          $5, now() - interval '30 days', true
        )
        ON CONFLICT (organization_id, facility_id, slug) DO UPDATE SET
          name = EXCLUDED.name,
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          theme = EXCLUDED.theme,
          accent_color = EXCLUDED.accent_color,
          booking_mode = EXCLUDED.booking_mode,
          locale = EXCLUDED.locale,
          is_active = true,
          widget_type = 'calendar',
          fixed_expert_user_id = NULL,
          created_by_user_id = EXCLUDED.created_by_user_id,
          is_directory_listed = true,
          updated_at = now()
        RETURNING id
      `, [widgetId, organizationId, facilityId, widgetToken, owner.id])
      const actualWidget = await client.query(
        'SELECT id FROM public.booking_widgets WHERE organization_id = $1 AND facility_id = $2 AND slug = $3',
        [organizationId, facilityId, 'umow-spotkanie'],
      )
      const actualWidgetId = String(actualWidget.rows[0].id)
      for (const serviceId of serviceIds) {
        await client.query(`
          INSERT INTO public.booking_widget_services (
            organization_id, facility_id, widget_id, service_id
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [organizationId, facilityId, actualWidgetId, serviceId])
      }
    }

    const verification = await client.query(`
      SELECT
        (SELECT count(*) FROM public.facilities WHERE organization_id = $1 AND is_active) AS facilities,
        (SELECT count(*) FROM public.expert_brand_profiles WHERE organization_id = $1) AS expert_profiles,
        (SELECT count(*) FROM public.booking_widgets WHERE organization_id = $1 AND is_active AND is_directory_listed) AS listed_widgets,
        (SELECT count(*) FROM public.facility_service_experts WHERE organization_id = $1 AND is_active) AS expert_service_links,
        (SELECT count(*) FROM public.facility_opening_hours WHERE organization_id = $1 AND is_active) AS opening_hours
    `, [organizationId])
    const counts = verification.rows[0]
    if (Number(counts.facilities) < facilities.length || Number(counts.listed_widgets) < facilities.length) {
      throw new Error(`Showcase verification failed: ${JSON.stringify(counts)}`)
    }

    await client.query('COMMIT')
    return {
      organizationId,
      organizationName: organizationResult.rows[0].name,
      facilities: facilityIds.length,
      experts: experts.size,
      services: serviceIds.length,
      listedWidgets: Number(counts.listed_widgets),
      openingHours: Number(counts.opening_hours),
      expertServiceLinks: Number(counts.expert_service_links),
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

async function main() {
  const argumentsList = parseArguments(process.argv.slice(2))
  if (argumentsList.help) {
    console.log(usage())
    return
  }
  validateFixture()
  if (!argumentsList.apply) {
    console.log(`DRY RUN: validated ${facilities.length} facilities, ${expertProfiles.size} expert profiles and ${services.length} services.`)
    console.log('No database operation was performed.')
    console.log('')
    console.log(usage())
    return
  }

  const { databaseUrl } = productionConfiguration()
  const result = await applySeed(databaseUrl)
  console.log('Production showcase seed completed.')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
