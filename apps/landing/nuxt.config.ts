// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

const isProduction = process.env.NODE_ENV === 'production'
const isPreviewDeployment = process.env.VERCEL_ENV === 'preview'
  || process.env.VERCEL_ENV === 'development'
const storageProvider = process.env.NUXT_STORAGE_PROVIDER
  || (process.env.VERCEL ? 'vercel-blob' : 'minio')
const dataApiUrl = process.env.NUXT_DATA_API_URL
  || process.env.NUXT_PUBLIC_DATA_API_URL
  || 'http://127.0.0.1:55321'
const authBaseUrl = process.env.BETTER_AUTH_URL
  || process.env.NUXT_AUTH_BASE_URL
  || (isProduction ? 'https://crm.openexpert.app' : 'http://127.0.0.1:3004')
const clientPortalBaseUrl = process.env.NUXT_PUBLIC_CLIENT_BASE_URL
  || process.env.NUXT_PUBLIC_CLIENT_PORTAL_BASE_URL
  || (isProduction ? 'https://client.openexpert.app' : 'http://127.0.0.1:3006')
const authDatabaseUrl = process.env.NUXT_AUTH_DATABASE_URL
  || (isProduction
    ? ''
    : process.env.DATABASE_URL
      || 'postgresql://openexpert_auth:openexpert-auth-local@127.0.0.1:55322/openexpert')
const authIpAddressHeaders = process.env.BETTER_AUTH_IP_ADDRESS_HEADERS
  || (process.env.VERCEL ? 'x-vercel-forwarded-for' : '')

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  typescript: {
    tsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true,
      },
    },
  },
  vite: {
    server: {
      hmr: false,
    },
  },
  hooks: {
    'vite:extendConfig'(config) {
      const mutableConfig = config as typeof config & { server?: { hmr?: boolean } }
      mutableConfig.server ||= {}
      mutableConfig.server.hmr = false
    },
  },
  modules: ['eve/nuxt', '@nuxt/icon'],
  eve: {
    eveRoot: '../../multiform-agent',
  },
  icon: {
    provider: 'none',
    clientBundle: {
      scan: true,
      icons: [
        'lucide:arrow-left',
        'lucide:arrow-right',
        'lucide:badge-check',
        'lucide:bot',
        'lucide:briefcase-business',
        'lucide:building-2',
        'lucide:calendar-days',
        'lucide:check',
        'lucide:circle-check',
        'lucide:clipboard-check',
        'lucide:clock-3',
        'lucide:eye',
        'lucide:file-check-2',
        'lucide:file-text',
        'lucide:folder',
        'lucide:github',
        'lucide:house',
        'lucide:landmark',
        'lucide:mail',
        'lucide:map-pin',
        'lucide:menu',
        'lucide:message-square',
        'lucide:palette',
        'lucide:phone',
        'lucide:rotate-ccw',
        'lucide:route',
        'lucide:save',
        'lucide:scan-line',
        'lucide:search',
        'lucide:settings',
        'lucide:shield-check',
        'lucide:sliders-horizontal',
        'lucide:triangle-alert',
        'lucide:type',
        'lucide:user-round',
        'lucide:user-round-check',
        'lucide:user-round-plus',
        'lucide:users-round',
        'lucide:workflow',
        'lucide:x',
      ],
    },
  },
  nitro: {
    prerender: {
      autoSubfolderIndex: false,
    },
    externals: {
      traceInclude: [
        fileURLToPath(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)),
      ],
    },
    typescript: {
      tsConfig: {
        compilerOptions: {
          allowImportingTsExtensions: true,
        },
      },
    },
    serverAssets: [
      {
        baseName: 'multiform-mocks',
        dir: fileURLToPath(new URL('../../mock-files', import.meta.url)),
      },
      {
        baseName: 'multiform-fonts',
        dir: fileURLToPath(new URL('./public/fonts', import.meta.url)),
      },
    ],
  },
  runtimeConfig: {
    dataApi: {
      url: dataApiUrl,
      jwt: {
        audience: process.env.NUXT_DATA_API_JWT_AUDIENCE || 'openexpert-data',
        issuer: process.env.NUXT_DATA_API_JWT_ISSUER || 'openexpert-local',
        keyId: process.env.NUXT_DATA_API_JWT_KEY_ID || 'openexpert-local',
        privateKey: process.env.NUXT_DATA_API_JWT_PRIVATE_KEY || '',
      },
    },
    auth: {
      baseUrl: authBaseUrl,
      basePath: process.env.BETTER_AUTH_BASE_PATH || '/api/auth',
      databaseUrl: authDatabaseUrl,
      databaseSchema: process.env.BETTER_AUTH_DATABASE_SCHEMA || 'identity',
      ipAddressHeaders: authIpAddressHeaders,
      secret: process.env.BETTER_AUTH_SECRET
        || process.env.NUXT_AUTH_SECRET
        || (isProduction ? '' : 'openexpert-local-auth-secret-change-me-000000000000'),
      cookiePrefix: process.env.BETTER_AUTH_COOKIE_PREFIX
        || (isProduction ? 'openexpert' : 'openexpert-local'),
      cookieDomain: process.env.NUXT_AUTH_COOKIE_DOMAIN || '',
      sessionFreshAge: Number(process.env.BETTER_AUTH_SESSION_FRESH_AGE || 600),
      trustedOrigins: process.env.NUXT_AUTH_TRUSTED_ORIGINS
        || 'http://127.0.0.1:3003,http://127.0.0.1:3004',
    },
    authEmail: {
      apiKey: process.env.NUXT_RESEND_API_KEY || '',
      from: process.env.NUXT_AUTH_EMAIL_FROM
        || (isProduction ? '' : process.env.NUXT_RESEND_FROM)
        || (isProduction ? '' : 'OpenExpert <security@auth.openexpert.local>'),
      replyTo: process.env.NUXT_AUTH_EMAIL_REPLY_TO
        || (isProduction ? '' : process.env.NUXT_RESEND_REPLY_TO)
        || '',
      smtp: {
        host: process.env.NUXT_SMTP_HOST || (isProduction ? '' : '127.0.0.1'),
        port: Number(process.env.NUXT_SMTP_PORT || 55325),
        secure: process.env.NUXT_SMTP_SECURE === 'true',
        user: process.env.NUXT_SMTP_USER || '',
        password: process.env.NUXT_SMTP_PASSWORD || '',
      },
    },
    storage: {
      provider: storageProvider,
      minio: {
        endpoint: process.env.NUXT_MINIO_ENDPOINT || 'http://127.0.0.1:55326',
        region: process.env.NUXT_MINIO_REGION || 'us-east-1',
        accessKeyId: process.env.NUXT_MINIO_ACCESS_KEY_ID || 'openexpert',
        secretAccessKey: process.env.NUXT_MINIO_SECRET_ACCESS_KEY || 'openexpert-minio-local-secret',
        publicBucket: process.env.NUXT_MINIO_PUBLIC_BUCKET || 'openexpert-public',
        privateBucket: process.env.NUXT_MINIO_PRIVATE_BUCKET || 'openexpert-private',
        publicBaseUrl: process.env.NUXT_MINIO_PUBLIC_BASE_URL
          || 'http://127.0.0.1:55326/openexpert-public',
      },
      vercelBlob: {
        publicToken: process.env.NUXT_VERCEL_BLOB_PUBLIC_TOKEN || '',
        publicStoreId: process.env.NUXT_VERCEL_BLOB_PUBLIC_STORE_ID || '',
        publicBaseUrl: process.env.NUXT_VERCEL_BLOB_PUBLIC_BASE_URL || '',
        privateToken: process.env.NUXT_VERCEL_BLOB_PRIVATE_TOKEN || '',
        privateStoreId: process.env.NUXT_VERCEL_BLOB_PRIVATE_STORE_ID || '',
        oidcToken: process.env.VERCEL_OIDC_TOKEN || '',
      },
    },
    resend: {
      apiKey: process.env.NUXT_RESEND_API_KEY || '',
      from: process.env.NUXT_RESEND_FROM
        || (isProduction ? '' : 'OpenExpert <hello@updates.openexpert.local>'),
      replyTo: process.env.NUXT_RESEND_REPLY_TO || '',
      smtp: {
        host: process.env.NUXT_SMTP_HOST || (isProduction ? '' : '127.0.0.1'),
        port: Number(process.env.NUXT_SMTP_PORT || 55325),
        secure: process.env.NUXT_SMTP_SECURE === 'true',
        user: process.env.NUXT_SMTP_USER || '',
        password: process.env.NUXT_SMTP_PASSWORD || '',
      },
    },
    public: {
      openexpert: {
        hasAuthConfig: !isProduction
          || Boolean(process.env.BETTER_AUTH_SECRET || process.env.NUXT_AUTH_SECRET),
        crmBaseUrl: process.env.NUXT_PUBLIC_CRM_BASE_URL
          || (isProduction ? 'https://crm.openexpert.app' : 'http://127.0.0.1:3004'),
        clientPortalBaseUrl,
        siteUrl: process.env.NUXT_PUBLIC_SITE_URL
          || (isProduction ? 'https://www.openexpert.app' : 'http://127.0.0.1:3003'),
        mapboxAccessToken: process.env.NUXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '',
      },
    },
  },
  routeRules: {
    ...(isPreviewDeployment
      ? {
          '/**': {
            headers: { 'x-robots-tag': 'noindex, nofollow' },
          },
        }
      : {}),
    '/': {
      prerender: true,
    },
    '/eksperci': {
      headers: {
        'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120, stale-if-error=300',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
    '/eksperci/**': {
      headers: {
        'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120, stale-if-error=300',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
    '/placowki': {
      headers: {
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
    '/placowki/**': {
      headers: {
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
    '/placówki': {
      redirect: {
        to: '/placowki',
        statusCode: 301,
      },
    },
    '/personalizacja': {
      prerender: true,
    },
    '/poczta-dla-ekseprta': {
      prerender: true,
    },
    '/o-nas': {
      prerender: true,
    },
    '/waitlist': {
      headers: { 'x-robots-tag': 'noindex, follow' },
    },
    '/multiform-eve': {
      headers: { 'x-robots-tag': 'noindex, nofollow' },
    },
    '/multiform-eve/admin': {
      headers: { 'x-robots-tag': 'noindex, nofollow' },
    },
    '/api/**': {
      headers: { 'x-robots-tag': 'noindex, nofollow' },
    },
    '/eve/**': {
      headers: { 'x-robots-tag': 'noindex, nofollow' },
    },
    '/_eve_internal/**': {
      headers: { 'x-robots-tag': 'noindex, nofollow' },
    },
    '/fonts/**': {
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    },
    '/assets/**': {
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    },
    '/rive/**': {
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    },
    '/openexpert-og.png': {
      headers: { 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400' },
    },
    '/eksperci-og.png': {
      headers: { 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400' },
    },
    '/placowki-og.png': {
      headers: { 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400' },
    },
    '/o-nas-og.png': {
      headers: { 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400' },
    },
  },
  css: ['~/assets/css/design.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert — platforma pośrednictwa kredytowego',
      meta: [
        {
          name: 'description',
          content: 'Uruchom lub rozwijaj pośrednictwo kredytowe pod własną marką, korzystając z jednego systemu i agentów AI.',
        },
        { name: 'apple-mobile-web-app-title', content: 'OpenExpert' },
        { name: 'theme-color', content: '#030303' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },
})
