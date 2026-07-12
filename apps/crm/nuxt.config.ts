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
  modules: ['@nuxt/ui', '@nuxtjs/supabase'],
  css: ['~/assets/css/main.css'],
  ui: {
    fonts: false,
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error'],
      transitions: true,
      defaultVariants: {
        color: 'neutral',
        size: 'sm',
      },
    },
  },
  runtimeConfig: {
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
      exclude: [
        '/login',
        '/register',
        '/confirm',
        '/forgot-password',
        '/reset-password',
        '/design',
      ],
      saveRedirectToCookie: true,
    },
  },
  app: {
    pageTransition: { name: 'oe-page', mode: 'out-in' },
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert CRM',
      meta: [
        { name: 'description', content: 'CRM dla platformy OpenExpert.' },
      ],
    },
  },
})
