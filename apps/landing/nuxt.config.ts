// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

const isProduction = process.env.NODE_ENV === 'production'
const isPreviewDeployment = process.env.VERCEL_ENV === 'preview'
  || process.env.VERCEL_ENV === 'development'
const supabaseUrl = process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:55321'
const supabaseKey = process.env.NUXT_PUBLIC_SUPABASE_KEY || 'local-development-placeholder'
const hasSupabaseConfig = Boolean(
  process.env.NUXT_PUBLIC_SUPABASE_URL && process.env.NUXT_PUBLIC_SUPABASE_KEY,
)
const supabaseCookiePrefix = isProduction
  ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  : 'openexpert-local-auth'

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
        'lucide:bot',
        'lucide:briefcase-business',
        'lucide:building-2',
        'lucide:calendar-days',
        'lucide:check',
        'lucide:circle-check',
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
    supabase: {
      secretKey: process.env.NUXT_SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || '',
    },
    resend: {
      apiKey: '',
      from: '',
      replyTo: '',
    },
    public: {
      openexpert: {
        hasSupabaseConfig,
        crmBaseUrl: process.env.NUXT_PUBLIC_CRM_BASE_URL
          || (isProduction ? 'https://crm.openexpert.app' : 'http://127.0.0.1:3004'),
        siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://www.openexpert.app',
        mapboxAccessToken: process.env.NUXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '',
      },
      supabase: {
        url: supabaseUrl,
        key: supabaseKey,
        cookiePrefix: supabaseCookiePrefix,
        cookieOptions: {
          sameSite: 'lax',
          secure: isProduction,
        },
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
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400',
      },
    },
    '/placowki': {
      headers: {
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400',
      },
    },
    '/placowki/**': {
      headers: {
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400',
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
      title: 'OpenExpert — system pracy i rezerwacji dla ekspertów',
      meta: [
        {
          name: 'description',
          content: 'Znajdź eksperta, umów konsultację lub prowadź klientów w jednym systemie wspieranym przez agentów AI.',
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
