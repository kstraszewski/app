// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

const databaseTypes = fileURLToPath(
  new URL('../../packages/database/database.types.ts', import.meta.url),
)

const hasSupabaseConfig = Boolean(
  process.env.NUXT_PUBLIC_SUPABASE_URL && process.env.NUXT_PUBLIC_SUPABASE_KEY,
)

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
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
  modules: ['@nuxtjs/supabase', '@nuxt/icon'],
  icon: {
    provider: 'none',
    clientBundle: {
      scan: true,
      icons: [
        'lucide:arrow-left',
        'lucide:arrow-right',
        'lucide:bot',
        'lucide:calendar-days',
        'lucide:check',
        'lucide:circle-check',
        'lucide:eye',
        'lucide:file-check-2',
        'lucide:file-text',
        'lucide:folder',
        'lucide:github',
        'lucide:house',
        'lucide:landmark',
        'lucide:menu',
        'lucide:message-square',
        'lucide:palette',
        'lucide:rotate-ccw',
        'lucide:save',
        'lucide:scan-line',
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
  runtimeConfig: {
    resend: {
      apiKey: '',
      from: '',
      replyTo: '',
    },
    public: {
      openexpert: {
        hasSupabaseConfig,
      },
      supabase: {
        url: process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:55321',
        key: process.env.NUXT_PUBLIC_SUPABASE_KEY || 'local-development-placeholder',
      },
    },
  },
  supabase: {
    types: databaseTypes,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/', '/personalizacja', '/waitlist', '/api/mcp'],
    },
  },
  css: ['~/assets/css/design.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert — Modułowa platforma dla ekspertów',
      meta: [
        { name: 'description', content: 'Modułowa platforma open source dla ekspertów. Dobieraj moduły, łącz je dowolnie i buduj własne. Obsługuje człowieka i agenta AI — przez UI, REST API i protokół MCP.' },
        { name: 'apple-mobile-web-app-title', content: 'OpenExpert' },
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
